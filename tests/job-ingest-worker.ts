// End-to-end test of the ingestion worker against an in-memory Supabase and a
// fake Adzuna. No network, no credentials, nothing written to production.
//   deno test --allow-env --import-map=tests/deno/import_map.json tests/job-ingest-worker.ts
import { assert, assertEquals } from "./deno/assert.ts";
import * as L from "../supabase/functions/job-ingest/lib.mjs";
import { ROLES, REGIONS } from "../supabase/functions/job-ingest/config.mjs";

const SB = "https://fake.supabase.test";
Deno.env.set("SUPABASE_URL", SB);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-test-key");
Deno.env.set("INGEST_SECRET", "test-secret-123");
Deno.env.set("INGEST_SPACING_MS", "0");
(globalThis as Record<string, unknown>).__INGEST_TEST__ = true;

const roles = L.compileRoles(ROLES);
const regionCodes = new Set(REGIONS.regions.map((r: { code: string }) => r.code));
const DAY = 86400000;

// ── fake database: mirrors the SQL functions and view ──────────────────────────
type Job = Record<string, any>;
const db = { runs: [] as any[], cells: new Map<string, any>(), jobs: [] as Job[], nextRun: 1, feeds: new Map<string, any>() };

function coverage(role: string, state: string, source = "adzuna") {
  const now = Date.now(), keys = new Set<string>();
  for (const j of db.jobs) {
    if (j.closed_at || j.source !== source || j.canonical_role !== role || j.state_code !== state) continue;
    if (!j.posted_at || now - Date.parse(j.posted_at) > 30 * DAY) continue;
    if (!j.last_seen_at || now - Date.parse(j.last_seen_at) > (j.ingest_feed ? 30 : 7) * DAY) continue;
    keys.add(`${j.job_title}|${j.company ?? ""}|${j.location ?? ""}`.toLowerCase());
  }
  return keys.size;
}
function upsert(rows: Job[]) {
  let inserted = 0, updated = 0, rejected = 0;
  for (const r of rows) {
    if (!r.source || !r.source_listing_id || !r.job_title || !/^https:\/\/[^/\s]+\.[^/\s]+/.test(r.apply_url ?? "")
        || !regionCodes.has(r.state_code) || L.classifyRole(r.job_title, roles) !== r.canonical_role
        || (r.posted_at && Date.parse(r.posted_at) > Date.now() + 3600000)) { rejected++; continue; }
    const hit = db.jobs.filter((j) => (j.source === r.source && j.source_listing_id === r.source_listing_id) || j.apply_url === r.apply_url);
    const now = new Date().toISOString();
    if (hit.length) {
      const { feed, ...rest } = r;
      for (const j of hit) Object.assign(j, { ...rest, ingest_feed: j.ingest_feed ?? feed ?? null, posted_at: [r.posted_at, j.posted_at].filter(Boolean).sort().pop() ?? null,
        company: r.company ?? j.company, last_seen_at: now, closed_at: null });
      updated++;
    } else { const { feed, ...rest } = r; db.jobs.push({ ...rest, ingest_feed: feed ?? null, last_seen_at: now, closed_at: null }); inserted++; }
  }
  return { inserted, updated, rejected, conflicts: 0 };
}
function closeUnseen(a: any) {
  const t = Date.parse(a.p_sweep_started);
  if (!(t > Date.now() - 6 * 3600000 && t <= Date.now())) throw new Error("sweep start must be within the last six hours");
  let n = 0;
  for (const j of db.jobs) if (j.source === a.p_source && j.canonical_role === a.p_role && j.state_code === a.p_state
                                && !j.closed_at && Date.parse(j.last_seen_at) < t) { j.closed_at = new Date().toISOString(); n++; }
  return n;
}
function closeFeedUnseen(a: any) {
  const t = Date.parse(a.p_pass_started);
  if (!(t <= Date.now() && t > Date.now() - 45 * DAY)) throw new Error("pass start must be within the last 45 days");
  const open = db.jobs.filter((j) => j.ingest_feed === a.p_feed && !j.closed_at);
  const stale = open.filter((j) => Date.parse(j.last_seen_at) < t);
  if (open.length > 100 && stale.length > open.length * 0.4) throw new Error("refusing mass close");
  for (const j of stale) j.closed_at = new Date().toISOString();
  return stale.length;
}
function budgetUsed() {
  const now = Date.now(), sum = (ms: number) => db.runs.filter((r) => now - Date.parse(r.started_at) < ms).reduce((a, r) => a + r.requests_used, 0);
  return { minute: sum(60000), day: sum(DAY), week: sum(7 * DAY), month: sum(30 * DAY) };
}

