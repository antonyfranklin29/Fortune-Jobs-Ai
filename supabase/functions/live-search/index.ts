// Live Search admission gateway.
//
// Every Live Search must come through here. The function validates the request,
// applies per-caller and global limits, holds a bounded queue when the system is
// busy, and only then calls the Make workflow using a shared secret that the
// workflow requires. Browsers never learn the workflow URL or the secret.
//
// Required secrets (set in the Supabase dashboard, never in source):
//   MAKE_LIVE_WEBHOOK_URL  the Make webhook this gateway is allowed to call
//   MAKE_GATEWAY_SECRET    shared secret the Make scenario must check
//   CLIENT_HASH_SALT       salt so stored caller hashes are not reversible IPs
//   GATEWAY_TEST_KEY       enables dry-run admission testing without paid scraping

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAKE_URL     = Deno.env.get("MAKE_LIVE_WEBHOOK_URL") ?? "";
const MAKE_SECRET  = Deno.env.get("MAKE_GATEWAY_SECRET") ?? "";
const HASH_SALT    = Deno.env.get("CLIENT_HASH_SALT") ?? "fj-default-salt";
const TEST_KEY     = Deno.env.get("GATEWAY_TEST_KEY") ?? "";

const ALLOWED_ORIGINS = [
  "https://fortunejobsai.com",
  "https://www.fortunejobsai.com",
  "https://antonyfranklin29.github.io",
];

const DISPATCH_TIMEOUT_MS = 10_000;

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-headers": "content-type, x-fj-test-key",
    "access-control-allow-methods": "POST, OPTIONS",
    // Without this the browser hides Retry-After from client code.
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

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${fn} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

// ── request validation ────────────────────────────────────────────────────────
const MODES = new Set(["live"]);
const FILTER_KEYS = [
  "location", "city", "region", "country", "country_name",
  "date_posted", "experience", "job_type", "work_mode", "company",
] as const;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

type Validated = { text: string; filters: Record<string, string>; accountId: string | null };

function validate(body: unknown, maxQueryChars: number): { ok: true; value: Validated } | { ok: false; detail: string } {
  if (typeof body !== "object" || body === null) return { ok: false, detail: "body must be a JSON object" };
  const b = body as Record<string, unknown>;

  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { ok: false, detail: "text is required" };
  if (text.length > maxQueryChars) return { ok: false, detail: `text exceeds ${maxQueryChars} characters` };
  if (CONTROL_CHARS.test(text)) return { ok: false, detail: "text contains control characters" };

  const mode = typeof b.mode === "string" ? b.mode : "live";
  if (!MODES.has(mode)) return { ok: false, detail: "mode must be 'live'" };

  const filters: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const raw = b[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string") return { ok: false, detail: `${key} must be a string` };
    if (raw.length > 120) return { ok: false, detail: `${key} is too long` };
    if (CONTROL_CHARS.test(raw)) return { ok: false, detail: `${key} contains control characters` };
    filters[key] = raw;
  }

  // Accepted but never trusted for authorisation; only recorded.
  const accountId = typeof b.user_id === "string" && /^[0-9a-f-]{36}$/i.test(b.user_id) ? b.user_id : null;

  return { ok: true, value: { text, filters, accountId } };
}

// ── handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") {
    return json({ status: "rejected", reason: "method_not_allowed" }, 405, origin);
  }

  // Bound the body before parsing.
  const raw = await req.text();
  if (raw.length > 8_000) {
    return json({ status: "rejected", reason: "invalid_request", detail: "body too large" }, 413, origin);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw || "{}"); }
  catch { return json({ status: "rejected", reason: "invalid_request", detail: "body is not valid JSON" }, 400, origin); }

  // Read operator limits.
  let cfg: Record<string, number | boolean>;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/live_search_limits?select=*&limit=1`, {
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    });
    cfg = (await res.json())[0];
  } catch {
    return json({ status: "error", reason: "config_unavailable" }, 503, origin, { "retry-after": "60" });
  }

  const check = validate(parsed, Number(cfg.max_query_chars ?? 120));
  if (!check.ok) {
    return json({ status: "rejected", reason: "invalid_request", detail: check.detail }, 400, origin);
  }
  const { text, filters, accountId } = check.value;

  // Caller identity: salted hash, so no raw IP is stored.
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0].trim() || "unknown";
  const clientHash = await sha256(`${HASH_SALT}:${ip}`);

  // The gateway mints the search id. Clients cannot forge or collide with another
  // visitor's id, which is what keeps results isolated per search.
  const searchId = `s_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

  const dryRun = TEST_KEY !== "" && req.headers.get("x-fj-test-key") === TEST_KEY;

  // Admission, with a bounded wait when the only problem is concurrency.
  const queueStart = Date.now();
  const deadline = queueStart + Number(cfg.queue_wait_ms ?? 6000);
  let decision: Record<string, unknown> | null = null;
  for (;;) {
    try {
      decision = await rpc("live_search_try_admit", {
        p_search_id: searchId, p_client_hash: clientHash,
        p_account: accountId, p_query: text,
      });
    } catch (_e) {
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
    return json(
      { status: "rejected", reason, message, retry_after: Number(retryAfter), queued_ms: waitedMs },
      status, origin, { "retry-after": retryAfter },
    );
  }

  if (dryRun) {
    // A dry run holds its slot exactly like a real search so saturation and
    // recovery can be exercised honestly. It simply never calls Make, so no
    // scraping is paid for. Slots clear on their normal TTL.
    return json({ status: "accepted", search_id: searchId, dry_run: true, queued_ms: waitedMs }, 202, origin);
  }

  if (!MAKE_URL || !MAKE_SECRET) {
    await rpc("live_search_settle", { p_search_id: searchId, p_status: "failed", p_outcome: "gateway_not_configured" })
      .catch(() => {});
    return json({ status: "error", reason: "gateway_not_configured" }, 503, origin, { "retry-after": "60" });
  }

  // Dispatch upstream. The secret is what stops anyone calling Make directly.
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
      await rpc("live_search_settle", { p_search_id: searchId, p_status: "failed", p_outcome: `upstream_${upstream.status}` }).catch(() => {});
      return json({ status: "error", reason: "upstream_rejected", message: "Live Search is unavailable right now. Quick Match is still available." }, 502, origin);
    }
  } catch (_e) {
    await rpc("live_search_settle", { p_search_id: searchId, p_status: "failed", p_outcome: "upstream_timeout" }).catch(() => {});
    return json({ status: "error", reason: "upstream_timeout", message: "Live Search did not respond in time. Quick Match is still available." }, 504, origin);
  }

  // The slot stays held until the search settles or its TTL lapses. Marking it
  // free here would let the next caller start before this scrape finished.
  return json({ status: "accepted", search_id: searchId, queued_ms: waitedMs, poll_after_ms: 8000 }, 202, origin);
});
