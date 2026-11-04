import '../../../config.js';
import '../../../data-safety.js';
import '../../../search-accuracy.js';
import '../../../resume-matching.js';
import '../../../guest-resume.js';
import '../../../company-brand-map.js';
import '../../../company-logos.js';

const config = window.FJ_CONFIG;
const fields = 'job_title,company,location,salary,apply_url,employment_type,work_mode,is_remote,posted_at,category,country,job_description,source,closed_at';
const headers = { apikey: config.key, Authorization: `Bearer ${config.key}` };
const DAY = 86400000;

async function read(params, signal) {
  const response = await fetch(`${config.url}/rest/v1/pre_scraped_jobs?${params}`, { headers, signal });
  if (!response.ok) throw new Error('The job catalogue is temporarily unavailable. Please try again.');
  return response.json();
}

export function safeApplyUrl(value) { return window.FJDataSafety.httpUrl(value); }
export function logoFor(job) {
  const value = window.FJCompanyLogos.urlFor(job);
  return value?.startsWith('assets/') ? `../${value}` : value;
}
export function jobAge(job) {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(job.posted_at || job.created_at)) / DAY));
  if (!Number.isFinite(days)) return '';
  return days === 0 ? 'Posted today' : `Posted ${days} day${days === 1 ? '' : 's'} ago`;
}
export function cleanDescription(value) { return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

export async function recentJobs(signal) {
  const cutoff = new Date(Date.now() - 30 * DAY).toISOString();
  async function bySource(source) {
    return read(new URLSearchParams({ select: fields, closed_at: 'is.null', posted_at: `gte.${cutoff}`, source, order: 'posted_at.desc.nullslast', limit: '70' }), signal);
  }
  const [a, b] = await Promise.allSettled([bySource('eq.adzuna'), bySource('neq.adzuna')]);
  const adzuna = a.status === 'fulfilled' ? a.value : [];
  const other = b.status === 'fulfilled' ? b.value : [];
  if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
  const valid = rows => rows.filter(job => job?.job_title && job.company && safeApplyUrl(job.apply_url) && Date.parse(job.posted_at) >= Date.now() - 30 * DAY);
  const pools = [valid(adzuna), valid(other)];
  const selected = [], seen = new Set(), companyCounts = new Map();
  function take(pool) {
    while (pool.length) {
      const job = pool.shift();
      const key = `${job.job_title.toLowerCase()}|${job.company.toLowerCase()}`;
      const company = job.company.toLowerCase();
      if (seen.has(key) || (companyCounts.get(company) || 0) >= 2) continue;
      seen.add(key); companyCounts.set(company, (companyCounts.get(company) || 0) + 1); selected.push(job); return;
    }
  }
  for (let i = 0; i < 10; i++) take(pools[i % 3 === 1 ? 1 : 0]);
  while (selected.length < 10 && (pools[0].length || pools[1].length)) take(pools[0].length ? pools[0] : pools[1]);
  return selected;
}

const stopwords = new Set(['a','an','and','the','of','for','to','in','on','at','with','or','jobs','job','role','roles','position','positions','senior','junior']);
function tokensFor(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/).filter(token => token.length >= 2 && !stopwords.has(token)); }
function candidateParams(tokens, filters, excludeSource) {
  const params = new URLSearchParams({ select: fields, limit: '300', closed_at: 'is.null', order: 'posted_at.desc.nullslast' });
  if (excludeSource) params.set('source', `neq.${excludeSource}`);
  if (tokens.length) params.set('or', `(${tokens.map(token => `search_text.ilike.*${token.replace(/\*/g, '')}*`).join(',')})`);
  if (filters.country) params.set('country', `eq.${filters.country.toLowerCase()}`);
  if (filters.date_posted) params.set('posted_at', `gte.${new Date(Date.now() - Number(filters.date_posted) * DAY).toISOString()}`);
  if (filters.company) params.set('company', `ilike.*${filters.company}*`);
  return params;
}
function score(job, tokens, phrase, filters) {
  const title = job.job_title.toLowerCase();
  let points = phrase && title.includes(phrase) ? 55 : 0;
  points += tokens.filter(token => title.includes(token)).length * 14;
  if (filters.location && job.location?.toLowerCase().includes(filters.location.toLowerCase().split(',')[0].trim())) points += 30;
  if (filters.work_mode && job.work_mode === filters.work_mode) points += 12;
  if (job.salary) points += 6;
  const age = (Date.now() - Date.parse(job.posted_at)) / DAY;
  if (age <= 1) points += 14; else if (age <= 3) points += 9; else if (age <= 7) points += 5;
  return points;
}

export async function quickMatches(query, filters = {}, signal) {
  if (!query.trim()) return recentJobs(signal);
  const tokens = tokensFor(query);
  const first = await read(candidateParams(tokens, filters), signal);
  let rows = first;
  if (first.length >= 10 && first.slice(0, 10).every(job => job.source === first[0].source)) {
    try { rows = first.concat(await read(candidateParams(tokens, filters, first[0].source), signal)); }
    catch (error) { if (signal?.aborted) throw error; }
  }
  const recent = rows.filter(job => ['employer_direct','employer_feed'].includes(job.source) || Date.parse(job.posted_at) >= Date.now() - 30 * DAY);
  const accuracy = window.FJAccuracy;
  const filtered = accuracy.filterJobs(recent, query, filters);
  const ranked = filtered.map(job => ({ ...job, search_reason: accuracy.matchReason(job, query, filters), search_score: score(job, tokens, query.toLowerCase().trim(), filters) }));
  ranked.sort((a, b) => b.search_score - a.search_score);
  const top = [], seen = new Set(), companies = new Map();
  for (const job of ranked) {
    const company = job.company.trim().toLowerCase();
    const key = `${job.job_title.trim().toLowerCase()}|${company}`;
    if (seen.has(key) || (companies.get(company) || 0) >= 2) continue;
    seen.add(key); companies.set(company, (companies.get(company) || 0) + 1); top.push(job);
    if (top.length === 10) break;
  }
  if (top.length === 10 && top.filter(job => job.source === top[0].source).length >= 8) {
    const existing = new Set(top.map(job => job.apply_url));
    const alternate = ranked.find(job => job.source !== top[0].source && !existing.has(job.apply_url) &&
      job.search_score >= top[9].search_score - 10 && !seen.has(`${job.job_title.trim().toLowerCase()}|${job.company.trim().toLowerCase()}`));
    if (alternate) top[9] = alternate;
  }
  return top;
}

export function guestMatchProfile() {
  try { return window.FJGuestResume.load(sessionStorage, Date.now()); } catch { return null; }
}
export function fitFor(job, profile) {
  return profile ? window.FJResume.assess(job, profile, window.FJAccuracy.metadata) : null;
}