// ── fake Adzuna market ─────────────────────────────────────────────────────────
type Listing = { id: string; title: string; state: string; created: string; company: string };
let market: Listing[] = [];
let adzunaCalls = 0;
const failures = new Map<string, number[]>();       // "NC:1" -> status codes to return first
const stateName = (c: string) => REGIONS.regions.find((r: any) => r.code === c).name;
function seedMarket() {
  const now = Date.now(), m: Listing[] = [];
  const titles = ["Data Analyst", "Sr. Data Analyst", "Reporting Analyst", "Data & Decision Analyst"];
  for (let i = 0; i < 120; i++) m.push({ id: `nc-${i}`, title: titles[i % 4], state: "NC", created: new Date(now - (i + 10) * 3600000).toISOString(), company: `NC Co ${i}` });
  for (let i = 0; i < 15; i++) m.push({ id: `nc-eng-${i}`, title: "Lead Data Engineer", state: "NC", created: new Date(now - i * 3600000).toISOString(), company: `Eng ${i}` });
  for (let i = 0; i < 37; i++) m.push({ id: `sc-${i}`, title: titles[i % 4], state: "SC", created: new Date(now - (i + 5) * 3600000).toISOString(), company: `SC Co ${i}` });
  market = m;
}
type FeedListing = { id: string; title: string; area: string[]; display?: string; created: string };
let feedMarket: FeedListing[] = [];
let feedTruncateAfter = Infinity;
let failUpsert = false;                 // injected store failure for recovery tests
let failSpendRecord = false;            // injected allowance-ledger failure
let providerDelayMs = 0;                // slows the fake provider so overlap can be tested
let onProviderCall: (() => void) | null = null;
function feedAdzuna(url: URL) {
  assertEquals(url.searchParams.get("category"), "it-jobs");
  assert(!url.searchParams.has("location1") && !url.searchParams.has("title_only"), "feed asks for the whole country");
  const page = Number(url.pathname.split("/").pop()), per = Number(url.searchParams.get("results_per_page"));
  const all = [...feedMarket].sort((a, b) => b.created.localeCompare(a.created));
  const rows = page > feedTruncateAfter ? [] : all.slice((page - 1) * per, page * per);
  return Response.json({ count: all.length, results: rows.map((l) => ({ id: l.id, title: l.title, created: l.created,
    redirect_url: `https://www.adzuna.com/land/ad/${l.id}?se=abc`, company: { display_name: `Co ${l.id}` },
    location: { area: l.area, display_name: l.display ?? l.area.slice(1).join(", ") } })) });
}
function adzuna(url: URL) {
  adzunaCalls++;
  if (url.searchParams.has("category")) return feedAdzuna(url);
  const page = Number(url.pathname.split("/").pop());
  const state = REGIONS.regions.find((r: any) => r.name === url.searchParams.get("location1")).code;
  const key = `${state}:${page}`;
  const queued = failures.get(key);
  if (queued?.length) { const s = queued.shift()!; return new Response("fail", { status: s }); }
  const all = market.filter((l) => l.state === state).sort((a, b) => b.created.localeCompare(a.created));
  // A real API sometimes mixes in a neighbouring state; prove it is rejected.
  const leak = state === "NC" ? market.filter((l) => l.state === "SC").slice(0, 2) : [];
  const per = Number(url.searchParams.get("results_per_page"));
  const pageRows = all.slice((page - 1) * per, page * per).concat(page === 1 ? leak : []);
  const results = pageRows.map((l) => ({
    id: l.id, title: l.title, created: l.created,
    redirect_url: `https://www.adzuna.com/land/ad/${l.id}?se=abc&utm_source=api`,
    company: { display_name: l.company },
    location: { display_name: `${l.state} City`, area: ["US", stateName(l.state), "County", "City"] },
  }));
  return Response.json({ count: all.length, results });
}

