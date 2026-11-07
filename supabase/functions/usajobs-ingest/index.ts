// usajobs-ingest: federal IT and data jobs from the official USAJOBS Search API.
// Callable only with the INGEST_SECRET header (the database scheduler). Deploy with --no-verify-jwt.
// Secret: USAJOBS_API_KEY. The API also requires the registered email as the User-Agent; that
// address is public (info@fortunejobsai.com), so it lives here rather than in a secret.
// {"dry_run":true} counts and samples without writing. Jobs no longer listed are closed only after
// every search page was read and stored, so an outage never empties the catalogue.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as L from "./core.mjs";
import { ROLES, REGIONS } from "./config.mjs";
import { PAGE_SIZE, SERIES, normalize, searchUrl } from "./usa.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INGEST_SECRET = Deno.env.get("INGEST_SECRET") ?? "";
const API_KEY = Deno.env.get("USAJOBS_API_KEY") ?? Deno.env.get("usajobs_api_key") ?? "";
const EMAIL = "info@fortunejobsai.com";
const MAX_PAGES = 4; // per series per run
const roles = L.compileRoles(ROLES), idx = L.regionIndex(REGIONS);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const db = (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}${path}`, {
  ...init,
  headers: { "content-type": "application/json", apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, ...(init.headers ?? {}) },
  signal: AbortSignal.timeout(20_000),
});

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SERVICE_KEY || !safeEqual(req.headers.get("x-ingest-secret") ?? "", INGEST_SECRET)) return json({ error: "unauthorised" }, 401);
  if (!API_KEY) return json({ status: "blocked", reason: "USAJOBS_API_KEY is not set" }, 503);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const dryRun = body.dry_run === true;
  const fetchedAt = new Date().toISOString();

  const rows: Record<string, unknown>[] = [], rejected: Record<string, number> = {};
  let listed = 0, requests = 0, complete = true;
  const errors: string[] = [];
  for (const series of SERIES) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      requests++;
      let data;
      try {
        const r = await fetch(searchUrl(series, page), { headers: { Host: "data.usajobs.gov", "User-Agent": EMAIL, "Authorization-Key": API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
        if (!r.ok) { errors.push(`${series}:${page}:${r.status}`); complete = false; await r.body?.cancel(); break; }
        data = await r.json();
      } catch { errors.push(`${series}:${page}:network`); complete = false; break; }
      const items = data?.SearchResult?.SearchResultItems ?? [];
      const total = Number(data?.SearchResult?.SearchResultCountAll ?? 0);
      listed += items.length;
      for (const it of items) {
        const n = normalize(it, { roles, idx, fetchedAt }) as { reject?: string; row?: Record<string, unknown> };
        if (n.row) rows.push(n.row); else rejected[n.reject!] = (rejected[n.reject!] ?? 0) + 1;
      }
      if (items.length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
      if (page === MAX_PAGES) complete = false; // more pages than one run reads
    }
  }

  const unique = L.dedupe(rows as never[]);
  let written = { inserted: 0, updated: 0, rejected: 0, conflicts: 0 }, closed = 0, writeFailed = false;
  if (!dryRun) {
    for (let i = 0; i < unique.length; i += 500) {
      const r = await db("/rest/v1/rpc/ingest_upsert_jobs", { method: "POST", body: JSON.stringify({ p_rows: unique.slice(i, i + 500) }) }).catch(() => null);
      if (!r?.ok) { writeFailed = true; continue; }
      const w = await r.json();
      written = { inserted: written.inserted + w.inserted, updated: written.updated + w.updated, rejected: written.rejected + w.rejected, conflicts: written.conflicts + w.conflicts };
    }
    if (complete && !writeFailed) {
      const c = await db(`/rest/v1/pre_scraped_jobs?source=eq.usajobs&closed_at=is.null&last_seen_at=lt.${encodeURIComponent(fetchedAt)}`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ closed_at: new Date().toISOString() }) }).catch(() => null);
      if (c?.ok) closed = (await c.json()).length;
    }
  }
  return json({
    status: dryRun ? "dry_run" : "done", requests, listed, kept: unique.length, rejected, written, closed, complete, write_failed: writeFailed, errors,
    sample: dryRun ? unique.slice(0, 8).map((r: Record<string, unknown>) => ({ title: r.job_title, company: r.company, state: r.state_code, salary: r.salary, url: r.apply_url })) : undefined,
  });
});
