import {requireHistoryReady,filterHistoryJobs} from '../shared/h1b.js';
import { quickMatches } from './catalogue.js';
// Live Search: asks partner job networks (Jooble, WhatJobs) for openings right now and merges them
// with our own catalogue. Partners are searched through our edge functions, which keep the keys
// server-side and rate-limit each visitor. Nothing is stored.
export const LIVE_PARTNERS = [
  { source: 'jobg8', name: '', catalogue: true },
  { source: 'jooble', name: 'Jooble', endpoint: 'jooble-search' },
  { source: 'whatjobs', name: 'WhatJobs', endpoint: 'whatjobs-search' },
];
export const PARTNER_SOURCES = new Set(LIVE_PARTNERS.map(p => p.source));
export const partnerName = source => LIVE_PARTNERS.find(p => p.source === source)?.name || '';

const DAY = 86400000;

// "2026-11-13T10:00:00", "3 days ago", "Today", "1 hour ago" → ISO date, or null when unknown.
export function partnerPostedAt(value, now = Date.now()) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed > now + DAY ? null : new Date(parsed).toISOString();
  if (/^(today|just now)$/i.test(text) || /\b(hour|minute|second)s?\b/i.test(text)) return new Date(now).toISOString();
  if (/^yesterday$/i.test(text)) return new Date(now - DAY).toISOString();
  const m = text.match(/(\d+)\+?\s*(day|week|month)s?\b/i);
  if (!m) return null;
  const days = Number(m[1]) * ({ day: 1, week: 7, month: 30 })[m[2].toLowerCase()];
  return new Date(now - days * DAY).toISOString();
}

export function partnerJob(row, source) {
  return {
    job_title: row.title, company: row.company || '', location: row.location || '',
    // Partners send "0.000000 - 0.000000" when there is no pay range: show no salary then.
    salary: /[1-9]/.test(String(row.salary || '')) ? row.salary : '',
    apply_url: row.url, job_description: row.description || '', source, posted_at: partnerPostedAt(row.date),
    live_partner: partnerName(source),
  };
}

async function askPartner({ endpoint, source }, query, signal, fetchImpl) {
  const config = typeof window === 'object' ? window.FJ_CONFIG : null;
  if (!config) return [];
  try {
    const response = await fetchImpl(config.url + '/functions/v1/' + endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.key },
      credentials: 'omit', signal, body: JSON.stringify(query),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.jobs) ? data.jobs.filter(r => r?.title && r?.url).map(r => partnerJob(r, source)) : [];
  } catch { return []; }
}

const sameJob = job => `${String(job.job_title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(job.company || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;

// Keep the catalogue copy for duplicates, then newest first.
export function mergeLive(catalogue, partners) {
  const seen = new Set(), out = [];
  for (const job of [...catalogue, ...partners]) {
    const key = sameJob(job);
    if (seen.has(key)) continue;
    seen.add(key); out.push(job);
  }
  return out.sort((a, b) => (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0));
}

// Live Search shows only partners that pay us per click (WhatJobs today; Jobg8 from January),
// in the same card layout as Quick Match, capped at the plan's result limit. Our own catalogue
// (Adzuna, USAJobs, company boards) is Quick Match.
export const PAID_PARTNERS = LIVE_PARTNERS.filter(p => ['jobg8','whatjobs'].includes(p.source));

export async function liveSearch({ q, location = '', sponsorship = '' }, _catalogueSearch, signal, fetchImpl = (...a) => fetch(...a), limit = 10) {
  const query = { q: String(q || '').trim().slice(0, 120), location: String(location || '').trim().slice(0, 120), page: 1 };
  if (!query.q) return [];
  if(sponsorship==='recent_h1b')await requireHistoryReady(signal,fetchImpl);
  const lists = await Promise.all(PAID_PARTNERS.map(p => p.catalogue
    ? quickMatches(query.q, { location: query.location, country: 'us', source: 'jobg8', sponsorship }, signal, limit, fetchImpl).then(rows => rows.filter(job => job.source === 'jobg8' && job.closed_at == null)).catch(() => [])
    : askPartner(p, query, signal, fetchImpl)));
  const turns = [];
  for (let i = 0; i < Math.max(0, ...lists.map(list => list.length)); i++) for (const list of lists) if (list[i]) turns.push(list[i]);
  return blendPartners([], sponsorship==='recent_h1b'?await filterHistoryJobs(turns,signal,fetchImpl):turns, { max: limit }).slice(0, limit);
}

// Normal searches: a few WhatJobs results mixed into our own list as regular cards, credited
// "Jobs by WhatJobs" with their tracking links unchanged (WhatJobs pays per click). Jooble stays in
// Live Search only, because its API key allows a limited number of requests.
export const BLEND_PARTNER = LIVE_PARTNERS.find(p => p.source === 'whatjobs');
export const BLEND_MAX = 5;
export const BLEND_EVERY = 4;

// Puts partner jobs after every BLEND_EVERY catalogue jobs (then at the end), skipping duplicates
// of each other and of our own jobs.
export function blendPartners(catalogue, partners, { max = BLEND_MAX, every = BLEND_EVERY } = {}) {
  const seen = new Set(catalogue.map(sameJob));
  const extra = [];
  for (const job of partners) {
    const key = sameJob(job);
    if (seen.has(key)) continue;
    seen.add(key); extra.push(job);
    if (extra.length >= max) break;
  }
  const out = [];
  let next = 0;
  catalogue.forEach((job, i) => {
    out.push(job);
    if ((i + 1) % every === 0 && next < extra.length) out.push(extra[next++]);
  });
  return out.concat(extra.slice(next));
}

export async function partnerBlend({ q, location = '' }, signal, fetchImpl = (...a) => fetch(...a)) {
  const query = { q: String(q || '').trim().slice(0, 120), location: String(location || '').trim().slice(0, 120), page: 1 };
  if (!query.q || !BLEND_PARTNER) return [];
  return askPartner(BLEND_PARTNER, query, signal, fetchImpl);
}