// ── fetch router ───────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "api.adzuna.com") {
    assertEquals(url.searchParams.get("app_key"), "adzuna-test-key");
    assert(!url.searchParams.has("resume") && !url.searchParams.has("user_id"), "no user data sent to the source");
    if (providerDelayMs) await new Promise((r) => setTimeout(r, providerDelayMs));
    onProviderCall?.();
    return adzuna(url);
  }
  if (!url.href.startsWith(SB)) throw new Error(`unexpected network call: ${url.host}`);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  const p = url.pathname, q = url.searchParams;
  if (p === "/rest/v1/rpc/ingest_budget_used") return Response.json(budgetUsed());
  if (p === "/rest/v1/rpc/ingest_total_used") return Response.json(db.runs.filter((r) => r.source === "adzuna").reduce((a, r) => a + r.requests_used, 0));
  if (p === "/rest/v1/rpc/ingest_upsert_jobs") {
    if (failUpsert) return new Response("store unavailable", { status: 500 });
    return Response.json(upsert(body.p_rows));
  }
  if (p === "/rest/v1/rpc/ingest_close_feed_unseen") { try { return Response.json(closeFeedUnseen(body)); } catch (e) { return new Response(String(e), { status: 400 }); } }
  if (p === "/rest/v1/ingest_feeds" && method === "POST") { db.feeds.set(body.feed, { ...(db.feeds.get(body.feed) ?? {}), ...body }); return new Response(null, { status: 201 }); }
  if (p === "/rest/v1/ingest_feeds") { const f = db.feeds.get(q.get("feed")!.slice(3)); return Response.json(f ? [f] : []); }
  if (p === "/rest/v1/rpc/ingest_close_unseen") { try { return Response.json(closeUnseen(body)); } catch (e) { return new Response(String(e), { status: 400 }); } }
  if (p === "/rest/v1/ingest_runs" && method === "POST") {
    const row = { id: db.nextRun++, source: body.source, note: body.note, started_at: new Date().toISOString(), status: "running", requests_used: 0 };
    db.runs.push(row); return Response.json([row]);
  }
  if (p === "/rest/v1/ingest_runs" && method === "PATCH") {
    if (failSpendRecord && q.get("id") && body.requests_used !== undefined)
      return new Response("ledger unavailable", { status: 503 });
    const idq = q.get("id");
    const hit = idq ? db.runs.filter((r) => r.id === Number(idq.slice(3)))
                    : db.runs.filter((r) => r.status === "running" && r.started_at < q.get("started_at")!.slice(3));
    for (const r of hit) Object.assign(r, body);
    return new Response(null, { status: 204 });
  }
  if (p === "/rest/v1/ingest_runs") {
    const since = q.get("started_at")!.slice(3);
    const below = q.get("id") ? Number(q.get("id")!.slice(3)) : Infinity;
    return Response.json(db.runs.filter((r) => r.status === "running" && r.started_at > since && r.id < below).map((r) => ({ id: r.id })));
  }
  if (p === "/rest/v1/ingest_cells" && method === "POST") {
    const k = `${body.source}:${body.canonical_role}:${body.state_code}`;
    db.cells.set(k, { ...(db.cells.get(k) ?? {}), ...body }); return new Response(null, { status: 201 });
  }
  if (p === "/rest/v1/ingest_cells") return Response.json([...db.cells.values()]);
  if (p === "/rest/v1/ingest_source_coverage") {
    assertEquals(q.get("source"), "eq.adzuna");
    const rolesQ = q.get("role_id")!.slice(4, -1).split(","), statesQ = q.get("state")!.slice(4, -1).split(",");
    return Response.json(rolesQ.flatMap((r) => statesQ.map((s) => ({ role_id: r, state: s, fresh_distinct: coverage(r, s) }))));
  }
  throw new Error(`unhandled fake route ${method} ${p}`);
}) as typeof fetch;

