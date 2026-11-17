import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { BOARDS } from '../supabase/functions/ats-ingest/boards.mjs';
import { boardUrl, extract, listOf, normalize, stateOf } from '../supabase/functions/ats-ingest/ats.mjs';
import { compileRoles, regionIndex } from '../supabase/functions/ats-ingest/core.mjs';
import { ROLES, REGIONS } from '../supabase/functions/ats-ingest/config.mjs';

// Usage: node scripts/check-boards.mjs [candidate-boards.json] [report.json]
// Candidate input is an array of { provider, slug, name, site? } records.
const [candidateFile, reportFile] = process.argv.slice(2);
const key = ({ provider, slug }) => `${provider}:${slug.toLowerCase()}`;
const existing = new Set(BOARDS.map(key));
const candidates = candidateFile ? JSON.parse(await readFile(candidateFile, 'utf8')) : [];
const boards = [...new Map([...candidates, ...BOARDS].map(board => [key(board), board])).values()];
const context = {
  roles: compileRoles(ROLES), idx: regionIndex(REGIONS), fetchedAt: new Date().toISOString(),
};

async function check(board) {
  const { provider, slug } = board;
  const stats = { ...board, added: !existing.has(key(board)), status: null, total: 0, us: 0, matched: 0, roles: {} };
  try {
    const response = await fetch(boardUrl(provider, slug), {
      headers: { accept: 'application/json', 'user-agent': 'FortuneJobsAI/1.0 (+https://fortunejobsai.com; info@fortunejobsai.com)' },
      signal: AbortSignal.timeout(10000),
    });
    stats.status = response.status;
    if (response.status !== 200) {
      await response.body?.cancel();
      return stats;
    }
    const jobs = listOf(provider, await response.json());
    stats.total = jobs.length;
    for (const raw of jobs) {
      const job = extract(provider, raw, board);
      if (job && (stateOf(job.locations, context.idx) ||
          job.locations.some(location => /\b(?:united states|usa)\b/i.test(location ?? '')))) stats.us++;
      const { row } = normalize(provider, raw, board, context);
      if (!row) continue;
      stats.matched++;
      stats.roles[row.canonical_role] = (stats.roles[row.canonical_role] ?? 0) + 1;
    }
  } catch (error) {
    stats.status = error.name;
  }
  return stats;
}

const results = [];
const totals = {};
for (let i = 0; i < boards.length; i += 4) {
  results.push(...await Promise.all(boards.slice(i, i + 4).map(check)));
  if (i + 4 < boards.length) await delay(200);
}
for (const board of results) {
  if (board.status !== 200 || !board.us) continue;
  const source = totals[board.provider] ??= {};
  for (const [role, count] of Object.entries(board.roles)) source[role] = (source[role] ?? 0) + count;
}
console.table(results.map(({ provider, slug, status, total, us, matched }) => ({ provider, slug, status, total, us, matched })));
console.table(totals);
if (reportFile) await writeFile(reportFile, JSON.stringify(results, null, 2) + '\n');
