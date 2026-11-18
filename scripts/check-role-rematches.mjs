import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { compileRoles, classifyRole } from '../supabase/functions/job-ingest/lib.mjs';

// Read-only estimate. Usage: node scripts/check-role-rematches.mjs baseline-job-roles.json
const baselinePath = process.argv[2];
if (!baselinePath) throw new Error('Supply the baseline job-roles.json path');
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const config = JSON.parse(await readFile(new URL('../config/job-roles.json', import.meta.url), 'utf8'));
const previous = compileRoles(baseline);
const current = compileRoles(config);
const oldIds = new Set(previous.map(role => role.id));
const counts = Object.fromEntries(current.filter(role => !oldIds.has(role.id)).map(role => [role.id, 0]));
const sandbox = { window: {} };
runInNewContext(await readFile(new URL('../config.js', import.meta.url), 'utf8'), sandbox);
const publicConfig = sandbox.window.FJ_CONFIG;
let after = 0, scanned = 0, existingChanged = 0, storedRoleChanged = 0;
for (;;) {
  const params = new URLSearchParams({
    select: 'id,job_title,canonical_role', closed_at: 'is.null',
    id: 'gt.' + after, order: 'id.asc', limit: '1000',
  });
  const response = await fetch(publicConfig.url + '/rest/v1/pre_scraped_jobs?' + params, {
    headers: { apikey: publicConfig.key, Authorization: 'Bearer ' + publicConfig.key },
    signal: AbortSignal.timeout(20000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Catalogue returned HTTP ' + response.status);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Expected catalogue rows');
  if (!rows.length) break;
  for (const row of rows) {
    const before = classifyRole(row.job_title, previous);
    const next = classifyRole(row.job_title, current);
    if (before && before !== next) existingChanged++;
    if (Object.hasOwn(counts, next)) {
      counts[next]++;
      if (row.canonical_role !== next) storedRoleChanged++;
    }
  }
  scanned += rows.length;
  const last = Number(rows.at(-1).id);
  if (!Number.isSafeInteger(last) || last <= after) throw new Error('Pagination stalled');
  after = last;
}
console.log(JSON.stringify({ checked_at: new Date().toISOString(), scanned_open_jobs: scanned,
  new_role_matches: counts, total_new_role_matches: Object.values(counts).reduce((a,b) => a+b, 0),
  stored_role_would_change: storedRoleChanged, existing_classifications_changed: existingChanged }, null, 2));
