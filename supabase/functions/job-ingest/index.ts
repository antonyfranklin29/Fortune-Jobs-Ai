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
// Optional overrides: ADZUNA_LIMIT_MINUTE/DAY/WEEK/MONTH, and ADZUNA_LIMIT_TOTAL
// for a lifetime cap (a test plan's remaining calls; unset means no lifetime cap). Defaults follow
// Adzuna's published standard limits. Account-specific limits may be lower or
// higher and must be confirmed before scheduling. The provider enforces its own limits; these
// only stop the worker from spending calls it knows it does not have.
//
// Two modes:
//   cells (default)  one role in one state per request — targeted top-ups.
//   feed             {"mode":"feed","feed":"adzuna-us-it"} — every U.S. listing
//                    in a category, newest first, classified into role and state.
//                    One request returns up to 50 listings from anywhere in the
//                    country, so it covers 18 roles × 51 regions far more cheaply.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as L from "./lib.mjs";
import { ROLES, REGIONS } from "./config.mjs";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INGEST_SECRET = Deno.env.get("INGEST_SECRET") ?? "";
const APP_ID        = Deno.env.get("ADZUNA_APP_ID") ?? "";
const APP_KEY       = Deno.env.get("ADZUNA_APP_KEY") ?? "";

// Read on every call, so a changed allowance takes effect without a redeploy.
// ADZUNA_LIMIT_TOTAL caps every request ever made to the source. Set it to the
// remaining allowance of a test plan; leave it unset on a plan with no lifetime cap.
function limits() {
  // An unreadable value fails closed: it allows no calls rather than unlimited ones.
  const num = (k: string, d: number | null) => {
    const v = Deno.env.get(k);
    if (v === undefined || v === "") return d;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    minute: num("ADZUNA_LIMIT_MINUTE", 25) as number,
    day:    num("ADZUNA_LIMIT_DAY", 250) as number,
    week:   num("ADZUNA_LIMIT_WEEK", 1000) as number,
    month:  num("ADZUNA_LIMIT_MONTH", 2500) as number,
    total:  num("ADZUNA_LIMIT_TOTAL", null),
  };
}
// A 50-call run with retries can exceed 15 minutes. Keep its reservation active
// for longer than the worst bounded request/retry cycle so a later run cannot
// reclaim its slot while it is still making provider calls.
const STALE_RUN_MS     = 2 * 60 * 60_000;
const RUN_HARD_CAP     = 50;      // never more than this many requests in one run
const SPACING_MS       = Number(Deno.env.get("INGEST_SPACING_MS") ?? 2600);  // stays under 25/minute
const MAX_ATTEMPTS     = 3;
const REQUEST_TIMEOUT  = 15_000;
const REFRESH_HOURS    = 6 * 24;
const FRESH_DAYS       = ROLES.fresh_days ?? 30;

type Role = { id: string; name: string; query: string; review: string; inc: RegExp[]; exc: RegExp[] };
const roles = L.compileRoles(ROLES) as Role[];
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
// the URL is never logged or returned. No user data is ever added.
async function fetchAdzuna(page: number, params: Record<string, string>) {
  const u = new URL(`https://api.adzuna.com/v1/api/jobs/us/search/${page}`);
  u.searchParams.set("app_id", APP_ID);
  u.searchParams.set("app_key", APP_KEY);
  u.searchParams.set("results_per_page", String(L.ADZUNA_PER_PAGE));
  u.searchParams.set("location0", "US");
  u.searchParams.set("sort_by", "date");
  u.searchParams.set("content-type", "application/json");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (r.status === 429 || r.status >= 500) return { retry: true, status: r.status };
  if (!r.ok) return { retry: false, status: r.status };
  const body = await r.json().catch(() => null);
  if (!body || !Array.isArray(body.results)) return { retry: true, status: 0 };
  return { ok: true, count: Number(body.count) || 0, results: body.results };
}
const fetchPage = (roleQuery: string, regionName: string, page: number, maxDaysOld: number) =>
  fetchAdzuna(page, { title_only: roleQuery, location1: regionName, max_days_old: String(maxDaysOld) });