const { handler } = await import("../supabase/functions/job-ingest/index.ts");
const call = (body: unknown, secret = "test-secret-123") =>
  handler(new Request("https://worker.test", { method: "POST", headers: { "x-ingest-secret": secret }, body: JSON.stringify(body) }))
    .then(async (r: Response) => ({ status: r.status, body: await r.json() }));

// ── scenarios, in order: each builds on the previous state ────────────────────
Deno.test("rejects callers without the ingest secret", async () => {
  const r = await call({}, "wrong-secret-xyz");
  assertEquals(r.status, 401);
});

Deno.test("without Adzuna credentials: blocked, recorded, catalogue untouched", async () => {
  const r = await call({ roles: ["data-analyst"], regions: ["NC", "SC"] });
  assertEquals(r.body.status, "blocked");
  assertEquals(db.jobs.length, 0);
  assertEquals(db.runs.at(-1).status, "blocked");
  assertEquals(adzunaCalls, 0);
});

Deno.test("dry run with a fixture writes nothing", async () => {
  const fixture = JSON.parse(await Deno.readTextFile(new URL("./fixtures/adzuna-nc-data-analyst.json", import.meta.url)));
  const runsBefore = db.runs.length;
  const r = await call({ dry_run: true, fixture, roles: ["data-analyst"], regions: ["NC", "SC"], budget: 4 });
  assert(r.body.status.startsWith("dry_run:"));
  assertEquals(db.jobs.length, 0, "no writes");
  assertEquals(db.runs.length, runsBefore, "no run row");
  assertEquals(r.body.rejected.off_role, 2, "Data Engineer rejected once per cell");
});

Deno.test("first live run: NC filled to target statewide, SC's genuine shortage reported", async () => {
  Deno.env.set("ADZUNA_APP_ID", "adzuna-test-id");
  Deno.env.set("ADZUNA_APP_KEY", "adzuna-test-key");
  // Credentials are read at module load, so reload the worker with them set.
  const mod = await import(`../supabase/functions/job-ingest/index.ts?with-creds`);
  (globalThis as any).__worker = mod.handler;
  seedMarket();
  failures.set("SC:1", [429]);                                   // one transient failure
  const before = adzunaCalls;
  const r = await (globalThis as any).__worker(new Request("https://w", { method: "POST",
    headers: { "x-ingest-secret": "test-secret-123" }, body: JSON.stringify({ roles: ["data-analyst"], regions: ["NC", "SC"], budget: 10 }) })).then((x: Response) => x.json());
  assertEquals(r.status, "succeeded");
  assertEquals(adzunaCalls - before, 5, "NC 3 pages + SC 1 page + 1 retry; SC pages 2-3 skipped once enumerated");
  assertEquals(r.requests_used, 5);
  assertEquals(coverage("data-analyst", "NC"), 120);
  assertEquals(coverage("data-analyst", "SC"), 37, "genuine shortage: the market has 37, not 100");
  assert(db.jobs.every((j) => (j.source_listing_id.startsWith("nc-") ? j.state_code === "NC" : j.state_code === "SC")), "no cross-state rows");
  assertEquals(db.jobs.filter((j) => /Engineer/.test(j.job_title)).length, 0, "no off-role padding");
  assertEquals(r.rejected.other_state, 2, "SC rows leaked into the NC response were rejected");
  assert(db.jobs.every((j) => !/utm_/.test(j.apply_url)), "tracking stripped");
  assertEquals(db.runs.at(-1).requests_used, 5, "budget recorded for the next run");
});

const worker = (body: unknown) => (globalThis as any).__worker(new Request("https://w", { method: "POST",
  headers: { "x-ingest-secret": "test-secret-123" }, body: JSON.stringify(body) })).then((x: Response) => x.json());

