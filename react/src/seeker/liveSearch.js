// Live Search: asks partner job networks (Jooble, WhatJobs) for openings right now and merges them
// with our own catalogue. Partners are searched through our edge functions, which keep the keys
// server-side and rate-limit each visitor. Nothing is stored.
export const LIVE_PARTNERS = [
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
    job_title: row.title, company: row.company || '', location: row.location || '', salary: row.salary || '',
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

// Our catalogue first for the same job (it links to the employer), then newest first.
export function mergeLive(catalogue, partners) {
  const seen = new Set(), out = [];
  for (const job of [...catalogue, ...partners]) {
    const key = sameJob(job);
    if (seen.has(key)) continue;
    seen.add(key); out.push(job);
  }
  return out.sort((a, b) => (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0));
}

export async function liveSearch({ q, location = '' }, catalogueSearch, signal, fetchImpl = (...a) => fetch(...a)) {
  const query = { q: String(q || '').trim().slice(0, 120), location: String(location || '').trim().slice(0, 120), page: 1 };
  if (!query.q) return [];
  const [catalogue, ...partners] = await Promise.all([
    catalogueSearch().catch(() => []),
    ...LIVE_PARTNERS.map(p => askPartner(p, query, signal, fetchImpl)),
  ]);
  return mergeLive(catalogue || [], partners.flat());
}