type Page = { ok?: boolean; retry?: boolean; status?: number; count?: number; results?: unknown[] };
class SpendRecordError extends Error {}
async function fetchWithRetry(get: () => Promise<Page>, spend: () => boolean): Promise<Page | null> {
  let page: Page | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (!spend()) break;
    try { page = await get(); }
    catch (e) {
      if (e instanceof SpendRecordError) throw e;
      page = { retry: true, status: 0 };
    }
    if (page.ok || !page.retry) break;
    await sleep(L.backoffMs(attempt + 1));
  }
  await sleep(SPACING_MS);
  return page;
}

async function budgetFor(requested: number) {
  const used = await rpc("ingest_budget_used", { p_source: L.SOURCE_ADZUNA });
  const lim = limits();
  const caps = [lim.minute - used.minute, lim.day - used.day, lim.week - used.week, lim.month - used.month];
  if (lim.total !== null) caps.push(lim.total - Number(await rpc("ingest_total_used", { p_source: L.SOURCE_ADZUNA })));
  return { used, budget: Math.max(0, Math.min(requested, ...caps)) };
}

// Reserve each provider request before it is sent. A failed ledger write blocks
// the request; an interrupted run can only overcount, never silently overspend.
async function recordSpend(runId: number | null, requestsUsed: number) {
  if (runId === null) return;
  try {
    const response = await db(`/rest/v1/ingest_runs?id=eq.${runId}`, { method: "PATCH", headers: { prefer: "return=minimal" },
      body: JSON.stringify({ requests_used: requestsUsed }) });
    if (!response.ok) throw new Error(`ledger returned ${response.status}`);
  } catch { throw new SpendRecordError("provider allowance ledger unavailable"); }
}

// A run that never recorded its end (the worker stopped, or the final write was
// lost) is closed as failed. Its calls were already recorded, so they still count.
async function closeInterruptedRuns() {
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  await db(`/rest/v1/ingest_runs?source=eq.${L.SOURCE_ADZUNA}&status=eq.running&started_at=lt.${cutoff}`, {
    method: "PATCH", headers: { prefer: "return=minimal" },
    body: JSON.stringify({ status: "failed", finished_at: new Date().toISOString(),
                           note: "interrupted: no completion recorded" }) }).catch(() => {});
}

// Claim a run before anything is spent. Of any runs in progress, the lowest id
// proceeds and the others are refused, so two simultaneous starts cannot both
// read the same remaining allowance and both spend it.
async function claimRun(note: string): Promise<{ id: number } | { conflict: true }> {
  await closeInterruptedRuns();
  const id = await startRun(note);
  const since = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const r = await db(`/rest/v1/ingest_runs?source=eq.${L.SOURCE_ADZUNA}&status=eq.running&started_at=gt.${since}&id=lt.${id}&select=id`);
  const earlier = r.ok ? await r.json() : null;
  if (!earlier || earlier.length) {
    await finishRun(id, { status: "blocked", note: "superseded: another run was already in progress" });
    return { conflict: true };
  }
  return { id };
}