Deno.test("later refresh adds genuinely newer listings and never closes on a partial view", async () => {
  const newestBefore = db.jobs.filter((j) => j.state_code === "NC").map((j) => j.posted_at).sort().pop();
  const now = Date.now();
  market = market.filter((l) => !/^nc-(1[0-1][0-9])$/.test(l.id));            // 20 NC listings removed
  for (let i = 0; i < 10; i++) market.push({ id: `nc-new-${i}`, title: "Data Analyst", state: "NC", created: new Date(now - i * 60000).toISOString(), company: `New Co ${i}` });
  const r = await worker({ roles: ["data-analyst"], regions: ["NC"], budget: 10, force: true });
  assertEquals(r.cells["data-analyst:NC"].pages, 1, "NC is full and freshly swept: one incremental page");
  assertEquals(r.written.inserted, 10);
  const newestAfter = db.jobs.filter((j) => j.state_code === "NC").map((j) => j.posted_at).sort().pop();
  assert(newestAfter > newestBefore, "the catalogue now holds newer postings than before");
  assertEquals(r.closed, 0, "one page is not a full view: nothing closed");
  assertEquals(db.jobs.filter((j) => j.closed_at).length, 0);
});

Deno.test("a periodic full sweep re-confirms open listings and closes the removed ones", async () => {
  const cell = db.cells.get("adzuna:data-analyst:NC");
  cell.last_full_sweep_at = new Date(Date.now() - 7 * DAY).toISOString();
  const r = await worker({ roles: ["data-analyst"], regions: ["NC"], budget: 10, force: true });
  assertEquals(r.cells["data-analyst:NC"].complete, true);
  assertEquals(r.closed, 20, "exactly the 20 removed listings");
  assertEquals(coverage("data-analyst", "NC"), 110);
});

Deno.test("a source outage keeps the last good catalogue and records the failure", async () => {
  const open = db.jobs.filter((j) => !j.closed_at).length;
  failures.set("NC:1", [500, 500, 500]);
  db.cells.get("adzuna:data-analyst:NC").last_full_sweep_at = new Date(Date.now() - 7 * DAY).toISOString();
  const r = await worker({ roles: ["data-analyst"], regions: ["NC"], budget: 10, force: true });
  assertEquals(r.status, "failed");
  assertEquals(r.closed, 0);
  assertEquals(db.jobs.filter((j) => !j.closed_at).length, open, "nothing purged");
  assertEquals(db.cells.get("adzuna:data-analyst:NC").consecutive_failures, 1);
  assert(db.cells.get("adzuna:data-analyst:NC").last_error.startsWith("source_500"));
});

Deno.test("provider allowance exhausted: no requests, run recorded as blocked", async () => {
  db.runs.push({ id: db.nextRun++, source: "adzuna", started_at: new Date().toISOString(), status: "succeeded", requests_used: 250 });
  const before = adzunaCalls;
  const r = await worker({ roles: ["data-analyst"], regions: ["NC", "SC"], budget: 10, force: true });
  assertEquals(r.status, "blocked");
  assertEquals(adzunaCalls, before);
  assertEquals(db.runs.at(-1).status, "blocked");
});

Deno.test("a second run cannot start while one is in progress", async () => {
  db.runs.push({ id: db.nextRun++, source: "adzuna", started_at: new Date().toISOString(), status: "running", requests_used: 0 });
  const r = await (globalThis as any).__worker(new Request("https://w", { method: "POST",
    headers: { "x-ingest-secret": "test-secret-123" }, body: JSON.stringify({ roles: ["data-analyst"], regions: ["NC"] }) }));
  assertEquals(r.status, 409);
});


// ── nationwide IT feed ─────────────────────────────────────────────────────────
const FEED_TITLES = ["Data Analyst", "Java Developer", "DevOps Engineer", "IT Support Specialist", "IT Project Manager", "Data Engineer"];
const FEED_STATES = [["US", "Texas", "Travis County", "Austin"], ["US", "North Carolina"], ["US", "Wyoming"], ["US", "California"], ["US"]];
function seedFeed(n: number, from = 0, newestHoursAgo = 1) {
  const now = Date.now(), out: FeedListing[] = [];
  for (let i = 0; i < n; i++) out.push({ id: `f-${from + i}`, title: FEED_TITLES[(from + i) % 6], area: FEED_STATES[(from + i) % 5],
    created: new Date(now - (newestHoursAgo + i) * 3600000).toISOString() });
  return out;
}
const freshRuns = () => { for (const r of db.runs) { r.status = r.status === "running" ? "failed" : r.status; r.started_at = new Date(Date.now() - 2 * DAY).toISOString(); } };
const feedRows = () => db.jobs.filter((j) => j.ingest_feed === "adzuna-us-it");

