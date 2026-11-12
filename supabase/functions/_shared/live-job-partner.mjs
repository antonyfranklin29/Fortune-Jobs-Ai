import { isIP } from 'node:net';

const origins = new Set(['https://fortunejobsai.com', 'https://www.fortunejobsai.com']);
const minute = 60_000;
const maxClients = 2048;
const empty = { jobs: [] };

export function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export function mapPartnerJobs(rows, select) {
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  return rows.slice(0, 20).flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const job = select(row);
    try {
      const url = new URL(job.url);
      if (url.protocol !== 'https:' || url.username || url.password || !job.title || seen.has(job.url)) return [];
    } catch { return []; }
    seen.add(job.url);
    return [job];
  });
}

export function createPartnerHandler({ getKey, search, fetchImpl = fetch, now = Date.now }) {
  const limits = new Map();
  let windowStart = -1;
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { Vary: 'Origin', 'Cache-Control': 'no-store' };
    const json = (value, status = 200) => Response.json(value, { headers, status });
    if (!origins.has(origin)) return json(empty, 403);
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'content-type, apikey';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json(empty, 405);
    try {
      const key = getKey();
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      const userAgent = request.headers.get('user-agent')?.trim();
      if (!key || !ip || !isIP(ip) || !userAgent) return json(empty);
      const body = await request.json();
      if (!body || typeof body.q !== 'string' || body.q.length > 120 ||
          (body.location != null && (typeof body.location !== 'string' || body.location.length > 120))) return json(empty);
      const q = body.q.trim();
      const location = (body.location || '').trim();
      const page = body.page ?? 1;
      if (!q || /[\x00-\x1f\x7f]/.test(q + location) || !Number.isInteger(page) || page < 1 || page > 10) return json(empty);

      // Local burst protection; the provider still owns the account-wide quota.
      const bucket = Math.floor(now() / minute);
      if (bucket !== windowStart) { limits.clear(); windowStart = bucket; }
      const count = limits.get(ip) || 0;
      if (count >= 6 || (!count && limits.size >= maxClients)) return json(empty);
      limits.set(ip, count + 1);

      const jobs = await search({
        key, q, location, page, ip, userAgent: userAgent.slice(0, 512),
        fetchImpl, signal: AbortSignal.timeout(5000),
      });
      return json({ jobs });
    } catch {
      // Upstream errors may include keys or visitor data. Return only an empty list.
      return json(empty);
    }
  };
}
