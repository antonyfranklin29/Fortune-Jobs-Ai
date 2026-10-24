// Read-only public catalogue check. Never calls a scraper or reads account data.
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const PROJECT_URL = 'https://hqgakkcxcyspqhnlnscv.supabase.co';
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const DAY_MS = 86400000;
export const US_STATE_CODES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

function publicKey() {
  const config = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
  const key = config.match(/\bkey:\s*'([^']+)'/)?.[1];
  if (!key) throw Error('public_catalogue_key_missing');
  return key;
}

export async function readCatalogue({fetchImpl = fetch, key = publicKey(), url = PROJECT_URL} = {}) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const endpoint = new URL('/rest/v1/pre_scraped_jobs', url);
    endpoint.searchParams.set('select', 'source,state_code,posted_at,last_seen_at');
    endpoint.searchParams.set('closed_at', 'is.null');
    endpoint.searchParams.set('order', 'id.asc');
    endpoint.searchParams.set('limit', String(PAGE_SIZE));
    endpoint.searchParams.set('offset', String(page * PAGE_SIZE));
    const response = await fetchImpl(endpoint, {
      headers: {apikey: key, authorization: `Bearer ${key}`},
      redirect: 'error',
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Error(`catalogue_http_${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length > PAGE_SIZE) throw Error('catalogue_invalid_response');
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
  throw Error('catalogue_page_limit_reached');
}

export function assessCatalogue(rows, {now = new Date(), minRecentJobs = 300,
  maxSeenAgeHours = 72} = {}) {
  const nowMs = now.getTime();
  const cutoff = nowMs - 30 * DAY_MS;
  const recent = rows.filter(row => {
    const t = Date.parse(row.posted_at || '');
    return Number.isFinite(t) && t >= cutoff && t <= nowMs + 3600000;
  });
  const states = new Set(recent.map(row => row.state_code).filter(code => US_STATE_CODES.includes(code)));
  const missingStates = US_STATE_CODES.filter(code => !states.has(code));
  const sources = {};
  let newestSeen = null;
  for (const row of rows) {
    const source = String(row.source || 'unknown').slice(0, 40);
    sources[source] = (sources[source] || 0) + 1;
    const t = Date.parse(row.last_seen_at || '');
    if (Number.isFinite(t) && t <= nowMs + 3600000 && (newestSeen === null || t > newestSeen)) newestSeen = t;
  }
  const seenAgeHours = newestSeen === null ? null : Math.round((nowMs - newestSeen) / 3600000 * 10) / 10;
  const failures = [];
  if (recent.length < minRecentJobs) failures.push('too_few_recent_jobs');
  if (missingStates.length) failures.push('missing_recent_states');
  if (seenAgeHours === null || seenAgeHours > maxSeenAgeHours) failures.push('catalogue_not_refreshed');
  return {checked_at: now.toISOString(), status: failures.length ? 'attention_required' : 'healthy',
    open_jobs: rows.length, posted_within_30_days: recent.length, states_with_recent_jobs: states.size,
    missing_states: missingStates,
    latest_seen_at: newestSeen === null ? null : new Date(newestSeen).toISOString(),
    latest_seen_age_hours: seenAgeHours, by_source: sources, failures,
    note: 'Counts measure public listings, not role/state relevance or valid application links.'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = assessCatalogue(await readCatalogue());
    console.log(JSON.stringify(report));
    if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
    if (report.status !== 'healthy') process.exitCode = 1;
  } catch (error) {
    console.error(`Catalogue health check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
