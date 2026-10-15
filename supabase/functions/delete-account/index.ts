// Self-service account deletion.
//
// The browser can already delete its own saved jobs and history, but it cannot
// delete a profile row (there is no DELETE policy) and it must never hold the
// credential that deletes an auth user. That credential lives only here.
//
// What this removes, for the caller and nobody else:
//   resumes/<uid>/*  and  avatars/<uid>/*   storage objects
//   saved_jobs, search_history              rows owned by the caller
//   profiles                                the caller's row
//   auth user                               last of all
//
// live_search_admissions keeps its rows but loses account_id. Those rows are
// capacity accounting, not personal data; unlinking removes the person without
// corrupting the rate-limit and cost history.
//
// Ordering matters. The auth user goes LAST: if any earlier step fails the
// caller can still sign in and retry, and every step is idempotent so a retry
// resumes rather than breaking. Deleting the auth user first would strand the
// remaining data with nobody able to ask for it again.
//
// verify_jwt is off and authentication is done in the handler instead. That is
// deliberate and stricter, not weaker: the platform check accepts any token this
// project signed, the publishable anon key included, whereas resolveCaller()
// below accepts only a real user token. Leaving it off also keeps the CORS
// preflight working, since an OPTIONS request carries no Authorization header.
//
// Required secret (set in the dashboard, never in source):
//   SUPABASE_SERVICE_ROLE_KEY   supplied by the platform

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ALLOWED_ORIGINS = [
  "https://fortunejobsai.com",
  "https://www.fortunejobsai.com",
  "https://antonyfranklin29.github.io",
];

// How recently the caller must have actually authenticated. A refreshed access
// token does not count: freshness is read from the authentication event.
const REAUTH_WINDOW_SECONDS = 15 * 60;
const CONFIRM_PHRASE        = "DELETE MY ACCOUNT";
const MAX_BODY_BYTES        = 2_000;
const STEP_TIMEOUT_MS       = 8_000;
const BUCKETS               = ["resumes", "avatars"] as const;

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

async function readBounded(req: Request, limit: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? "0") > limit) return null;
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

function admin(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });
}

// The authenticated identity comes from the token alone. Nothing in the request
// body can name a user: that is what stops one account deleting another.
async function resolveCaller(token: string): Promise<{ id: string; email: string } | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  if (!u || typeof u.id !== "string" || !/^[0-9a-f-]{36}$/i.test(u.id)) return null;
  return { id: u.id, email: typeof u.email === "string" ? u.email : "" };
}

// Seconds since the caller last actually authenticated, from the token's amr
// claim. Returns null when the token carries no usable evidence.
function secondsSinceAuth(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const pad = "=".repeat((4 - (part.length % 4)) % 4);
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad));
    const now = Math.floor(Date.now() / 1000);
    const stamps: number[] = Array.isArray(payload?.amr)
      ? payload.amr.map((m: Record<string, unknown>) => Number(m?.timestamp)).filter(Number.isFinite)
      : [];
    if (stamps.length) return now - Math.max(...stamps);
    const iat = Number(payload?.iat);
    return Number.isFinite(iat) ? now - iat : null;
  } catch { return null; }
}

type StepResult = { step: string; ok: boolean; removed?: number; error?: string };

// Remove every object the caller owns in one bucket. Owner scoping is the
// "<uid>/" prefix, matching the storage policies already in place.
async function purgeBucket(bucket: string, uid: string): Promise<StepResult> {
  const step = `storage:${bucket}`;
  let removed = 0;
  try {
    for (let page = 0; page < 20; page++) {
      const listed = await admin(`/storage/v1/object/list/${bucket}`, {
        method: "POST",
        body: JSON.stringify({ prefix: `${uid}/`, limit: 100, offset: 0 }),
      });
      if (!listed.ok) return { step, ok: false, removed, error: `list_${listed.status}` };
      const rows = await listed.json().catch(() => []);
      if (!Array.isArray(rows) || rows.length === 0) break;

      const names = rows
        .map((r: Record<string, unknown>) => String(r?.name ?? ""))
        .filter(Boolean)
        .map((n) => `${uid}/${n}`);
      if (!names.length) break;

      const del = await admin(`/storage/v1/object/${bucket}`, {
        method: "DELETE",
        body: JSON.stringify({ prefixes: names }),
      });
      if (!del.ok) return { step, ok: false, removed, error: `delete_${del.status}` };
      removed += names.length;
      if (rows.length < 100) break;
    }
    return { step, ok: true, removed };
  } catch (e) {
    return { step, ok: false, removed, error: String(e).slice(0, 120) };
  }
}

