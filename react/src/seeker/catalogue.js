import { FJAccuracy, FJCompanyLogos, FJDataSafety } from '../lib/sharedLibs.js';
import { fixApplyUrl } from '../shared/applyUrl.js';
import * as Guest from '../resume/lib/guestResume.js';
import * as Matching from '../resume/lib/resumeMatching.js';

const fields = 'job_title,company,location,salary,apply_url,employment_type,work_mode,is_remote,posted_at,category,country,job_description,source,closed_at';
const DAY = 86400000;

async function read(params, signal) {
  const config = window.FJ_CONFIG;
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}` };
  let response = await fetch(`${config.url}/rest/v1/pre_scraped_jobs?${params}`, { headers, signal });
  // A busy database occasionally cancels a broad search at its time limit (HTTP 500); one retry
  // almost always succeeds, so try once more before showing an error.
  if (response.status >= 500 && !signal?.aborted) {
    await new Promise((r) => setTimeout(r, 400));
    response = await fetch(`${config.url}/rest/v1/pre_scraped_jobs?${params}`, { headers, signal });
  }
  if (!response.ok) throw new Error('The job catalogue is temporarily unavailable. Please try again.');
  return response.json();
}

export function safeApplyUrl(value) { return FJDataSafety.httpUrl(fixApplyUrl(value)); }
export function logoFor(job) {
  const value = FJCompanyLogos.urlFor(job);
  return value?.startsWith('assets/') ? `./${value}` : value;
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
  if (['1', '3', '7', '30'].includes(filters.date_posted)) params.set('posted_at', `gte.${new Date(Date.now() - Number(filters.date_posted) * DAY).toISOString()}`);
  if (filters.salary === 'listed' || Number(filters.salary_min) > 0) params.set('salary', 'not.is.null');
  if (filters.category) params.set('category', `eq.${filters.category}`);
  if (filters.company) params.set('company', `ilike.*${filters.company}*`);
  return params;
}
// The city a search asks for, as stored at the start of a job's location ("Chicago, IL").
// A region-wide search has no city. Characters PostgREST treats specially are removed.
const cityAliases = { 'new york city': 'new york', nyc: 'new york', 'saint louis': 'st louis', bangalore: 'bengaluru' };
export function searchCity(filters = {}) {
  if (filters.location_scope === 'region') return '';
  const raw = String(filters.city || String(filters.location || '').split(',')[0]).toLowerCase().replace(/[^a-z0-9.\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  return cityAliases[raw] || raw;
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

/** Highest yearly USD base pay in a free-text salary ("$80,000 - $95,000", "$55/hr", "120k"),
 *  or 0 when it can't be read reliably: other currencies, or no clear amount. Text after
 *  equity, bonus, stock or commission is ignored, so "$85k base + $150k equity" reads as 85,000. */
export function salaryTop(text) {
  let t = String(text || '').toLowerCase().replace(/,/g, '');
  if (/(cad|c\$|gbp|£|€|eur|inr|₹|aud|a\$)/.test(t)) return 0;
  if (!/\$|usd/.test(t)) return 0; // no US-dollar marker: the currency isn't certain
  t = t.split(/equity|bonus|stock|rsu|commission|\bote\b|signing/)[0];
  // Only the first amount or range counts ("$80k - $95k", "$85,000 base plus …" → 85,000).
  const n = (v, k) => Number(v) * (k ? 1000 : 1);
  const range = t.match(/(\d+(?:\.\d+)?)\s*(k\b)?\s*(?:-|–|to)\s*\$?\s*(\d+(?:\.\d+)?)\s*(k\b)?/);
  const single = t.match(/(\d+(?:\.\d+)?)\s*(k\b)?/);
  if (!single) return 0;
  const top = range && range.index === single.index ? Math.max(n(range[1], range[2]), n(range[3], range[4])) : n(single[1], single[2]);
  if (/hour|hr\b|\/h\b/.test(t)) return Math.round(top * 2080);
  if (/month|\/mo\b/.test(t)) return top * 12;
  return top >= 10000 ? top : 0; // a bare small number is not a yearly salary
}
const meetsSalary = (job, min) => !(Number(min) > 0) || salaryTop(job.salary) >= Number(min);

export async function quickMatches(query, filters = {}, signal, limit = 10) {
  if (!query.trim() && !Object.values(filters).some(Boolean)) return recentJobs(signal);
  const tokens = tokensFor(query);
  const first = await read(candidateParams(tokens, filters), signal);
  let rows = first;
  // The broad query returns the newest 300 matches nationwide, so a city's jobs can all fall
  // outside it. A second query limited to the city keeps them in the pool.
  const city = searchCity(filters);
  if (city.length >= 2) {
    try {
      const params = candidateParams(tokens, filters);
      params.set('location', `ilike.*${city}*`);
      const urls = new Set(first.map(job => job.apply_url));
      rows = first.concat((await read(params, signal)).filter(job => !urls.has(job.apply_url)));
    } catch (error) { if (signal?.aborted) throw error; }
  }
  if (first.length >= 10 && first.slice(0, 10).every(job => job.source === first[0].source)) {
    try { rows = rows.concat(await read(candidateParams(tokens, filters, first[0].source), signal)); }
    catch (error) { if (signal?.aborted) throw error; }
  }
  const recent = rows.filter(job => ['employer_direct','employer_feed'].includes(job.source) || Date.parse(job.posted_at) >= Date.now() - 30 * DAY);
  const accuracy = FJAccuracy;
  const filtered = accuracy.filterJobs(recent, query, filters).filter((job) => meetsSalary(job, filters.salary_min));
  const ranked = filtered.map(job => ({ ...job, search_reason: accuracy.matchReason(job, query, filters), search_score: score(job, tokens, query.toLowerCase().trim(), filters) }));
  ranked.sort((a, b) => b.search_score - a.search_score);
  const top = [], seen = new Set(), companies = new Map();
  for (const job of ranked) {
    const company = job.company.trim().toLowerCase();
    const key = `${job.job_title.trim().toLowerCase()}|${company}`;
    if (seen.has(key) || (companies.get(company) || 0) >= (limit > 10 ? 4 : 2)) continue;
    seen.add(key); companies.set(company, (companies.get(company) || 0) + 1); top.push(job);
    if (top.length === limit) break;
  }
  if (limit === 10 && top.length === 10 && top.filter(job => job.source === top[0].source).length >= 8) {
    const existing = new Set(top.map(job => job.apply_url));
    const alternate = ranked.find(job => job.source !== top[0].source && !existing.has(job.apply_url) &&
      job.search_score >= top[9].search_score - 10 && !seen.has(`${job.job_title.trim().toLowerCase()}|${job.company.trim().toLowerCase()}`));
    if (alternate) top[9] = alternate;
  }
  return top;
}

export function guestMatchProfile() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('resume') === '0') return null;
  try { return Guest.load(sessionStorage, Date.now(), params.get('resume') === '1' ? params.get('resume_id') || '' : null); } catch { return null; }
}
export function fitFor(job, profile) {
  return profile ? Matching.assess(job, profile, FJAccuracy.metadata) : null;
}