Deno.test("feed dry run classifies nationwide listings and writes nothing", async () => {
  freshRuns();
  feedMarket = seedFeed(30);
  const fx = await (await feedAdzuna(new URL("https://api.adzuna.com/v1/api/jobs/us/search/1?category=it-jobs&results_per_page=50"))).json();
  const before = db.jobs.length;
  const r = await worker({ mode: "feed", dry_run: true, fixture_pages: [fx], budget: 1 });
  assertEquals(r.status, "dry_run:succeeded");
  assertEquals(db.jobs.length, before, "no writes");
  assertEquals(db.feeds.size, 0, "cursor untouched");
  assert(r.rejected.no_role > 0 && r.rejected.out_of_scope > 0 && r.rejected.no_state_evidence > 0, JSON.stringify(r.rejected));
  assert(Object.keys(r.kept_by_role_state).every((k) => /^(data-analyst|software-engineer|devops-engineer|data-engineer):(TX|NC|WY|CA)$/.test(k)), JSON.stringify(r.kept_by_role_state));
});

Deno.test("feed run 1: walks the first pages of the whole country and checkpoints the pass", async () => {
  feedMarket = seedFeed(330);
  const r = await worker({ mode: "feed", budget: 3 });
  assertEquals(r.status, "succeeded", JSON.stringify(r));
  assertEquals(r.requests_used, 3);
  assertEquals(r.pass.last_page, 3);
  assertEquals(r.pass.completed, false);
  assertEquals(r.closed, 0);
  assertEquals(db.feeds.get("adzuna-us-it").next_page, 4);
  assert(db.feeds.get("adzuna-us-it").pass_started_at);
  assertEquals(r.written.inserted, r.kept);
  assert(feedRows().length > 0 && feedRows().every((j) => ["data-analyst", "software-engineer", "devops-engineer", "data-engineer"].includes(j.canonical_role)));
  assert(feedRows().every((j) => j.attribution === "Adzuna" && j.state_code), "attributed, with a real state");
  assertEquals(db.jobs.filter((j) => /Support Specialist|Project Manager/.test(j.job_title)).length, 0, "no padding");
});

Deno.test("feed run 2: the head picks up new postings, the pass resumes and completes without wrong closures", async () => {
  freshRuns();
  feedMarket = feedMarket.filter((l) => !/^f-1[0-4]$/.test(l.id)).concat(seedFeed(60, 1000, -0.5).map((l, i) => ({ ...l, created: new Date(Date.now() - i * 60000).toISOString() })));
  const r = await worker({ mode: "feed", budget: 10 });
  assertEquals(r.status, "succeeded", JSON.stringify(r));
  assertEquals(r.pass.head_pages, 2, "page 1 all new, page 2 reaches known listings");
  assertEquals(r.pass.resumed_at, 4, "pass shifted by the 60 new postings, with one page overlap");
  assertEquals(r.pass.completed, true);
  assertEquals(r.closed, 0, "removed listings were seen earlier in this pass; the next pass retires them");
  assert(feedRows().some((j) => j.source_listing_id === "f-1001"), "new posting ingested");
  const ids = new Set(feedRows().map((j) => j.source_listing_id));
  for (const l of feedMarket) {
    const kept = L.normalizeAdzunaFeed({ id: l.id, title: l.title, created: l.created, redirect_url: `https://www.adzuna.com/land/ad/${l.id}`,
      location: { area: l.area } }, { roles, scope: new Set(ROLES.feeds["adzuna-us-it"].roles), feed: "x", idx: L.regionIndex(REGIONS), fetchedAt: "" }) as any;
    if (kept.row) assert(ids.has(l.id), `nothing skipped across runs: ${l.id}`);
  }
});