async function purgeRows(table: string, filter: string): Promise<StepResult> {
  const step = `table:${table}`;
  try {
    const res = await admin(`/rest/v1/${table}?${filter}`, {
      method: "DELETE",
      headers: { prefer: "return=representation" },
    });
    if (!res.ok) return { step, ok: false, error: `http_${res.status}` };
    const rows = await res.json().catch(() => []);
    return { step, ok: true, removed: Array.isArray(rows) ? rows.length : 0 };
  } catch (e) {
    return { step, ok: false, error: String(e).slice(0, 120) };
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ status: "rejected", reason: "method_not_allowed" }, 405, origin);
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ status: "error", reason: "service_misconfigured" }, 503, origin);
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ status: "rejected", reason: "not_authenticated" }, 401, origin);

  // verify_jwt accepts any token this project signed, including the publishable
  // anon key, so the user is resolved here rather than trusted from the claims.
  const caller = await resolveCaller(token);
  if (!caller) return json({ status: "rejected", reason: "not_authenticated" }, 401, origin);

  const age = secondsSinceAuth(token);
  if (age === null || age > REAUTH_WINDOW_SECONDS) {
    return json({
      status: "rejected", reason: "reauth_required",
      message: "For your security, please sign in again before deleting your account.",
    }, 401, origin);
  }

  const raw = await readBounded(req, MAX_BODY_BYTES);
  if (raw === null) return json({ status: "rejected", reason: "invalid_request", detail: "body too large" }, 413, origin);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw || "{}"); }
  catch { return json({ status: "rejected", reason: "invalid_request", detail: "body is not valid JSON" }, 400, origin); }

  // Explicit confirmation: the exact phrase, plus the caller's own email typed
  // back. Neither value can select a different account; they only confirm.
  if (String(body.confirm ?? "").trim() !== CONFIRM_PHRASE) {
    return json({ status: "rejected", reason: "confirmation_required",
      detail: `type ${CONFIRM_PHRASE} to confirm` }, 400, origin);
  }
  const typedEmail = String(body.email ?? "").trim().toLowerCase();
  if (!caller.email || typedEmail !== caller.email.toLowerCase()) {
    return json({ status: "rejected", reason: "email_mismatch",
      detail: "the email entered does not match this account" }, 400, origin);
  }

  const uid = caller.id;
  const steps: StepResult[] = [];

  for (const bucket of BUCKETS) steps.push(await purgeBucket(bucket, uid));
  steps.push(await purgeRows("saved_jobs", `user_id=eq.${uid}`));
  steps.push(await purgeRows("search_history", `user_id=eq.${uid}`));

  // Unlink rather than delete: capacity and cost history must survive, the
  // person must not remain attached to it.
  try {
    const res = await admin(`/rest/v1/live_search_admissions?account_id=eq.${uid}`, {
      method: "PATCH", headers: { prefer: "return=representation" },
      body: JSON.stringify({ account_id: null }),
    });
    const rows = res.ok ? await res.json().catch(() => []) : [];
    steps.push({ step: "unlink:live_search_admissions", ok: res.ok,
      removed: Array.isArray(rows) ? rows.length : 0,
      error: res.ok ? undefined : `http_${res.status}` });
  } catch (e) {
    steps.push({ step: "unlink:live_search_admissions", ok: false, error: String(e).slice(0, 120) });
  }

  steps.push(await purgeRows("profiles", `id=eq.${uid}`));

  // Nothing is irreversible until every earlier step has succeeded.
  const failed = steps.filter((s) => !s.ok);
  if (failed.length) {
    return json({
      status: "incomplete",
      message: "Some of your data could not be removed yet. Your account is still active — please try again.",
      retryable: true,
      steps,
    }, 409, origin);
  }

  try {
    const res = await admin(`/auth/v1/admin/users/${uid}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      steps.push({ step: "auth:user", ok: false, error: `http_${res.status}` });
      return json({
        status: "incomplete",
        message: "Your data was removed but the account itself could not be closed. Please try again.",
        retryable: true, steps,
      }, 409, origin);
    }
    steps.push({ step: "auth:user", ok: true, removed: res.status === 404 ? 0 : 1 });
  } catch (e) {
    steps.push({ step: "auth:user", ok: false, error: String(e).slice(0, 120) });
    return json({ status: "incomplete", retryable: true, steps,
      message: "Your data was removed but the account itself could not be closed. Please try again." }, 409, origin);
  }

  return json({ status: "deleted", message: "Your account and personal data have been deleted.", steps }, 200, origin);
});
