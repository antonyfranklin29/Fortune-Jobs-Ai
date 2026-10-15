// Pure rules for job ingestion. No network, no database: everything that decides
// whether a listing counts lives here, so it is tested rather than assumed.
// Runs unchanged in Deno (the edge worker) and Node (tests/job-ingest.mjs).

export const SOURCE_ADZUNA = 'adzuna';
export const ADZUNA_PER_PAGE = 50;          // the API's maximum page size

// ── roles ─────────────────────────────────────────────────────────────────────
export function compileRoles(config) {
  return config.roles.map((r) => ({
    id: r.id, name: r.name, query: r.query, review: r.review,
    inc: r.include.map((p) => new RegExp(p, 'i')),
    exc: r.exclude.map((p) => new RegExp(p, 'i')),
  }));
}

export function titleMatchesRole(title, role) {
  const t = String(title || '');
  return role.inc.some((re) => re.test(t)) && !role.exc.some((re) => re.test(t));
}

// The first role whose rules accept the title. Order in the config matters only
// for overlapping families, which the exclude lists keep apart.
export function classifyRole(title, roles) {
  for (const r of roles) if (titleMatchesRole(title, r)) return r.id;
  return null;
}

// ── states ────────────────────────────────────────────────────────────────────
export function regionIndex(config) {
  const byCode = new Map(), byName = new Map();
  for (const r of config.regions) { byCode.set(r.code, r); byName.set(r.name.toLowerCase(), r); }
  return { byCode, byName, list: config.regions };
}

// Attribute a listing to a state ONLY from evidence on the listing itself.
// Adzuna's area array is authoritative ([country, state, county, city]); a
// location string is the fallback. Anything ambiguous returns null and the
// listing is not counted anywhere, rather than guessed into a state.
export function stateFromEvidence({ area, displayName, location } = {}, idx) {
  if (Array.isArray(area) && area.length >= 2) {
    const name = String(area[1] || '').trim().toLowerCase();
    if (name === 'washington d.c.' || name === 'washington, d.c.' || name === 'district of columbia') return 'DC';
    const hit = idx.byName.get(name);
    if (hit) return hit.code;
  }
  for (const raw of [displayName, location]) {
    if (!raw) continue;
    const s = String(raw).trim();
    if (/\b(?:washington,?\s*d\.?\s*c\.?|district of columbia)\b/i.test(s)) return 'DC';
    // "City, ST" or "City, ST 27601"
    const code = s.match(/,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
    if (code && idx.byCode.has(code[1])) return code[1];
    // "City, Full State, USA" or "City, Full State"
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    const tail = parts.filter((p) => !/^(usa|us|united states)$/i.test(p));
    if (tail.length >= 2) {
      const hit = idx.byName.get(tail[tail.length - 1].toLowerCase());
      if (hit) return hit.code;
    }
    // A state-level listing with no city ("Pennsylvania, USA") names its state,
    // except bare "Washington", which could be the state or DC: refuse to guess.
    if (tail.length === 1 && tail[0].toLowerCase() !== 'washington') {
      const hit = idx.byName.get(tail[0].toLowerCase());
      if (hit) return hit.code;
    }
  }
  return null;
}

// ── URLs ──────────────────────────────────────────────────────────────────────
const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|ref|referrer|src|source|trk|trkid|campaign|cmp|mc_[a-z]+|_hs[a-z]+|se|v)$/i;

// A stable form of an application URL for de-duplication: https only, lower-case
// host, no fragment, no tracking parameters, remaining parameters sorted.
// Returns null for anything that is not a usable public http(s) URL.
export function canonicalUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname || !u.hostname.includes('.')) return null;
  if (/^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname)) return null;
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';
  const kept = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);
  return u.toString().replace(/\/$/, '');
}

// ── dates ─────────────────────────────────────────────────────────────────────
// Never invent a posting date. A missing or unparseable value stays null, and a
// date in the future (clock skew, bad data) is rejected rather than trusted.
export function parsePostedAt(raw, now = new Date()) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > now.getTime() + 60 * 60 * 1000) return null;
  return d.toISOString();
}