Deno.test("feed run 3: the next complete pass retires exactly the removed listings, and only feed rows", async () => {
  freshRuns();
  const cellRowsOpen = db.jobs.filter((j) => !j.ingest_feed && !j.closed_at).length;
  await new Promise((res) => setTimeout(res, 5));
  const r = await worker({ mode: "feed", budget: 10 });
  assertEquals(r.pass.completed, true);
  const removedKept = ["f-10", "f-11", "f-12", "f-13", "f-14"].filter((id) => db.jobs.some((j) => j.source_listing_id === id));
  assertEquals(r.closed, removedKept.length);
  assert(removedKept.every((id) => db.jobs.find((j) => j.source_listing_id === id).closed_at));
  assertEquals(db.jobs.filter((j) => !j.ingest_feed && !j.closed_at).length, cellRowsOpen, "cell-sweep rows untouched");
});

Deno.test("feed: a truncated provider response never counts as a complete pass", async () => {
  freshRuns();
  const open = feedRows().filter((j) => !j.closed_at).length;
  feedTruncateAfter = 2;
  const r = await worker({ mode: "feed", budget: 10 });
  feedTruncateAfter = Infinity;
  assertEquals(r.error, "provider_truncated");
  assertEquals(r.closed, 0);
  assertEquals(feedRows().filter((j) => !j.closed_at).length, open);
  assertEquals(db.feeds.get("adzuna-us-it").next_page, 1, "pass restarts");
});

Deno.test("feed: an implausible mass closure is refused", async () => {
  freshRuns();
  const open = feedRows().filter((j) => !j.closed_at).length;
  assert(open > 100, `need >100 open feed rows, have ${open}`);
  feedMarket = feedMarket.slice(0, 10);
  await new Promise((res) => setTimeout(res, 5));
  const r = await worker({ mode: "feed", budget: 10 });
  assertEquals(r.pass.completed, true);
  assertEquals(r.close_error, "close_refused");
  assertEquals(r.closed, 0);
  assertEquals(feedRows().filter((j) => !j.closed_at).length, open);
});

// ── recovery, lifetime allowance and overlap ───────────────────────────────────
const workerRaw = (body: unknown) => (globalThis as any).__worker(new Request("https://w", { method: "POST",
  headers: { "x-ingest-secret": "test-secret-123" }, body: JSON.stringify(body) }))
  .then(async (x: Response) => ({ status: x.status, body: await x.json() }));
const sumUsed = () => db.runs.filter((r) => r.source === "adzuna").reduce((a, r) => a + r.requests_used, 0);

Deno.test("a failed store write leaves the feed cursor and watermark where they were", async () => {
  freshRuns();
  db.feeds.clear();
  feedMarket = seedFeed(330);
  await worker({ mode: "feed", budget: 2 });                          // establish a checkpoint
  const before = { ...db.feeds.get("adzuna-us-it") };
  feedMarket = feedMarket.concat(seedFeed(40, 2000, 0.5));            // new postings for the head
  failUpsert = true;
  let r: any;
  try { r = await worker({ mode: "feed", budget: 4 }); } finally { failUpsert = false; }
  assertEquals(r.error, "write_failed", JSON.stringify(r));
  const after = db.feeds.get("adzuna-us-it");
  assertEquals(after.next_page, before.next_page, "cursor not advanced past pages that were not stored");
  assertEquals(after.watermark, before.watermark, "watermark not advanced past listings that were not stored");
  assertEquals(r.closed, 0);
});

Deno.test("provider calls are recorded on the run while it is still in progress", async () => {
  freshRuns();
  db.feeds.clear();
  feedMarket = seedFeed(330);
  const seen: number[] = [];
  onProviderCall = () => { const run = db.runs.at(-1); seen.push(run.status === "running" ? run.requests_used : -1); };
  try { await worker({ mode: "feed", budget: 3 }); } finally { onProviderCall = null; }
  assertEquals(seen, [1, 2, 3], "each call is reserved on the run record before the provider is called");
});

Deno.test("a failed spend reservation makes no provider request", async () => {
  freshRuns();
  db.feeds.clear();
  feedMarket = seedFeed(120);
  const before = adzunaCalls;
  failSpendRecord = true;
  try {
    const response = await workerRaw({ mode: "feed", budget: 2 });
    assertEquals(response.status, 503);
    assertEquals(response.body.reason, "allowance_ledger_unavailable");
    assertEquals(adzunaCalls, before, "no provider call was made without a reservation");
  } finally { failSpendRecord = false; }
});

