// Scheduled job ingestion worker.
//
// Fetches listings for (canonical role × U.S. region) cells from an approved
// source, keeps only listings whose title and location evidence genuinely match
// the cell, and upserts them through the database's backend-only function.
// All rules about what counts live in lib.mjs and are unit-tested.
//
// Safety properties:
//   - Callable only with INGEST_SECRET; never by a browser.
//   - Provider credentials stay in server secrets and are never logged or returned.
//   - Requests are bounded per run AND against the provider's minute/day/week/
//     month allowances, summed across runs from ingest_runs.
//   - A failed or truncated sweep never closes listings, so a source outage
//     cannot empty the catalogue. Only a complete enumeration may close.
//   - dry_run computes everything and writes nothing.
//   - No user data (résumé, identity, search history) is ever sent to a source.
//
// Secrets: INGEST_SECRET, ADZUNA_APP_ID, ADZUNA_APP_KEY.
// Optional overrides: ADZUNA_LIMIT_MINUTE/DAY/WEEK/MONTH (defaults are the
// provider's published free allowance: 25 / 250 / 1000 / 2500).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as L from "./lib.mjs";
import { ROLES, REGIONS } from "./config.mjs";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INGEST_SECRET = Deno.env.get("INGEST_SECRET") ?? "";
const APP_ID        = Deno.env.get("ADZUNA_APP_ID") ?? "";
const APP_KEY       = Deno.env.get("ADZUNA_APP_KEY") ?? "";

const LIMITS = {
  minute: Number(Deno.env.get("ADZUNA_LIMIT_MINUTE") ?? 25),
  day:    Number(Deno.env.get("ADZUNA_LIMIT_DAY")    ?? 250),
  week:   Number(Deno.env.get("ADZUNA_LIMIT_WEEK")   ?? 1000),
  month:  Number(Deno.env.get("ADZUNA_LIMIT_MONTH")  ?? 2500),
};
const RUN_HARD_CAP     = 50;      // never more than this many requests in one run
const SPACING_MS       = Number(Deno.env.get("INGEST_SPACING_MS") ?? 2600);  // stays under 25/minute
const MAX_ATTEMPTS     = 3;
const REQUEST_TIMEOUT  = 15_000;
const REFRESH_HOURS    = 24;
const FRESH_DAYS       = ROLES.fresh_days ?? 30;