// ── normalisation ─────────────────────────────────────────────────────────────
// Turn one Adzuna result into a catalogue row for the requested role and state,
// or say exactly why it was rejected. Nothing is filled in that the listing does
// not state: no invented company, salary, date, state or match reason.
export function normalizeAdzuna(r, { role, regionCode, idx, fetchedAt, now = new Date() }) {
  if (!r || typeof r !== 'object') return { reject: 'malformed' };
  const id = r.id != null ? String(r.id).trim() : '';
  if (!id) return { reject: 'no_source_id' };
  const title = String(r.title || '').replace(/<[^>]*>/g, '').trim();
  if (!title) return { reject: 'no_title' };
  if (!titleMatchesRole(title, role)) return { reject: 'off_role' };

  const applyUrl = canonicalUrl(r.redirect_url);
  if (!applyUrl) return { reject: 'invalid_apply_url' };

  const state = stateFromEvidence({ area: r.location?.area, displayName: r.location?.display_name }, idx);
  if (!state) return { reject: 'no_state_evidence' };
  if (state !== regionCode) return { reject: 'other_state' };

  const predicted = String(r.salary_is_predicted ?? '') === '1';
  const lo = Number(r.salary_min), hi = Number(r.salary_max);
  const salary = !predicted && Number.isFinite(lo) && lo > 0
    ? (Number.isFinite(hi) && hi > lo ? `$${Math.round(lo).toLocaleString('en-US')}–$${Math.round(hi).toLocaleString('en-US')}` : `$${Math.round(lo).toLocaleString('en-US')}`)
    : null;

  const contract = { full_time: 'Full-time', part_time: 'Part-time' }[r.contract_time] ||
                   { contract: 'Contract', permanent: null }[r.contract_type] || null;
  const remote = /\bremote\b/i.test(title);

  return {
    row: {
      source: SOURCE_ADZUNA,
      source_listing_id: id,
      canonical_role: role.id,
      category: role.name,
      state_code: state,
      country: 'us',
      job_title: title.slice(0, 300),
      company: r.company?.display_name ? String(r.company.display_name).trim().slice(0, 200) : null,
      location: r.location?.display_name ? String(r.location.display_name).trim().slice(0, 200) : null,
      salary,
      apply_url: applyUrl,
      source_url: applyUrl,
      job_description: r.description ? String(r.description).replace(/<[^>]*>/g, '').trim().slice(0, 4000) : null,
      employment_type: contract,
      is_remote: remote,
      work_mode: remote ? 'remote' : null,
      posted_at: parsePostedAt(r.created, now),
      fetched_at: fetchedAt,
      attribution: 'Adzuna',
    },
  };
}

// Within one batch: same source id, or the same canonical application URL, is
// one listing. The newest posting date wins so a repost refreshes rather than
// duplicates.
export function dedupe(rows) {
  const out = new Map();
  for (const row of rows) {
    const key = row.source_listing_id ? `${row.source}:${row.source_listing_id}` : `url:${row.apply_url}`;
    const urlKey = `url:${row.apply_url}`;
    const existing = out.get(key) || out.get(urlKey);
    if (!existing || (row.posted_at && (!existing.posted_at || row.posted_at > existing.posted_at))) {
      if (existing) { out.delete(`${existing.source}:${existing.source_listing_id}`); out.delete(`url:${existing.apply_url}`); }
      out.set(key, row); out.set(urlKey, row);
    }
  }
  return [...new Set(out.values())];
}

// ── eligibility ───────────────────────────────────────────────────────────────
// What the coverage report counts: still listed recently, not closed, and a real
// posting date inside the freshness window. A row with no posting date is kept in
// the catalogue but never counted as fresh, because freshness cannot be proven.
export function isEligible(row, cfg, now = new Date()) {
  if (row.closed_at) return false;
  if (!row.posted_at || !row.last_seen_at) return false;
  const day = 86400000;
  return now - new Date(row.posted_at) <= cfg.fresh_days * day &&
         now - new Date(row.last_seen_at) <= cfg.seen_within_days * day;
}

// ── planning ──────────────────────────────────────────────────────────────────
// Choose which (role, state, page) requests to spend a run's budget on. Cells
// that are due and furthest from target go first.
//
// A cell gets a FULL sweep (enough pages for the target plus one for rejected
// titles, capped) when it is short, has never been fully swept, or its last
// full sweep is older than fullSweepDays. Otherwise it gets one incremental
// page of the newest listings. The periodic full sweep matters: eligibility
// requires a listing to have been seen within seen_within_days, and a one-page
// refresh only re-sees the newest page, so without it older but still-open
// listings would silently age out of the count. fullSweepDays must therefore
// stay below seen_within_days.
//
// Whatever the budget cannot cover is returned as deferred so the report can
// say so instead of hiding it.
export function planRequests({ cells, roles, regions, target, budget, maxPagesPerCell = 3,
                               perPage = ADZUNA_PER_PAGE, fullSweepDays = 6, now = new Date() }) {
  const due = [];
  for (const role of roles) for (const reg of regions) {
    const c = cells.get(`${role.id}:${reg.code}`) || { fresh: 0, nextDueAt: null, lastFullSweepAt: null };
    if (c.nextDueAt && new Date(c.nextDueAt) > now) continue;
    const shortage = Math.max(0, target - c.fresh);
    const sweptRecently = c.lastFullSweepAt && now - new Date(c.lastFullSweepAt) < fullSweepDays * 86400000;
    const full = shortage > 0 || !sweptRecently;
    const pages = full ? Math.min(maxPagesPerCell, Math.ceil(Math.max(shortage, target) / perPage) + 1) : 1;
    due.push({ role: role.id, region: reg.code, shortage, pages, mode: full ? 'fill' : 'refresh' });
  }
  due.sort((a, b) => b.shortage - a.shortage || a.role.localeCompare(b.role) || a.region.localeCompare(b.region));
  const plan = [], deferred = [];
  let left = budget;
  for (const cell of due) {
    if (left <= 0) { deferred.push(cell); continue; }
    const take = Math.min(cell.pages, left);
    for (let p = 1; p <= take; p++) plan.push({ role: cell.role, region: cell.region, page: p, mode: cell.mode });
    left -= take;
    if (take < cell.pages) deferred.push({ ...cell, pages: cell.pages - take });
  }
  return { plan, deferred };
}

// Exponential backoff with full jitter, capped.
export function backoffMs(attempt, base = 1000, cap = 30000, rand = Math.random) {
  return Math.floor(rand() * Math.min(cap, base * 2 ** attempt));
}
