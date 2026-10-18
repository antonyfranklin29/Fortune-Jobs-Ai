// Read-only production check for the Quick Match database path. No job data or
// publishable key is printed. Run manually: node scripts/quick-match-load.mjs 100
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const count = Number(process.argv[2] ?? 100);
if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('count must be 1–100');

const window = {};
runInNewContext(await readFile(new URL('../config.js', import.meta.url), 'utf8'), { window });
const { url, key } = window.FJ_CONFIG ?? {};
if (!/^https:\/\/[^/]+\.supabase\.co$/.test(url) || !key) throw new Error('public Supabase config missing');

const columns = 'job_title,company,location,salary,apply_url,employment_type,work_mode,is_remote,posted_at,category,country,job_description,source,closed_at';
const params = new URLSearchParams({
  select: columns, limit: '300', 'closed_at': 'is.null', order: 'posted_at.desc.nullslast',
  or: '(search_text.ilike.*data*,search_text.ilike.*analyst*)', country: 'eq.us',
});
const endpoint = `${url}/rest/v1/pre_scraped_jobs?${params}`;
const started = performance.now();
const timings = await Promise.all(Array.from({ length: count }, async () => {
  const t = performance.now();
  try {
    const response = await fetch(endpoint, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    return { ms: performance.now() - t, status: response.status, bytes: body.length,
      rows: response.ok ? JSON.parse(body).length : null };
  } catch (error) {
    return { ms: performance.now() - t, status: error.name, bytes: 0, rows: null };
  }
}));

const sorted = timings.map((t) => t.ms).sort((a, b) => a - b);
const statuses = Object.groupBy(timings, (t) => String(t.status));
console.log(JSON.stringify({
  requests: count,
  wall_ms: Math.round(performance.now() - started),
  p50_ms: Math.round(sorted[Math.ceil(count * .50) - 1]),
  p95_ms: Math.round(sorted[Math.ceil(count * .95) - 1]),
  max_ms: Math.round(sorted.at(-1)),
  statuses: Object.fromEntries(Object.entries(statuses).map(([code, rows]) => [code, rows.length])),
  returned_rows_min: Math.min(...timings.filter((t) => t.rows !== null).map((t) => t.rows)),
  returned_rows_max: Math.max(...timings.filter((t) => t.rows !== null).map((t) => t.rows)),
  total_response_kib: Math.round(timings.reduce((sum, t) => sum + t.bytes, 0) / 1024),
}, null, 2));