Deno.test("a 20-minute live run still blocks a second run", async () => {
  freshRuns();
  const active = { id: db.nextRun++, source: "adzuna", note: "active run", started_at: new Date(Date.now() - 20 * 60000).toISOString(), status: "running", requests_used: 4 };
  db.runs.push(active);
  feedMarket = seedFeed(330);
  const before = adzunaCalls;
  const response = await workerRaw({ mode: "feed", budget: 2 });
  assertEquals(response.status, 409);
  assertEquals(active.status, "running");
  assertEquals(adzunaCalls, before);
});

Deno.test("another provider's jobs do not satisfy an Adzuna cell shortage", async () => {
  const adzunaBefore = coverage("data-analyst", "NC");
  const row = { source: "indeed", canonical_role: "data-analyst", state_code: "NC", job_title: "Data Analyst", company: "Other Co", location: "Raleigh, NC", posted_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), closed_at: null };
  db.jobs.push(row);
  try {
    assertEquals(coverage("data-analyst", "NC"), adzunaBefore);
    assertEquals(coverage("data-analyst", "NC", "indeed"), 1);
  } finally { db.jobs.pop(); }
});

Deno.test("an interrupted run is closed out, and the calls it made still count against the allowance", async () => {
  freshRuns();
  const stale = { id: db.nextRun++, source: "adzuna", note: "feed adzuna-us-it", started_at: new Date(Date.now() - 3 * 60 * 60000).toISOString(), status: "running", requests_used: 4 };
  db.runs.push(stale);
  feedMarket = seedFeed(330);
  const r = await workerRaw({ mode: "feed", budget: 2 });
  assertEquals(r.status, 200, "not blocked by a run that stopped without finishing");
  assertEquals(stale.status, "failed");
  assert(String(stale.note).includes("interrupted"), String(stale.note));
  assert(r.body.used_before.day >= 4, JSON.stringify(r.body.used_before));
});

Deno.test("a lifetime allowance stops the worker before the account's total is spent", async () => {
  freshRuns();
  db.feeds.clear();
  feedMarket = seedFeed(330);
  Deno.env.set("ADZUNA_LIMIT_TOTAL", String(sumUsed() + 3));
  try {
    const first = await workerRaw({ mode: "feed", budget: 10 });
    assertEquals(first.body.requests_used, 3, JSON.stringify(first.body));
    const calls = adzunaCalls;
    Deno.env.set("ADZUNA_LIMIT_TOTAL", String(sumUsed()));          // every call is now spent
    const second = await workerRaw({ mode: "feed", budget: 10 });
    assertEquals(second.body.status, "blocked", JSON.stringify(second.body));
    assertEquals(adzunaCalls, calls, "no provider call once the total is spent");
  } finally { Deno.env.delete("ADZUNA_LIMIT_TOTAL"); }
});

Deno.test("an unreadable lifetime allowance blocks calls rather than allowing unlimited ones", async () => {
  freshRuns();
  feedMarket = seedFeed(330);
  const calls = adzunaCalls;
  Deno.env.set("ADZUNA_LIMIT_TOTAL", "twenty-five");
  try {
    const r = await workerRaw({ mode: "feed", budget: 10 });
    assertEquals(r.body.status, "blocked", JSON.stringify(r.body));
    assertEquals(adzunaCalls, calls, "no provider call");
  } finally { Deno.env.delete("ADZUNA_LIMIT_TOTAL"); }
});

Deno.test("two runs started at the same moment: only one proceeds", async () => {
  freshRuns();
  db.feeds.clear();
  feedMarket = seedFeed(330);
  providerDelayMs = 20;
  try {
    const [a, b] = await Promise.all([workerRaw({ mode: "feed", budget: 2 }), workerRaw({ mode: "feed", budget: 2 })]);
    assertEquals([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
  } finally { providerDelayMs = 0; }
});

globalThis.addEventListener("unload", () => { globalThis.fetch = realFetch; });
