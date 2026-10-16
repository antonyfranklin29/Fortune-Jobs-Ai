// Employer domain proof. The ONLY server step an employer can trigger here:
// look up _fortunejobsai.<their org's domain> TXT and, if it carries the org's
// challenge token, record domain control. It cannot approve an organization,
// a post or a source, publish anything, or change a plan — those are database
// functions with their own checks (migrations/pending/20261016_employer_submissions.sql).
//
// POST { "action": "check_domain", "org_id": "<uuid>" }   Authorization: Bearer <user token>
//
// The handler accepts only a real user token (resolved via /auth/v1/user),
// independently of the gateway JWT check. The domain and token come from the
// database, never from the request, so the lookup cannot be steered elsewhere.
// One check per org per minute.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { isUuid, proofName, proofMatches } from "./lib.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGINS = ["https://fortunejobsai.com", "https://www.fortunejobsai.com", "https://antonyfranklin29.github.io"];
const MAX_BODY_BYTES = 1_000;

async function readBounded(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new RangeError();
  if (!req.body) throw new SyntaxError();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new RangeError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function lookupTxt(name: string): Promise<string[][]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Deno.resolveDns(name, "TXT"),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("dns_timeout")), 5_000); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

function cors(origin: string | null) {
  return {
    "access-control-allow-origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "access-control-allow-headers": "authorization, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "origin",
  };
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors(origin) } });

function rest(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(8_000),
  });
}

async function caller(req: Request): Promise<{ id: string; confirmed: boolean } | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token === SERVICE_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && isUuid(u.id) ? { id: u.id, confirmed: Boolean(u.email_confirmed_at) } : null;
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "not_configured" }, 503, origin);
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return json({ error: "too_large" }, 413, origin);

  const user = await caller(req);
  if (!user) return json({ error: "sign_in_required" }, 401, origin);
  if (!user.confirmed) return json({ error: "email_not_confirmed" }, 403, origin);

  let parsed: unknown;
  try { parsed = await readBounded(req); }
  catch (error) { return json({ error: error instanceof RangeError ? "too_large" : "bad_request" }, error instanceof RangeError ? 413 : 400, origin); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "bad_request" }, 400, origin);
  const body = parsed as Record<string, unknown>;
  if (body.action !== "check_domain" || !isUuid(body.org_id) || Object.keys(body).some(k => !["action", "org_id"].includes(k))) {
    return json({ error: "bad_request" }, 400, origin);
  }
  const orgId = String(body.org_id);
  try {
    // Identity is resolved from the user token. The DB atomically checks
    // membership/status and reserves the minute BEFORE any DNS work starts.
    const started = await rest("/rest/v1/rpc/employer_domain_check_begin", {
      method: "POST", body: JSON.stringify({ p_org: orgId, p_user: user.id }),
    });
    if (!started.ok) throw new Error("database_unavailable");
    const claim = await started.json();
    if (claim?.state === "not_found") return json({ error: "not_found" }, 404, origin);
    if (claim?.state === "inactive") return json({ error: "organization_inactive" }, 409, origin);
    if (claim?.state === "rate_limited") return json({ error: "try_again_in_a_minute" }, 429, origin);
    if (claim?.state === "verified") return json({ verified: true }, 200, origin);
    if (claim?.state !== "lookup" || !isUuid(claim.attempt_id) || !/^[0-9a-f]{32}$/.test(claim.token)) throw new Error("invalid_claim");
    const name = proofName(claim.domain);
    if (!name) return json({ error: "invalid_domain" }, 409, origin);
    let records: string[][] = [];
    try { records = await lookupTxt(name); } catch { records = []; }
    const finished = await rest("/rest/v1/rpc/employer_domain_check_finish", {
      method: "POST", body: JSON.stringify({ p_org: orgId, p_user: user.id, p_attempt: claim.attempt_id,
        p_token: claim.token, p_matched: proofMatches(records, claim.token) }),
    });
    if (!finished.ok) throw new Error("database_unavailable");
    const result = await finished.json();
    if (result?.state === "invalidated") return json({ error: "check_invalidated" }, 409, origin);
    if (result?.state !== "finished" || typeof result.verified !== "boolean") throw new Error("invalid_result");
    return json({ verified: result.verified, record: name }, 200, origin);
  } catch { return json({ error: "temporarily_unavailable" }, 503, origin); }
}

if (!(globalThis as Record<string, unknown>).__EMPLOYER_TEST__) Deno.serve(handler);