// ── nationwide feed ───────────────────────────────────────────────────────────
// Each run: (1) the HEAD — newest pages until we reach listings already seen,
// so new postings arrive within a day; (2) the PASS — resume walking the whole
// window from where the last run stopped. When a pass reaches the end without
// truncation, listings the feed ingested but this pass never saw are closed.
async function runFeed(body: Record<string, unknown>): Promise<Response> {
  const feedId = String(body.feed ?? "adzuna-us-it");
  const feeds = (ROLES.feeds ?? {}) as Record<string, { source: string; category: string; window_days: number; roles: string[] }>;
  const feed = feeds[feedId];
  if (!feed) return json({ status: "rejected", reason: "unknown_feed" }, 400);
  const scope = new Set(feed.roles);
  const dryRun = body.dry_run === true;
  const requested = Math.max(0, Math.min(RUN_HARD_CAP, Number(body.budget ?? 10) || 0));
  const fixture = dryRun && Array.isArray(body.fixture_pages) ? body.fixture_pages as { count: number; results: unknown[] }[] : null;

  if (!fixture && (!APP_ID || !APP_KEY)) {
    if (!dryRun) {
      const id = await startRun(`blocked: Adzuna credentials not configured (${feedId})`).catch(() => null);
      if (id) await finishRun(id, { status: "blocked" });
    }
    return json({ status: "blocked", reason: "adzuna_credentials_missing",
      message: "Adzuna API access is not active. The catalogue was not touched." });
  }
  const claim = dryRun ? null : await claimRun(`feed ${feedId}`);
  if (claim && "conflict" in claim) return json({ status: "rejected", reason: "run_in_progress" }, 409);
  const runId = claim ? claim.id : null;

  const { used, budget } = fixture ? { used: null, budget: requested } : await budgetFor(requested);
  const stR = await db(`/rest/v1/ingest_feeds?feed=eq.${feedId}&select=*`);
  const saved = stR.ok ? (await stR.json())[0] ?? null : null;
  const st = {
    pass_started_at: saved?.pass_started_at ?? null as string | null,
    next_page: saved?.next_page ?? 1,
    watermark: saved?.watermark ?? null as string | null,
    passes_completed: saved?.passes_completed ?? 0,
  };
  if (budget === 0) {
    if (runId !== null) await finishRun(runId, { status: "blocked", note: `blocked: provider allowance exhausted (${feedId})` });
    return json({ status: "blocked", reason: "allowance_exhausted", used });
  }

  const startedAt = new Date();
  const passStarted = st.pass_started_at ?? startedAt.toISOString();
  const fetchedAt = startedAt.toISOString();
  const params = { category: feed.category, max_days_old: String(feed.window_days) };
  let requestsUsed = 0, fetched = 0, fixtureIdx = 0;
  const wm = st.watermark ? Date.parse(st.watermark) : null;
  let newestMs: number | null = wm, reportedCount = 0;
  const rejected: Record<string, number> = {};
  const rows: Record<string, unknown>[] = [];
  const spend = () => (requestsUsed < budget ? (requestsUsed++, true) : false);
  const get = (page: number) => async (): Promise<Page> => {
    if (fixture) return { ok: true, ...(fixture[fixtureIdx++] ?? { count: 0, results: [] }) };
    await recordSpend(runId, requestsUsed);
    return fetchAdzuna(page, params);
  };

  const take = (results: unknown[]) => {
    let fresh = 0;
    for (const raw of results) {
      // Compare instants, not strings: the stored watermark comes back from
      // Postgres as "+00:00" while Adzuna sends "Z".
      const t = Date.parse((raw as { created?: string })?.created ?? "");
      if (Number.isFinite(t) && t <= Date.now() + 3600_000) {
        if (wm !== null && t > wm) fresh++;
        if (newestMs === null || t > newestMs) newestMs = t;
      }
      const n = L.normalizeAdzunaFeed(raw, { roles, scope, feed: feedId, idx, fetchedAt }) as { reject?: string; row?: Record<string, unknown> };
      if (n.reject) rejected[n.reject] = (rejected[n.reject] ?? 0) + 1; else rows.push(n.row!);
    }
    fetched += results.length;
    return fresh;
  };

  let error: string | null = null, outcome: "more" | "end" | "truncated" = "more";
  let headPages = 0, newSinceWatermark = 0, page = 1, headReached = true;

  // (1) head — only when a pass is mid-way; a fresh pass starts at page 1 anyway.
  if (st.next_page > 1 && st.watermark) {
    headReached = false;
    while (true) {
      const p = await fetchWithRetry(get(page), spend);
      if (!p?.ok) { if (p) error = `source_${p.status}`; break; }
      headPages = page; reportedCount = p.count ?? reportedCount;
      const fresh = take(p.results!);
      newSinceWatermark += fresh;
      if (fresh < p.results!.length || L.pageOutcome({ page, results: p.results!.length, count: p.count ?? 0 }) !== "more") { headReached = true; break; }
      page++;
    }
  }

  // (2) pass
  let passPage = L.resumePage({ nextPage: st.next_page, headPages, newSinceWatermark });
  let lastDone = passPage - 1;
  while (!error && requestsUsed < budget) {
    const p = await fetchWithRetry(get(passPage), spend);
    if (!p) break;                                   // budget ran out
    if (!p.ok) { error = `source_${p.status}`; break; }
    reportedCount = p.count ?? reportedCount;
    take(p.results!);
    lastDone = passPage;
    outcome = L.pageOutcome({ page: passPage, results: p.results!.length, count: p.count ?? 0 });
    if (outcome !== "more") break;
    passPage++;
  }

  const unique = L.dedupe(rows as never[]);
  let written = { inserted: 0, updated: 0, rejected: 0, conflicts: 0 };
  let closed = 0, closeError: string | null = null;

  if (!dryRun) {
    let writeFailed = false;
    for (let i = 0; i < unique.length; i += 500) {
      try {
        const w = await rpc("ingest_upsert_jobs", { p_rows: unique.slice(i, i + 500) });
        written = { inserted: written.inserted + w.inserted, updated: written.updated + w.updated,
                    rejected: written.rejected + w.rejected, conflicts: written.conflicts + w.conflicts };
      } catch { writeFailed = true; }
    }
    if (writeFailed) error = error ?? "write_failed";

    const next: Record<string, unknown> = { feed: feedId, source: feed.source, updated_at: new Date().toISOString() };
    // The cursor and watermark move only past listings that were actually stored.
    // After a failed write they stay where they were, so the next run fetches the
    // same pages again instead of skipping them.
    if (!writeFailed) {
      // If the head ran out of budget before reaching the old watermark, keep it,
      // so the next run's head covers the gap instead of skipping it.
      Object.assign(next, { last_count: reportedCount || null,
        watermark: headReached && newestMs !== null ? new Date(newestMs).toISOString() : st.watermark });
      if (outcome === "end" && !error) {
        // Complete pass: only now may unseen feed listings be retired.
        try { closed = await rpc("ingest_close_feed_unseen", { p_feed: feedId, p_pass_started: passStarted }); }
        catch (e) { closeError = "close_refused"; }
        Object.assign(next, { pass_started_at: null, next_page: 1, passes_completed: st.passes_completed + 1,
                              last_pass_completed_at: new Date().toISOString() });
      } else if (outcome === "truncated") {
        // The provider stopped returning pages before its reported total. Never
        // treat that as complete; restart the pass and surface it.
        error = error ?? "provider_truncated";
        Object.assign(next, { pass_started_at: null, next_page: 1 });
      } else {
        Object.assign(next, { pass_started_at: passStarted, next_page: Math.max(1, lastDone + 1) });
      }
    }
    if (error) Object.assign(next, { last_failure_at: new Date().toISOString(), last_error: error });
    else Object.assign(next, { last_success_at: new Date().toISOString() });
    await db("/rest/v1/ingest_feeds", { method: "POST", headers: { prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(next) }).catch(() => {});
  }

  const status = error ? (fetched ? "partial" : "failed") : "succeeded";
  if (runId) await finishRun(runId, { status, requests_used: requestsUsed, fetched,
    inserted: written.inserted, updated: written.updated, closed, rejected });

  const byCell: Record<string, number> = {};
  for (const r of unique as Record<string, string>[]) byCell[`${r.canonical_role}:${r.state_code}`] = (byCell[`${r.canonical_role}:${r.state_code}`] ?? 0) + 1;
  return json({
    status: dryRun ? `dry_run:${status}` : status, feed: feedId, error, close_error: closeError,
    budget, used_before: used, requests_used: requestsUsed, fetched, kept: unique.length, rejected, written, closed,
    pass: { outcome, head_pages: headPages, resumed_at: L.resumePage({ nextPage: st.next_page, headPages, newSinceWatermark }),
            last_page: lastDone, source_reported: reportedCount, completed: outcome === "end" && !error },
    kept_by_role_state: byCell,
    sample: dryRun ? unique.slice(0, 5).map((r: Record<string, unknown>) => ({ id: r.source_listing_id, title: r.job_title, role: r.canonical_role, state: r.state_code })) : undefined,
  });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ status: "rejected", reason: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !INGEST_SECRET) return json({ status: "error", reason: "worker_not_configured" }, 503);
  if (!safeEqual(req.headers.get("x-ingest-secret") ?? "", INGEST_SECRET)) {
    return json({ status: "rejected", reason: "unauthorised" }, 401);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* defaults */ }
  try {
    if (body.mode === "feed") return await runFeed(body);
    return await runCells(body);
  } catch (e) {
    if (e instanceof SpendRecordError) return json({ status: "blocked", reason: "allowance_ledger_unavailable" }, 503);
    throw e;
  }
}

