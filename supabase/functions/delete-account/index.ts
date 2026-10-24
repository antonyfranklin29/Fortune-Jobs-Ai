// Self-service account deletion.
//
// The browser can already delete its own saved jobs and history, but it cannot
// delete a profile row (there is no DELETE policy) and it must never hold the
// credential that deletes an auth user. That credential lives only here.
//
// What this removes, for the caller and nobody else:
//   resumes/<uid>/**  and  avatars/<uid>/**  storage objects, nested folders included
//   saved_jobs, search_history              rows owned by the caller
//   profiles                                the caller's row
//   auth user                               last of all
// Deleting the auth user also removes, by ON DELETE CASCADE, newsletter_preferences
// and newsletter_deliveries; employer memberships are handled by the employer
// account-deletion trigger.
//
// live_search_admissions keeps its rows but loses account_id. Those rows are
// capacity accounting, not personal data; unlinking removes the person without
// corrupting the rate-limit and cost history.
//
// Ordering and what "partial" means. Every step deletes for real: a file or row
// removed by an earlier step is gone even if a later step fails, and nothing is
// restored. The auth user goes LAST, so while anything remains the caller can
// still sign in and retry, and every step is idempotent so a retry resumes where
// the last attempt stopped. Deleting the auth user first would strand the
// remaining data with nobody able to ask for it again.
//
// Known race: the storage policies let the signed-in user upload into their own
// folder. Uploads that land while deletion runs are caught by re-listing until
// the folder is empty (up to STORAGE_ROUNDS); an upload in the moments between
// that final check and the auth deletion, or one made afterwards with a still
// unexpired access token, is not. The page signs the session out after success.
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

// How recently the caller must have actually authenticated. Only an interactive
// authentication event counts: the token's issue time does not, because a
// silently refreshed token is issued now for a sign-in that may be weeks old.
const REAUTH_WINDOW_SECONDS = 15 * 60;
const CLOCK_SKEW_SECONDS    = 60;
// amr methods that record the person actually authenticating. Anything else,
// including a missing or unrecognised method, fails closed.
const INTERACTIVE_AMR = new Set(["password", "oauth", "otp", "magiclink", "sso/saml", "totp", "mfa/totp", "mfa/phone"]);
const CONFIRM_PHRASE        = "DELETE MY ACCOUNT";
const MAX_BODY_BYTES        = 2_000;
const STEP_TIMEOUT_MS       = 8_000;
const BUCKETS               = ["resumes", "avatars"] as const;
// Storage walk bounds. Exceeding any of them fails closed; a retry continues,
// because the objects already deleted stay deleted.
const LIST_PAGE             = 100;
const DELETE_BATCH          = 100;
const MAX_OBJECTS           = 10_000;
const MAX_DEPTH             = 8;
const STORAGE_ROUNDS        = 3;

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

// Seconds since the caller last interactively authenticated, read from the amr
// claim of a token that resolveCaller() has already validated with Auth. Returns
// null (fail closed) when there is no usable evidence: no amr, a malformed amr,
// no interactive method, or a timestamp in the future. The iat claim is never
// used, so a refreshed token cannot satisfy the window.
export function secondsSinceAuth(token: string, nowSeconds = Math.floor(Date.now() / 1000)): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const pad = "=".repeat((4 - (part.length % 4)) % 4);
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad));
    if (!Array.isArray(payload?.amr)) return null;
    const stamps: number[] = [];
    for (const m of payload.amr) {
      if (!m || typeof m !== "object") continue;
      const method = typeof m.method === "string" ? m.method : "";
      const ts = typeof m.timestamp === "number" ? m.timestamp : NaN;
      if (!INTERACTIVE_AMR.has(method) || !Number.isInteger(ts) || ts <= 0) continue;
      if (ts > nowSeconds + CLOCK_SKEW_SECONDS) return null;   // a future event is not evidence
      stamps.push(ts);
    }
    if (!stamps.length) return null;
    return Math.max(0, nowSeconds - Math.max(...stamps));
  } catch { return null; }
}

type StepResult = { step: string; ok: boolean; removed?: number; error?: string };

class StorageWalkError extends Error {}