const roles = L.compileRoles(ROLES);
const idx   = L.regionIndex(REGIONS);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", apikey: SERVICE_KEY,
               authorization: `Bearer ${SERVICE_KEY}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
}
async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await db(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`rpc ${fn}: ${r.status}`);
  return r.json();
}

// Constant-time comparison so the secret check does not leak by timing.
function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startRun(note: string) {
  const r = await db("/rest/v1/ingest_runs", { method: "POST", headers: { prefer: "return=representation" },
    body: JSON.stringify({ source: L.SOURCE_ADZUNA, note }) });
  if (!r.ok) throw new Error(`run start: ${r.status}`);
  return (await r.json())[0].id as number;
}
async function finishRun(id: number, patch: Record<string, unknown>) {
  await db(`/rest/v1/ingest_runs?id=eq.${id}`, { method: "PATCH",
    body: JSON.stringify({ ...patch, finished_at: new Date().toISOString() }) }).catch(() => {});
}
async function recordCell(role: string, region: string, ok: boolean, error: string | null, failures: number, fullSwept: boolean) {
  const now = Date.now();
  const nextDue = ok ? now + REFRESH_HOURS * 3600_000
                     : now + Math.min(24, 2 ** Math.min(failures, 5)) * 3600_000;
  const row: Record<string, unknown> = {
    source: L.SOURCE_ADZUNA, canonical_role: role, state_code: region,
    last_attempt_at: new Date(now).toISOString(), next_due_at: new Date(nextDue).toISOString(),
    consecutive_failures: ok ? 0 : failures,
  };
  if (ok) row.last_success_at = row.last_attempt_at; else { row.last_failure_at = row.last_attempt_at; row.last_error = error?.slice(0, 200) ?? null; }
  if (ok && fullSwept) row.last_full_sweep_at = row.last_attempt_at;
  await db("/rest/v1/ingest_cells", { method: "POST",
    headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify(row) }).catch(() => {});
}

// One Adzuna page. Credentials go in the query string as the API requires, and
// the URL is never logged or returned.
async function fetchPage(roleQuery: string, regionName: string, page: number, maxDaysOld: number) {
  const u = new URL(`https://api.adzuna.com/v1/api/jobs/us/search/${page}`);
  u.searchParams.set("app_id", APP_ID);
  u.searchParams.set("app_key", APP_KEY);
  u.searchParams.set("results_per_page", String(L.ADZUNA_PER_PAGE));
  u.searchParams.set("title_only", roleQuery);
  u.searchParams.set("location0", "US");
  u.searchParams.set("location1", regionName);
  u.searchParams.set("max_days_old", String(maxDaysOld));
  u.searchParams.set("sort_by", "date");
  u.searchParams.set("content-type", "application/json");
  const r = await fetch(u, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (r.status === 429 || r.status >= 500) return { retry: true, status: r.status };
  if (!r.ok) return { retry: false, status: r.status };
  const body = await r.json().catch(() => null);
  if (!body || !Array.isArray(body.results)) return { retry: true, status: 0 };
  return { ok: true, count: Number(body.count) || 0, results: body.results };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ status: "rejected", reason: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !INGEST_SECRET) return json({ status: "error", reason: "worker_not_configured" }, 503);
  if (!safeEqual(req.headers.get("x-ingest-secret") ?? "", INGEST_SECRET)) {
    return json({ status: "rejected", reason: "unauthorised" }, 401);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const dryRun = body.dry_run === true;
  const wantRoles = Array.isArray(body.roles) ? body.roles.map(String) : ["data-analyst"];
  const wantRegions = Array.isArray(body.regions) ? body.regions.map((s: unknown) => String(s).toUpperCase()) : ["NC", "SC"];
  const runRoles = roles.filter((r) => wantRoles.includes(r.id));
  const runRegions = REGIONS.regions.filter((r: { code: string }) => wantRegions.includes(r.code));
  if (!runRoles.length || !runRegions.length) return json({ status: "rejected", reason: "unknown_role_or_region" }, 400);
  const requested = Math.max(0, Math.min(RUN_HARD_CAP, Number(body.budget ?? 10) || 0));

  // A fixture replaces the network in dry runs only, so the full pipeline can be
  // exercised without credentials and without writing anything.
  const fixture = dryRun && body.fixture && typeof body.fixture === "object" ? body.fixture as Record<string, unknown> : null;

  if (!fixture && (!APP_ID || !APP_KEY)) {
    if (!dryRun) {
      const id = await startRun("blocked: Adzuna credentials not configured").catch(() => null);
      if (id) await finishRun(id, { status: "blocked" });
    }
    return json({ status: "blocked", reason: "adzuna_credentials_missing",
      message: "Adzuna API access is not active. The catalogue was not touched." });
  }

  // Refuse to overlap another live run: budgets and checkpoints assume one writer.
  if (!dryRun) {
    const r = await db(`/rest/v1/ingest_runs?source=eq.${L.SOURCE_ADZUNA}&status=eq.running&started_at=gt.${new Date(Date.now() - 15 * 60_000).toISOString()}&select=id`);
    if (r.ok && (await r.json()).length) return json({ status: "rejected", reason: "run_in_progress" }, 409);
  }

  // Budget: the smallest remaining allowance across every provider window.
  const used = await rpc("ingest_budget_used", { p_source: L.SOURCE_ADZUNA });
  const budget = fixture ? requested : Math.max(0, Math.min(requested,
    LIMITS.minute - used.minute, LIMITS.day - used.day, LIMITS.week - used.week, LIMITS.month - used.month));

  // Current state of each cell, to aim the budget at the biggest shortfalls.
  const cov = await db(`/rest/v1/ingest_coverage?select=role_id,state,fresh_distinct&role_id=in.(${runRoles.map((r) => r.id).join(",")})&state=in.(${runRegions.map((r: { code: string }) => r.code).join(",")})`);
  const due = await db(`/rest/v1/ingest_cells?source=eq.${L.SOURCE_ADZUNA}&select=canonical_role,state_code,next_due_at,consecutive_failures,last_full_sweep_at`);
  type Cell = { fresh: number; nextDueAt: string | null; failures: number; lastFullSweepAt: string | null };
  const cells = new Map<string, Cell>();
  for (const c of (cov.ok ? await cov.json() : [])) cells.set(`${c.role_id}:${c.state}`, { fresh: c.fresh_distinct, nextDueAt: null, failures: 0, lastFullSweepAt: null });
  for (const c of (due.ok ? await due.json() : [])) {
    const k = `${c.canonical_role}:${c.state_code}`;
    const cur = cells.get(k) ?? { fresh: 0, nextDueAt: null, failures: 0, lastFullSweepAt: null };
    cells.set(k, { ...cur, nextDueAt: body.force === true ? null : c.next_due_at,
                   failures: c.consecutive_failures, lastFullSweepAt: c.last_full_sweep_at });
  }

  const { plan, deferred } = L.planRequests({ cells, roles: runRoles, regions: runRegions,
    target: ROLES.target_per_region ?? 100, budget, perPage: L.ADZUNA_PER_PAGE });

  if (!plan.length) {
    if (!dryRun) {
      const id = await startRun(budget === 0 ? "blocked: provider allowance exhausted" : "nothing due");
      await finishRun(id, { status: budget === 0 ? "blocked" : "succeeded", deferred_cells: deferred.length });
    }
    return json({ status: budget === 0 ? "blocked" : "nothing_due", budget, used, deferred });
  }

  const runId = dryRun ? null : await startRun(`${runRoles.map((r) => r.id).join(",")} × ${runRegions.map((r: { code: string }) => r.code).join(",")}`);
  const sweepStarted = new Date();
  const fetchedAt = sweepStarted.toISOString();
  let requestsUsed = 0, fetched = 0;
  const rejected: Record<string, number> = {};
  const rows: Record<string, unknown>[] = [];
  const cellResult = new Map<string, { ok: boolean; error: string | null; complete: boolean; pages: number; reported: number }>();
  const plannedPages = new Map<string, { mode: string; pages: number }>();
  for (const s of plan) {
    const k = `${s.role}:${s.region}`;
    plannedPages.set(k, { mode: s.mode, pages: (plannedPages.get(k)?.pages ?? 0) + 1 });
  }

  for (const step of plan) {
    const key = `${step.role}:${step.region}`;
    const state = cellResult.get(key) ?? { ok: true, error: null, complete: false, pages: 0, reported: 0 };
    if (!state.ok || state.complete) { cellResult.set(key, state); continue; }   // stop a failed or exhausted cell

    const role = runRoles.find((r) => r.id === step.role)!;
    const region = idx.byCode.get(step.region)!;
    let page: { ok?: boolean; retry?: boolean; status?: number; count?: number; results?: unknown[] } | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (fixture) { page = { ok: true, count: Number(fixture.count) || 0, results: (fixture.results as unknown[]) ?? [] }; break; }
      if (requestsUsed >= budget) break;
      requestsUsed++;
      try { page = await fetchPage(role.query, region.name, step.page, FRESH_DAYS); }
      catch { page = { retry: true, status: 0 }; }
      if (page.ok || !page.retry) break;
      await sleep(L.backoffMs(attempt + 1));
    }
    if (!fixture) await sleep(SPACING_MS);

    if (!page?.ok) {
      cellResult.set(key, { ...state, ok: false, error: `source_${page?.status ?? "budget"}` });
      continue;
    }
    fetched += page.results!.length;
    for (const raw of page.results!) {
      const n = L.normalizeAdzuna(raw, { role, regionCode: region.code, idx, fetchedAt });
      if (n.reject) rejected[n.reject] = (rejected[n.reject] ?? 0) + 1; else rows.push(n.row);
    }
    const pages = state.pages + 1;
    const enumerated = pages * L.ADZUNA_PER_PAGE >= (page.count ?? 0) || page.results!.length < L.ADZUNA_PER_PAGE;
    cellResult.set(key, { ...state, pages, reported: page.count ?? 0, complete: enumerated });
  }

  const unique = L.dedupe(rows as never[]);
  let written = { inserted: 0, updated: 0, rejected: 0, conflicts: 0 };
  let closed = 0;

  if (!dryRun) {
    for (let i = 0; i < unique.length; i += 500) {
      try {
        const w = await rpc("ingest_upsert_jobs", { p_rows: unique.slice(i, i + 500) });
        written = { inserted: written.inserted + w.inserted, updated: written.updated + w.updated,
                    rejected: written.rejected + w.rejected, conflicts: written.conflicts + w.conflicts };
      } catch (e) {
        for (const [k, s] of cellResult) cellResult.set(k, { ...s, ok: false, error: `write_failed` });
      }
    }
    for (const [key, s] of cellResult) {
      const [role, region] = key.split(":");
      // Only a complete, successful enumeration may close unseen listings.
      if (s.ok && s.complete) {
        try { closed += await rpc("ingest_close_unseen", { p_source: L.SOURCE_ADZUNA, p_role: role, p_state: region, p_sweep_started: sweepStarted.toISOString() }); }
        catch { /* leave listings open rather than close on an error */ }
      }
      const planned = plannedPages.get(key);
      const fullSwept = s.complete || (planned?.mode === "fill" && s.pages >= planned.pages);
      await recordCell(role, region, s.ok, s.error, s.ok ? 0 : (cells.get(key)?.failures ?? 0) + 1, fullSwept);
    }
  }

  const failedCells = [...cellResult.values()].filter((s) => !s.ok).length;
  const status = failedCells === 0 ? (deferred.length ? "partial" : "succeeded")
               : failedCells === cellResult.size ? "failed" : "partial";
  if (runId) await finishRun(runId, { status, requests_used: requestsUsed, fetched,
    inserted: written.inserted, updated: written.updated, closed, rejected, deferred_cells: deferred.length });

  return json({
    status: dryRun ? `dry_run:${status}` : status,
    budget, used_before: used, requests_used: requestsUsed, fetched,
    kept: unique.length, rejected, written, closed,
    cells: Object.fromEntries([...cellResult].map(([k, s]) => [k, { ok: s.ok, complete: s.complete, pages: s.pages, source_reported: s.reported, error: s.error }])),
    deferred,
    sample: dryRun ? unique.slice(0, 5).map((r: Record<string, unknown>) => ({ id: r.source_listing_id, title: r.job_title, state: r.state_code, posted_at: r.posted_at })) : undefined,
  });
}

// The test harness imports handler() directly; production serves it.
if (!(globalThis as Record<string, unknown>).__INGEST_TEST__) Deno.serve(handler);
