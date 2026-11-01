// Read-only quality audit of public job rows. No scraper calls or link visits.
import {readFileSync} from 'node:fs';

const config = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const key = config.match(/\bkey:\s*'([^']+)'/)?.[1];
const url = config.match(/\burl:\s*'([^']+)'/)?.[1];
if (!key || !url) throw Error('Public catalogue configuration missing');

const select = 'id,job_title,company,canonical_role,state_code,apply_url,source,posted_at,job_description,source_url';
const jobs = [];
for (let offset = 0; offset < 20000; offset += 1000) {
  const endpoint = new URL('/rest/v1/pre_scraped_jobs', url);
  for (const [name, value] of Object.entries({select, closed_at: 'is.null', order: 'id.asc', limit: '1000', offset: String(offset)})) endpoint.searchParams.set(name, value);
  const response = await fetch(endpoint, {headers: {apikey: key, authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw Error(`Public catalogue HTTP ${response.status}`);
  const batch = await response.json();
  if (!Array.isArray(batch)) throw Error('Invalid catalogue response');
  jobs.push(...batch);
  if (batch.length < 1000) break;
}
if (jobs.length === 20000) throw Error('Audit page limit reached');

const brands = readFileSync(new URL('../company-brand-map.js', import.meta.url), 'utf8');
const mappedNames = new Set([...brands.matchAll(/^\s*"([^"]+)"\s*:/gm)].map(match => match[1]));
const localNames = new Set([...readFileSync(new URL('../company-logos.js', import.meta.url), 'utf8').matchAll(/^\s*'([^']+)'\s*:/gm)].map(match => match[1]));
const metrics = {total: jobs.length, missing_title: 0, missing_company: 0, missing_description: 0,
  short_description_under_80_chars: 0, invalid_apply_url: 0, missing_role: 0, missing_state: 0,
  mapped_logo_jobs: 0, source_counts: {}, by_source: {}, apply_hosts: {}, role_counts: {}, role_state_counts: {}, examples: []};
for (const job of jobs) {
  const source = String(job.source || 'unknown');
  metrics.source_counts[source] = (metrics.source_counts[source] || 0) + 1;
  const sourceQuality = metrics.by_source[source] ||= {missing_description: 0, invalid_apply_url: 0, mapped_logo_jobs: 0};
  if (!String(job.job_title || '').trim()) metrics.missing_title++;
  if (!String(job.company || '').trim()) metrics.missing_company++;
  const description = String(job.job_description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!description) { metrics.missing_description++; sourceQuality.missing_description++; }
  if (description.length < 80) metrics.short_description_under_80_chars++;
  let host = null;
  try {
    const parsed = new URL(job.apply_url);
    if (parsed.protocol === 'https:' && parsed.hostname.includes('.')) host = parsed.hostname.toLowerCase();
  } catch {}
  if (!host) {
    metrics.invalid_apply_url++;
    sourceQuality.invalid_apply_url++;
    if (metrics.examples.length < 20) metrics.examples.push({id: job.id, issue: 'non_https_or_invalid_apply_url', scheme: String(job.apply_url || '').split(':', 1)[0].slice(0, 12)});
  } else metrics.apply_hosts[host] = (metrics.apply_hosts[host] || 0) + 1;
  if (!job.canonical_role) metrics.missing_role++;
  if (!job.state_code) metrics.missing_state++;
  const company = String(job.company || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (mappedNames.has(company) || localNames.has(company)) { metrics.mapped_logo_jobs++; sourceQuality.mapped_logo_jobs++; }
  const role = String(job.canonical_role || 'unclassified');
  metrics.role_counts[role] = (metrics.role_counts[role] || 0) + 1;
  if (job.state_code) {
    const cell = `${role}:${job.state_code}`;
    metrics.role_state_counts[cell] = (metrics.role_state_counts[cell] || 0) + 1;
  }
}
const top = object => Object.entries(object).sort((a, b) => b[1] - a[1]).slice(0, 15);
const sparseCells = Object.entries(metrics.role_state_counts).filter(([, count]) => count < 5).sort((a, b) => a[1] - b[1]);
console.log(JSON.stringify({checked_at: new Date().toISOString(), scope: 'Public open catalogue only; URL syntax and mapped logo names, not live destinations or employer verification',
  total: metrics.total, missing_title: metrics.missing_title, missing_company: metrics.missing_company,
  missing_description: metrics.missing_description, short_description_under_80_chars: metrics.short_description_under_80_chars,
  invalid_apply_url: metrics.invalid_apply_url, missing_role: metrics.missing_role, missing_state: metrics.missing_state,
  mapped_logo_jobs: metrics.mapped_logo_jobs, source_counts: metrics.source_counts, by_source: metrics.by_source,
  top_apply_hosts: top(metrics.apply_hosts), role_counts: top(metrics.role_counts),
  sparse_role_state_cells: sparseCells.length, sparse_cell_examples: sparseCells.slice(0, 15),
  examples: metrics.examples}, null, 2));