// One page of one folder. Folder entries (id === null) are returned separately so
// the walk can descend into them. Anything that is not a well-formed listing fails.
async function listFolder(bucket: string, folder: string, offset: number) {
  const res = await admin(`/storage/v1/object/list/${bucket}`, {
    method: "POST",
    body: JSON.stringify({ prefix: `${folder}/`, limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } }),
  });
  if (!res.ok) throw new StorageWalkError(`list_${res.status}`);
  let rows: unknown;
  try { rows = await res.json(); } catch { throw new StorageWalkError("list_malformed"); }
  if (!Array.isArray(rows)) throw new StorageWalkError("list_malformed");
  const files: string[] = [];
  const folders: string[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") throw new StorageWalkError("list_malformed");
    const name = (r as Record<string, unknown>).name;
    // A name inside a folder listing is a single path segment.
    if (typeof name !== "string" || !name || name === "." || name === ".." || name.includes("/")) {
      throw new StorageWalkError("list_malformed");
    }
    if ((r as Record<string, unknown>).id === null) folders.push(`${folder}/${name}`);
    else files.push(`${folder}/${name}`);
  }
  return { files, folders, count: rows.length };
}

// Every object under <uid>/, depth first, bounded.
async function collectOwned(bucket: string, uid: string): Promise<string[]> {
  const out: string[] = [];
  const stack: { folder: string; depth: number }[] = [{ folder: uid, depth: 0 }];
  while (stack.length) {
    const { folder, depth } = stack.pop()!;
    if (depth > MAX_DEPTH) throw new StorageWalkError("too_deep");
    for (let offset = 0; ; offset += LIST_PAGE) {
      const page = await listFolder(bucket, folder, offset);
      for (const f of page.files) {
        if (!f.startsWith(`${uid}/`)) throw new StorageWalkError("outside_owner_folder");
        out.push(f);
        if (out.length > MAX_OBJECTS) throw new StorageWalkError("too_many_objects");
      }
      for (const d of page.folders) stack.push({ folder: d, depth: depth + 1 });
      if (page.count < LIST_PAGE) break;
      if (offset / LIST_PAGE > MAX_OBJECTS / LIST_PAGE) throw new StorageWalkError("too_many_pages");
    }
  }
  return out;
}

// Remove every object the caller owns in one bucket through the Storage API, then
// prove the folder is empty. Owner scoping is the "<uid>/" folder, matching the
// storage policies already in place.
async function purgeBucket(bucket: string, uid: string): Promise<StepResult> {
  const step = `storage:${bucket}`;
  let removed = 0;
  try {
    for (let round = 0; round < STORAGE_ROUNDS; round++) {
      const paths = await collectOwned(bucket, uid);
      if (!paths.length) return { step, ok: true, removed };
      for (let i = 0; i < paths.length; i += DELETE_BATCH) {
        const batch = paths.slice(i, i + DELETE_BATCH);
        const del = await admin(`/storage/v1/object/${bucket}`, {
          method: "DELETE",
          body: JSON.stringify({ prefixes: batch }),
        });
        if (!del.ok) return { step, ok: false, removed, error: `delete_${del.status}` };
        removed += batch.length;
      }
      // Loop: re-list to confirm, and to catch anything uploaded meanwhile.
    }
    const left = await collectOwned(bucket, uid);
    if (left.length) return { step, ok: false, removed, error: "storage_not_empty" };
    return { step, ok: true, removed };
  } catch (e) {
    const error = e instanceof StorageWalkError ? e.message : String(e).slice(0, 120);
    return { step, ok: false, removed, error };
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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ status: "rejected", reason: "invalid_request", detail: "body must be a JSON object" }, 400, origin);
  }

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

  // Anything already removed above is permanently gone. The identity is kept only
  // so the caller can sign in and finish the job.
  const failed = steps.filter((s) => !s.ok);
  if (failed.length) {
    return json({
      status: "incomplete", reason: "partial_cleanup",
      message: "We could not finish deleting your data. Anything already removed is permanently deleted and cannot be restored. Your account is still open, so you can sign in and try again.",
      retryable: true,
      steps,
    }, 409, origin);
  }

  const identityFailed = (error: string) => {
    steps.push({ step: "auth:user", ok: false, error });
    return json({
      status: "incomplete", reason: "identity_not_closed", retryable: true, steps,
      message: "Your data was permanently deleted, but the account itself could not be closed. Please try again.",
    }, 409, origin);
  };
  try {
    const res = await admin(`/auth/v1/admin/users/${uid}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) return identityFailed(`http_${res.status}`);
    steps.push({ step: "auth:user", ok: true, removed: res.status === 404 ? 0 : 1 });
  } catch (e) {
    return identityFailed(String(e).slice(0, 120));
  }

  return json({ status: "deleted", message: "Your account and personal data have been deleted.", steps }, 200, origin);
});
