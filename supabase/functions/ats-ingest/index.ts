// ats-ingest: reads IT jobs from companies' own career boards (Greenhouse, Lever, Ashby,
// SmartRecruiters) through the public feeds those systems publish for career pages. No API key,
// no cost. Every stored job's Apply link is the employer's own posting.
//
// Callable only with the INGEST_SECRET header (the database scheduler). Deploy with --no-verify-jwt.
// Body: {"dry_run":true} counts and samples without writing; {"part":n,"parts":m} reads one slice
// of the board list (default: the slice for the current 6-hour window, 4 slices a day).
// Politeness: at most 4 boards fetched at a time, one request per board per run.
// A board that fails is skipped and reported; a failure never closes that board's jobs. Jobs a
// board no longer lists are closed only after that board's full list was read and stored.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as L from "./core.mjs";
import { ROLES, REGIONS } from "./config.mjs";
import { BOARDS } from "./boards.mjs";
import { boardUrl, listOf, normalize, sliceFor } from "./ats.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INGEST_SECRET = Deno.env.get("INGEST_SECRET") ?? "";
const CONCURRENCY = 4;
const roles = L.compileRoles(ROLES);
const idx = L.regionIndex(REGIONS);

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

type Board = { provider: string; slug: string; name: string };
type Result = { board: string; status: number | string; listed: number; kept: number; rows: Record<string, unknown>[]; rejected: Record<string, number> };

async function readBoard(b: Board, fetchedAt: string): Promise<Result> {
  const out: Result = { board: `${b.provider}:${b.slug}`, status: 0, listed: 0, kept: 0, rows: [], rejected: {} };
  try {
    const r = await fetch(boardUrl(b.provider, b.slug), { headers: { accept: "application/json", "user-agent": "FortuneJobsAI/1.0 (+https://fortunejobsai.com; info@fortunejobsai.com)" }, signal: AbortSignal.timeout(20_000) });
    out.status = r.status;
    if (!r.ok) { await r.body?.cancel(); return out; }
    const list = listOf(b.provider, await r.json());
    out.listed = list.length;
    for (const raw of list) {
      const n = normalize(b.provider, raw, b, { roles, idx, fetchedAt }) as { reject?: string; row?: Record<string, unknown> };
      if (n.row) out.rows.push(n.row); else out.rejected[n.reject!] = (out.rejected[n.reject!] ?? 0) + 1;
    }
    out.kept = out.rows.length;
  } catch (e) { out.status = e instanceof DOMException && e.name === "TimeoutError" ? "timeout" : "error"; }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SERVICE_KEY || !safeEqual(req.headers.get("x-ingest-secret") ?? "", INGEST_SECRET)) return json({ error: "unauthorised" }, 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const dryRun = body.dry_run === true;
  const parts = Math.max(1, Math.min(12, Number(body.parts) || 4));
  const part = Number.isFinite(Number(body.part)) ? Number(body.part) : Math.floor(new Date().getUTCHours() / 6);
  const only = typeof body.board === "string" ? body.board : null; // "provider:slug" for a one-board check
  const boards = (only ? BOARDS.filter((b: Board) => `${b.provider}:${b.slug}` === only) : sliceFor(BOARDS, part, parts)) as Board[];

  const started = new Date(), fetchedAt = started.toISOString();
  const results: Result[] = [];
  for (let i = 0; i < boards.length; i += CONCURRENCY) results.push(...await Promise.all(boards.slice(i, i + CONCURRENCY).map((b) => readBoard(b, fetchedAt))));

  let written = { inserted: 0, updated: 0, rejected: 0, conflicts: 0 }, closed = 0;
  const writeFailed = new Set<string>();
  if (!dryRun) {
    for (const res of results) {
      if (res.status !== 200) continue;
      const rows = L.dedupe(res.rows as never[]);
      for (let i = 0; i < rows.length; i += 500) {
        const r = await db("/rest/v1/rpc/ingest_upsert_jobs", { method: "POST", body: JSON.stringify({ p_rows: rows.slice(i, i + 500) }) }).catch(() => null);
        if (!r?.ok) { writeFailed.add(res.board); continue; }
        const w = await r.json();
        written = { inserted: written.inserted + w.inserted, updated: written.updated + w.updated, rejected: written.rejected + w.rejected, conflicts: written.conflicts + w.conflicts };
      }
      // The whole board was read and stored: anything of this board not seen in this run is gone.
      if (!writeFailed.has(res.board)) {
        const [provider, slug] = res.board.split(/:(.*)/s);
        const q = `source=eq.${provider}&source_listing_id=like.${encodeURIComponent(slug.replace(/[%_\\]/g, "\\$&") + ":*")}&closed_at=is.null&last_seen_at=lt.${encodeURIComponent(fetchedAt)}`;
        const c = await db(`/rest/v1/pre_scraped_jobs?${q}`, { method: "PATCH", headers: { prefer: "return=representation,count=exact" }, body: JSON.stringify({ closed_at: new Date().toISOString() }) }).catch(() => null);
        if (c?.ok) closed += (await c.json()).length;
      }
    }
  }

  return json({
    status: dryRun ? "dry_run" : "done", part: only ? null : part % parts, parts, boards: boards.length,
    ok: results.filter((r) => r.status === 200).length, listed: results.reduce((a, r) => a + r.listed, 0),
    kept: results.reduce((a, r) => a + r.kept, 0), written, closed, write_failed: [...writeFailed],
    failed: results.filter((r) => r.status !== 200).map((r) => `${r.board} (${r.status})`),
    per_board: Object.fromEntries(results.filter((r) => r.status === 200).map((r) => [r.board, `${r.kept}/${r.listed}`])),
    sample: dryRun ? results.flatMap((r) => r.rows.slice(0, 1)).slice(0, 8).map((r) => ({ title: r.job_title, company: r.company, state: r.state_code, url: r.apply_url, posted: r.posted_at })) : undefined,
  });
});
