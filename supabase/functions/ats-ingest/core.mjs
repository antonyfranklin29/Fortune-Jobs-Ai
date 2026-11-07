// GENERATED from ../job-ingest/lib.mjs by scripts/build-ats-core.cjs. Do not edit;
// tests/ats-ingest.ts checks it matches the source.
const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|ref|referrer|src|source|trk|trkid|campaign|cmp|mc_[a-z]+|_hs[a-z]+|se|v)$/i;

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
export function classifyRole(title, roles) {
  for (const r of roles) if (titleMatchesRole(title, r)) return r.id;
  return null;
}
export function regionIndex(config) {
  const byCode = new Map(), byName = new Map();
  for (const r of config.regions) { byCode.set(r.code, r); byName.set(r.name.toLowerCase(), r); }
  return { byCode, byName, list: config.regions };
}
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
export function parsePostedAt(raw, now = new Date()) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > now.getTime() + 60 * 60 * 1000) return null;
  return d.toISOString();
}
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
