// Live Search admission gateway.
//
// Every Live Search must come through here. The function validates the request,
// applies per-caller and global limits, holds a bounded queue when the system is
// busy, and only then calls the Make workflow using a shared secret that the
// workflow requires. Browsers never learn the workflow URL or the secret.
//
// A concurrency slot is released only on a conclusive outcome: the pipeline's
// final completion marker (a database trigger on job_matches recognises it), an
// explicit live_search_settle call, or a conclusive upstream refusal. Partial
// job rows leave the slot held, because the scraper is still running. The TTL is
// only a safety net for a search that never reports at all.
//
// Required secrets (set in the Supabase dashboard, never in source):
//   MAKE_LIVE_WEBHOOK_URL  the Make webhook this gateway is allowed to call
//   MAKE_GATEWAY_SECRET    shared secret the Make scenario must check
//   CLIENT_HASH_SALT       salt so stored caller hashes are not reversible IPs
//   GATEWAY_TEST_KEY       enables dry-run admission testing without paid scraping

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAKE_URL     = Deno.env.get("MAKE_LIVE_WEBHOOK_URL") ?? "";
const MAKE_SECRET  = Deno.env.get("MAKE_GATEWAY_SECRET") ?? "";
const HASH_SALT    = Deno.env.get("CLIENT_HASH_SALT") ?? "";   // no hardcoded default
const TEST_KEY     = Deno.env.get("GATEWAY_TEST_KEY") ?? "";

const ALLOWED_ORIGINS = [
  "https://fortunejobsai.com",
  "https://www.fortunejobsai.com",
  "https://antonyfranklin29.github.io",
];

const MAX_BODY_BYTES      = 8_000;
const DISPATCH_TIMEOUT_MS = 10_000;
const DB_TIMEOUT_MS       = 5_000;

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-headers": "content-type, x-fj-test-key",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-expose-headers": "retry-after",
    "vary": "origin",
  };
}

function json(body: unknown, status: number, origin: string | null, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin), ...extra },
  });
}

// Falls back to a value derived from the service key: secret, stable across
// requests, and unguessable. An explicit CLIENT_HASH_SALT is still preferred so
// the salt can be rotated independently of the key.
let saltPromise: Promise<string> | null = null;
function effectiveSalt(): Promise<string> {
  if (HASH_SALT) return Promise.resolve(HASH_SALT);
  saltPromise ??= sha256(`fj-derived-salt:${SERVICE_KEY}`).then((h) => h.slice(0, 32));
  return saltPromise;
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Read at most `limit` bytes, aborting a larger body instead of buffering it.
async function readBounded(req: Request, limit: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { merged.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(merged);
}

async function dbFetch(path: string, init: RequestInit = {}) {
  return await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  });
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const res = await dbFetch(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`rpc ${fn} failed: ${res.status}`);
  return await res.json();
}

// ── configuration ─────────────────────────────────────────────────────────────
type Limits = {
  max_concurrent: number; per_client_per_minute: number; per_client_per_hour: number;
  per_client_per_day: number; global_per_hour: number; global_per_day: number;
  slot_seconds: number; queue_wait_ms: number; max_query_chars: number; paused: boolean;
};

const NUMERIC_LIMITS = [
  "max_concurrent", "per_client_per_minute", "per_client_per_hour", "per_client_per_day",
  "global_per_hour", "global_per_day", "slot_seconds", "queue_wait_ms", "max_query_chars",
] as const;

// A malformed or partial config must not silently become NaN and disable a limit.
function parseLimits(raw: unknown): Limits | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const row = raw[0];
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  const out: Record<string, number | boolean> = {};
  for (const key of NUMERIC_LIMITS) {
    const v = Number(r[key]);
    if (!Number.isFinite(v) || v < 0) return null;
    out[key] = v;
  }
  if (typeof r.paused !== "boolean") return null;
  out.paused = r.paused;
  return out as Limits;
}