async function runCells(body: Record<string, unknown>): Promise<Response> {
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
  const claim = dryRun ? null : await claimRun(`${runRoles.map((r) => r.id).join(",")} × ${runRegions.map((r: { code: string }) => r.code).join(",")}`);
  if (claim && "conflict" in claim) return json({ status: "rejected", reason: "run_in_progress" }, 409);
  const runId = claim ? claim.id : null;

  // Budget: the smallest remaining allowance across every provider window.
  const bud = await budgetFor(requested);
  const used = bud.used;
  const budget = fixture ? requested : bud.budget;

  // Count only this provider's eligible listings. Other sources may already
  // serve a visitor but cannot certify that an Adzuna sweep was complete.
  const cov = await db(`/rest/v1/ingest_source_coverage?source=eq.${L.SOURCE_ADZUNA}&select=role_id,state,fresh_distinct&role_id=in.(${runRoles.map((r) => r.id).join(",")})&state=in.(${runRegions.map((r: { code: string }) => r.code).join(",")})`);
  const due = await db(`/rest/v1/ingest_cells?source=eq.${L.SOURCE_ADZUNA}&select=canonical_role,state_code,next_due_at,consecutive_failures,last_full_sweep_at,last_attempt_at`);
  if (!cov.ok || !due.ok) {
    if (runId !== null) await finishRun(runId, { status: "blocked", note: "provider coverage unavailable" });
    return json({ status: "blocked", reason: "provider_coverage_unavailable" }, 503);
  }
  type Cell = { fresh: number; nextDueAt: string | null; failures: number; lastFullSweepAt: string | null; lastAttemptAt: string | null };
  const cells = new Map<string, Cell>();
  for (const c of await cov.json()) cells.set(`${c.role_id}:${c.state}`, { fresh: c.fresh_distinct, nextDueAt: null, failures: 0, lastFullSweepAt: null, lastAttemptAt: null });
  for (const c of await due.json()) {
    const k = `${c.canonical_role}:${c.state_code}`;
    const cur = cells.get(k) ?? { fresh: 0, nextDueAt: null, failures: 0, lastFullSweepAt: null, lastAttemptAt: null };
    cells.set(k, { ...cur, nextDueAt: body.force === true ? null : c.next_due_at,
                   failures: c.consecutive_failures, lastFullSweepAt: c.last_full_sweep_at,
                   lastAttemptAt: c.last_attempt_at });
  }

  const { plan, deferred } = L.planRequests({ cells, roles: runRoles, regions: runRegions,
    target: ROLES.target_per_region ?? 100, budget, perPage: L.ADZUNA_PER_PAGE });

  if (!plan.length) {
    if (runId !== null) {
      await finishRun(runId, { status: budget === 0 ? "blocked" : "succeeded", deferred_cells: deferred.length,
                               note: budget === 0 ? "blocked: provider allowance exhausted" : "nothing due" });
    }
    return json({ status: budget === 0 ? "blocked" : "nothing_due", budget, used, deferred });
  }

  const sweepStarted = new Date();
  const fetchedAt = sweepStarted.toISOString();
  let requestsUsed = 0, fetched = 0;
  const rejected: Record<string, number> = {};
  const rows: Record<string, unknown>[] = [];
  const cellResult = new Map<string, { ok: boolean; error: string | null; complete: boolean; pages: number; reported: number }>();
  const plannedPages = new Map<string, { mode: string; requestedPages: number }>();
  for (const s of plan) {
    const k = `${s.role}:${s.region}`;
    plannedPages.set(k, { mode: s.mode, requestedPages: s.requestedPages });
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
      await recordSpend(runId, requestsUsed);
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
      const n = L.normalizeAdzuna(raw, { role, regionCode: region.code, idx, fetchedAt }) as { reject?: string; row?: Record<string, unknown> };
      if (n.reject) rejected[n.reject] = (rejected[n.reject] ?? 0) + 1; else rows.push(n.row!);
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
      const fullSwept = s.complete || (planned?.mode === "fill" && s.pages >= planned.requestedPages);
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
