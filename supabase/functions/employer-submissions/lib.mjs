// Pure helpers for the employer-submissions function (Deno and Node).

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v) => typeof v === 'string' && UUID.test(v);

// The DNS name an employer publishes its proof at. Only well-formed public
// domains are ever looked up, so this cannot be pointed at internal names.
export function proofName(domain) {
  const d = String(domain || '').toLowerCase();
  if (d.length > 253 || !DOMAIN.test(d) || /\.(?:localhost|local|internal|test|invalid|example)$/.test(d)) return null;
  return `_fortunejobsai.${d}`;
}

export const proofValue = (token) => `fortunejobsai-verify=${token}`;

// Deno.resolveDns(name, "TXT") returns string[][] (each record split into
// character-strings). A record matches only when its joined text is exactly the
// expected value; substrings and prefixes do not count.
export function proofMatches(records, token) {
  if (!Array.isArray(records) || typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) return false;
  const want = proofValue(token);
  return records.some((r) => (Array.isArray(r) ? r.join('') : String(r)).trim() === want);
}
