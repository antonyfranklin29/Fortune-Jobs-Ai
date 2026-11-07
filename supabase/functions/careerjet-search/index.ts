// careerjet-search: live Careerjet results for a visitor's search. Careerjet's terms require the
// visitor's own IP address and user agent on every call, so this runs only when a person searches.
// Signed-in users only for now (testing phase). Needs the CAREERJET_API_KEY secret; the key never
// leaves this function. Deploy with --no-verify-jwt: the bearer token is checked below.
const BASE = Deno.env.get("SUPABASE_URL") || "https://hqgakkcxcyspqhnlnscv.supabase.co";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ORIGINS = ["https://fortunejobsai.com", "https://www.fortunejobsai.com"];

const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
export function cleanJob(j: Record<string, unknown>) {
  let url = "";
  try { const u = new URL(String(j.url)); if (u.protocol === "https:") url = u.href; } catch { /* drop */ }
  return url ? { title: clip(j.title, 200), company: clip(j.company, 200), location: clip(j.locations, 200), salary: clip(j.salary, 120), date: clip(j.date, 60), description: clip(j.description, 400), url } : null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = { "Access-Control-Allow-Origin": origin && ORIGINS.includes(origin) ? origin : ORIGINS[0], "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "GET,OPTIONS", Vary: "Origin", "Cache-Control": "no-store" };
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (origin && !ORIGINS.includes(origin)) return json({ error: "Origin not allowed" }, 403);
  const apiKey = Deno.env.get("CAREERJET_API_KEY") || "";
  if (!apiKey) return json({ error: "Careerjet is not switched on." }, 503);
  try {
    const bearer = req.headers.get("Authorization");
    if (!bearer?.startsWith("Bearer ")) return json({ error: "Sign in required" }, 401);
    const check = await fetch(BASE + "/auth/v1/user", { headers: { apikey: KEY, Authorization: bearer }, signal: AbortSignal.timeout(8000) });
    if (!check.ok || !(await check.json())?.id) return json({ error: "Sign in required" }, 401);

    const url = new URL(req.url);
    const keywords = clip(url.searchParams.get("q"), 120), location = clip(url.searchParams.get("location"), 120);
    const size = Math.min(50, Math.max(1, Number(url.searchParams.get("size")) || 20));
    if (!keywords) return json({ error: "Missing search" }, 400);
    const userIp = clip((req.headers.get("x-forwarded-for") || "").split(",")[0], 64);
    const userAgent = clip(req.headers.get("user-agent"), 400);
    if (!userIp || !userAgent) return json({ error: "Missing visitor details" }, 400);

    const q = new URLSearchParams({ locale_code: "en_US", keywords, page_size: String(size), sort: "date", user_ip: userIp, user_agent: userAgent, fragment_size: "300" });
    if (location) q.set("location", location);
    // Careerjet requires the page the search came from, on the registered site (www.fortunejobsai.com).
    const from = req.headers.get("Referer") || "";
    const referer = /^https:\/\/(www\.)?fortunejobsai\.com\//.test(from) ? from.replace("://fortunejobsai.com", "://www.fortunejobsai.com").slice(0, 300) : "https://www.fortunejobsai.com/results.html";
    const r = await fetch("https://search.api.careerjet.net/v4/query?" + q, { headers: { Authorization: "Basic " + btoa(apiKey + ":"), Referer: referer }, signal: AbortSignal.timeout(15000) });
    const raw = await r.text();
    let data: Record<string, any> = {};
    try { data = JSON.parse(raw); } catch { /* not JSON */ }
    if (!r.ok) return json({ error: "Careerjet error", status: r.status, message: clip(data?.message || data?.error || raw, 300), sentIpKind: userIp.includes(":") ? "ipv6" : "ipv4" }, 502);
    if (data.type === "LOCATIONS") return json({ type: "LOCATIONS", message: clip(data.message, 200), locations: (data.locations || []).slice(0, 10).map((l: unknown) => clip(l, 120)) });
    return json({ type: "JOBS", hits: Number(data.hits) || 0, jobs: (data.jobs || []).map(cleanJob).filter(Boolean) });
  } catch {
    return json({ error: "Careerjet is unavailable right now." }, 503);
  }
});
