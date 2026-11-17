import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { storeRemoteJobs } from './store-remote-jobs.mjs';
import { normalizeRemote, enabledSources, dedupeRemote } from './remote-jobs.mjs';

const write = process.argv.includes('--write');
const pageOption = process.argv.find(arg => arg.startsWith('--sample-pages='));
if (write && pageOption) throw new Error('A sample cannot be written');
if (write && !process.env.REMOTE_INGEST_DATABASE_URL) throw new Error('REMOTE_INGEST_DATABASE_URL is required');
const pageLimit = pageOption ? Number(pageOption.split('=')[1]) : Infinity;
if (!(pageLimit > 0)) throw new Error('Invalid sample page limit');
const sources = enabledSources(process.env);
const started = Date.now();
const rows = [];

async function readFeed(url, headers) {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    const retry = response.headers.get('retry-after');
    await response.body?.cancel();
    throw new Error(`${url.hostname} returned ${response.status}${retry ? ` (retry after ${retry})` : ''}`);
  }
  return response.json();
}

for (const source of sources) {
  const himalayas = source === 'himalayas';
  const url = new URL(himalayas ? 'https://himalayas.app/jobs/api?limit=20' : 'https://remotive.com/api/remote-jobs');
  const headers = { accept: 'application/json', 'user-agent': 'FortuneJobsAI/1.0 (+https://fortunejobsai.com; info@fortunejobsai.com)' };
  if (himalayas && process.env.HIMALAYAS_API_KEY) headers['X-API-Key'] = process.env.HIMALAYAS_API_KEY;
  const cursors = new Set();
  let listed = 0;
  let initialCount;
  for (let page = 1; page <= pageLimit; page++) {
    const data = await readFeed(url, headers);
    if (!Array.isArray(data.jobs)) throw new Error(`Malformed ${source} feed`);
    const expected = himalayas ? data.totalCount : data['job-count'];
    initialCount ??= expected;
    listed += data.jobs.length;
    if (!data.jobs.length && (page === 1 || expected > 0)) throw new Error(`Unexpected empty ${source} feed`);
    for (const job of data.jobs) {
      const row = normalizeRemote(source, job, Date.now());
      if (row) rows.push(row);
    }
    if (!himalayas || !data.nextCursor) {
      if (Number.isFinite(initialCount) && listed < initialCount * 0.98) throw new Error('Incomplete ' + source + ' snapshot');
      break;
    }
    if (cursors.has(data.nextCursor)) throw new Error('Himalayas pagination stalled');
    cursors.add(data.nextCursor);
    url.searchParams.set('cursor', data.nextCursor);
    if (page < pageLimit) await delay(1100);
  }
}
// Franklin (Nov 17 2026): store only remote jobs that match one of our roles; the rest of the
// feeds (mostly unrelated roles worldwide) would bloat the catalogue without helping searches.
const unique = dedupeRemote(rows.filter(row => row.canonical_role));
const counts = {};
for (const row of unique) {
  const roles = counts[row.source] ??= {};
  const role = row.canonical_role ?? 'unclassified';
  roles[role] = (roles[role] ?? 0) + 1;
}
console.log(JSON.stringify({ sample: Boolean(pageOption), matchedBySource: counts, total: unique.length }, null, 2));
if (!write) process.exit(0);

const db = new pg.Client({ connectionString: process.env.REMOTE_INGEST_DATABASE_URL });
await db.connect();
try {
  const closed = await storeRemoteJobs(db, unique, sources, started);
  console.log('Closed ' + closed + ' listings after the complete snapshot.');
} finally {
  await db.end();
}