// ── request validation ────────────────────────────────────────────────────────
const STRING_FILTERS = [
  "location", "city", "region", "country", "country_name",
  "date_posted", "experience", "job_type", "work_mode", "company",
] as const;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

type Validated = {
  text: string;
  filters: Record<string, string | number>;
  accountId: string | null;
};

function validate(body: unknown, maxQueryChars: number): { ok: true; value: Validated } | { ok: false; detail: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, detail: "body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { ok: false, detail: "text is required" };
  if (text.length > maxQueryChars) return { ok: false, detail: `text exceeds ${maxQueryChars} characters` };
  if (CONTROL_CHARS.test(text)) return { ok: false, detail: "text contains control characters" };

  const mode = typeof b.mode === "string" ? b.mode : "live";
  if (mode !== "live") return { ok: false, detail: "mode must be 'live'" };

  const filters: Record<string, string | number> = {};

  for (const key of STRING_FILTERS) {
    const raw = b[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string") return { ok: false, detail: `${key} must be a string` };
    if (raw.length > 120) return { ok: false, detail: `${key} is too long` };
    if (CONTROL_CHARS.test(raw)) return { ok: false, detail: `${key} contains control characters` };
    filters[key] = raw;
  }

  // Regional scope drives guest resume searches and downstream accuracy filtering.
  const scope = b.location_scope;
  if (scope !== undefined && scope !== null && scope !== "") {
    if (scope !== "region") return { ok: false, detail: "location_scope must be 'region'" };
    filters.location_scope = "region";
  }

  // Coordinates arrive as numbers, or null when no city was picked.
  for (const key of ["latitude", "longitude"] as const) {
    const raw = b[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) return { ok: false, detail: `${key} must be a number` };
    const bound = key === "latitude" ? 90 : 180;
    if (Math.abs(n) > bound) return { ok: false, detail: `${key} is out of range` };
    filters[key] = n;
  }

  // Recorded only. Never used for authorisation.
  const accountId = typeof b.user_id === "string" && /^[0-9a-f-]{36}$/i.test(b.user_id) ? b.user_id : null;

  return { ok: true, value: { text, filters, accountId } };
}

// Measured against the deployed function: Cloudflare fronts Supabase Edge
// Functions and sets cf-connecting-ip itself, overwriting whatever the caller
// sends, so it cannot be forged. x-forwarded-for arrives as
// [client, client, infra-hop]; its LAST entry is shared infrastructure, which
// would make per-caller limits either useless or collectively punishing, so the
// fallback uses the FIRST entry.
function clientAddress(req: Request): string {
  const cf = (req.headers.get("cf-connecting-ip") ?? "").trim();
  if (cf) return cf;
  const chain = (req.headers.get("x-forwarded-for") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return chain.length ? chain[0] : "unknown";
}

// ── handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ status: "rejected", reason: "method_not_allowed" }, 405, origin);

  // Fail closed when the gateway is not fully configured, rather than falling
  // back to a shared default that would make caller hashes guessable.
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ status: "error", reason: "gateway_misconfigured" }, 503, origin, { "retry-after": "120" });
  }

  const raw = await readBounded(req, MAX_BODY_BYTES);
  if (raw === null) {
    return json({ status: "rejected", reason: "invalid_request", detail: "body too large" }, 413, origin);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw || "{}"); }
  catch { return json({ status: "rejected", reason: "invalid_request", detail: "body is not valid JSON" }, 400, origin); }

  let cfg: Limits | null = null;
  try {
    const res = await dbFetch("/rest/v1/live_search_limits?select=*&limit=1");
    cfg = res.ok ? parseLimits(await res.json()) : null;
  } catch { cfg = null; }
  if (!cfg) {
    return json({ status: "error", reason: "config_unavailable" }, 503, origin, { "retry-after": "60" });
  }

  const check = validate(parsed, cfg.max_query_chars);
  if (!check.ok) return json({ status: "rejected", reason: "invalid_request", detail: check.detail }, 400, origin);
  const { text, filters, accountId } = check.value;

  const clientHash = await sha256(`${await effectiveSalt()}:${clientAddress(req)}`);
  const searchId = `s_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const dryRun = TEST_KEY !== "" && req.headers.get("x-fj-test-key") === TEST_KEY;

  const queueStart = Date.now();
  const deadline = queueStart + cfg.queue_wait_ms;
  let decision: Record<string, unknown> | null = null;
  for (;;) {
    try {
      decision = await rpc("live_search_try_admit", {
        p_search_id: searchId, p_client_hash: clientHash, p_account: accountId, p_query: text,
      });
    } catch {
      return json({ status: "error", reason: "admission_unavailable" }, 503, origin, { "retry-after": "30" });
    }
    if (decision?.admitted) break;
    if (decision?.reason !== "at_capacity" || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  const waitedMs = Date.now() - queueStart;

  if (!decision?.admitted) {
    const reason = String(decision?.reason ?? "unavailable");
    const retryAfter = String(decision?.retry_after ?? 30);
    const status = reason.startsWith("rate_limited") ? 429 : 503;
    const message = reason.startsWith("rate_limited")
      ? "You have run several live searches recently. Quick Match is still available while this resets."
      : reason.startsWith("budget")
      ? "Live Search has reached today's limit. Quick Match is still available."
      : reason === "paused"
      ? "Live Search is paused for maintenance. Quick Match is still available."
      : "Live Search is busy right now. Please try again shortly, or use Quick Match.";
    return json({ status: "rejected", reason, message, retry_after: Number(retryAfter), queued_ms: waitedMs },
      status, origin, { "retry-after": retryAfter });
  }

  if (dryRun) {
    // Holds its slot exactly like a real search so saturation and recovery can be
    // exercised honestly, but never calls Make, so no scraping is paid for.
    return json({ status: "accepted", search_id: searchId, dry_run: true, queued_ms: waitedMs }, 202, origin);
  }

  if (!MAKE_URL || !MAKE_SECRET) {
    await rpc("live_search_settle", { p_search_id: searchId, p_status: "failed", p_outcome: "gateway_not_configured" }).catch(() => {});
    return json({ status: "error", reason: "gateway_not_configured" }, 503, origin, { "retry-after": "60" });
  }

  try {
    const upstream = await fetch(MAKE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-fj-gateway-secret": MAKE_SECRET },
      body: JSON.stringify({
        text, mode: "live", search_id: searchId, results_limit: 10,
        gateway_secret: MAKE_SECRET, ...filters,
      }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      // A refusal is conclusive: nothing is running, so the slot can be released.
      await rpc("live_search_settle", { p_search_id: searchId, p_status: "failed", p_outcome: `upstream_${upstream.status}` }).catch(() => {});
      return json({ status: "error", reason: "upstream_rejected",
        message: "Live Search is unavailable right now. Quick Match is still available." }, 502, origin);
    }
  } catch (_e) {
    // A timeout is NOT conclusive. Make may have accepted the request and may
    // still be scraping, so the slot stays held and no duplicate is permitted.
    // The completion trigger settles it if results arrive; the TTL is the backstop.
    //
    // This races with completion: results can land while the dispatch call is
    // still timing out. live_search_mark_unconfirmed only touches an admission
    // that is still active, so a search that already completed stays completed.
    await rpc("live_search_mark_unconfirmed", { p_search_id: searchId }).catch(() => {});
    return json({ status: "accepted", search_id: searchId, unconfirmed: true, queued_ms: waitedMs,
      poll_after_ms: 8000,
      message: "Live Search was submitted but not confirmed. Results may still arrive." }, 202, origin);
  }

  // The slot is released by the completion trigger when results land, not here.
  return json({ status: "accepted", search_id: searchId, queued_ms: waitedMs, poll_after_ms: 8000 }, 202, origin);
});
