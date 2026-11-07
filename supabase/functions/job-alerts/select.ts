// Pure helpers for job-alerts (no network), so tests can import them.
export type Profile = { full_name?: string | null; current_title?: string | null; preferred_locations?: string[] | null; saved_filters?: Record<string, string> | null };
export type Job = { job_title: string; company: string; location?: string | null; work_mode?: string | null; apply_url: string; posted_at: string };
export type AlertQuery = { path: string; tokens: string[]; places: string[]; since: number };

const STATES: Record<string, string> = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY" };
const STOP = new Set(["a", "an", "and", "the", "of", "for", "to", "in", "on", "at", "with", "or", "jobs", "job", "role", "senior", "junior", "sr", "jr", "remote"]);
const DAY = 86400000;

export const tokensOf = (text: string) => String(text || "").toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ").split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t));

/** What to look for, from the profile: role (title) plus area. Null when either is missing. */
export function alertQuery(p: Profile, frequency: "daily" | "weekly", now = Date.now()): AlertQuery | null {
  const f = p.saved_filters || {};
  const title = String(p.current_title || f.text || f.q || "").trim();
  const area = String(f.location || f.city || f.region || (p.preferred_locations || [])[0] || "").trim();
  const tokens = tokensOf(title).slice(0, 4);
  if (!tokens.length || !area) return null;
  // "Newark, New Jersey" → newark, new jersey, ", nj"; "NJ" → new jersey, ", nj".
  const places: string[] = [];
  for (const part of area.toLowerCase().split(",").map((x) => x.trim()).filter(Boolean)) {
    const name = STATES[part] ? part : Object.keys(STATES).find((n) => STATES[n].toLowerCase() === part);
    if (name) places.push(name, `, ${STATES[name].toLowerCase()}`); else if (part.length > 2) places.push(part);
  }
  if (!places.length) return null;
  const since = now - (frequency === "daily" ? 1.5 * DAY : 7 * DAY);
  const or = `(${tokens.map((t) => `search_text.ilike.*${t.replace(/[*,()]/g, "")}*`).join(",")})`;
  const path = `pre_scraped_jobs?select=job_title,company,location,work_mode,apply_url,posted_at&closed_at=is.null&country=eq.${encodeURIComponent((f.country || "us").toLowerCase())}&posted_at=gte.${encodeURIComponent(new Date(since).toISOString())}&or=${encodeURIComponent(or)}&order=posted_at.desc&limit=200`;
  return { path, tokens, places, since };
}

const BARE_ADZUNA = /^https:\/\/(?:www\.)?adzuna\.com\/land\/ad\/(\d+)\/?$/i;
export function applyUrl(url: string) {
  const m = BARE_ADZUNA.exec(String(url || "").trim());
  const fixed = m ? `https://www.adzuna.com/details/${m[1]}` : url;
  try { const u = new URL(fixed); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; }
}

/** Up to 5 recent jobs whose title has every role word and that are in the area (or remote). */
export function pickJobs(rows: Job[], q: AlertQuery, now = Date.now()): Job[] {
  const seen = new Set<string>();
  const out: Job[] = [];
  for (const j of rows || []) {
    const posted = Date.parse(j.posted_at), url = applyUrl(j.apply_url);
    if (!url || !Number.isFinite(posted) || posted > now + 3600000 || posted < q.since) continue;
    const title = String(j.job_title || "").toLowerCase();
    if (!q.tokens.every((t) => title.includes(t))) continue;
    const loc = String(j.location || "").toLowerCase();
    const remote = /remote/i.test(String(j.work_mode || "")) || /remote/.test(loc);
    if (!remote && !q.places.some((p) => loc.includes(p))) continue;
    const key = `${title}|${String(j.company || "").toLowerCase()}`;
    if (seen.has(key) || seen.has(url)) continue;
    seen.add(key); seen.add(url);
    out.push({ ...j, apply_url: url });
    if (out.length === 5) break;
  }
  return out;
}

export const campaignFor = (frequency: "daily" | "weekly", now = Date.now()) => `${frequency}-${new Date(now).toISOString().slice(0, 10)}`;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** Same signed unsubscribe token the email-preferences function verifies. */
export async function unsubscribeToken(userId: string, secret: string) {
  const payload = b64url(new TextEncoder().encode(userId));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${b64url(sig)}`;
}
