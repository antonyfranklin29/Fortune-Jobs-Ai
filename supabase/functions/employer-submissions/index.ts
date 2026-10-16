// Employer domain proof. The ONLY server step an employer can trigger here:
// look up _fortunejobsai.<their org's domain> TXT and, if it carries the org's
// challenge token, record domain control. It cannot approve an organization,
// a post or a source, publish anything, or change a plan — those are database
// functions with their own checks (migrations/pending/20261016_employer_submissions.sql).
//
// POST { "action": "check_domain", "org_id": "<uuid>" }   Authorization: Bearer <user token>
//
// verify_jwt is off; the handler accepts only a real user token (resolved via
// /auth/v1/user), as delete-account does. The domain and token come from the
// database, never from the request, so the lookup cannot be steered elsewhere.
// One check per org per minute.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { isUuid, proofName, proofMatches } from "./lib.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGINS = ["https://fortunejobsai.com", "https://www.fortunejobsai.com", "https://antonyfranklin29.github.io"];
const MAX_BODY_BYTES = 1_000;

function cors(origin: string | null) {
  return {
    "access-control-allow-origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "access-control-allow-headers": "authorization, content-type",
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

  let body: Record<string, unknown> = {};
  try { body = JSON.parse((await req.text()).slice(0, MAX_BODY_BYTES)); } catch { return json({ error: "bad_request" }, 400, origin); }
  if (body.action !== "check_domain" || !isUuid(body.org_id)) return json({ error: "bad_request" }, 400, origin);
  const orgId = String(body.org_id);

  // Membership is checked server-side; a non-member learns nothing about the org.
  const m = await rest(`/rest/v1/employer_org_members?org_id=eq.${orgId}&user_id=eq.${user.id}&status=eq.active&select=org_id`);
  if (!m.ok || !(await m.json()).length) return json({ error: "not_found" }, 404, origin);
  const o = await rest(`/rest/v1/employer_orgs?id=eq.${orgId}&select=primary_domain,status,domain_verified_at`);
  const org = o.ok ? (await o.json())[0] : null;
  if (!org) return json({ error: "not_found" }, 404, origin);
  if (org.domain_verified_at) return json({ verified: true }, 200, origin);
  if (!["pending", "verified"].includes(org.status)) return json({ error: "organization_inactive" }, 409, origin);

  const c = await rest(`/rest/v1/employer_domain_challenges?org_id=eq.${orgId}&select=token,checked_at`);
  const ch = c.ok ? (await c.json())[0] : null;
  if (!ch) return json({ error: "not_found" }, 404, origin);
  if (ch.checked_at && Date.now() - Date.parse(ch.checked_at) < 60_000) return json({ error: "try_again_in_a_minute" }, 429, origin);

  const name = proofName(org.primary_domain);
  if (!name) return json({ error: "invalid_domain" }, 409, origin);
  let records: string[][] = [];
  try { records = await Deno.resolveDns(name, "TXT"); } catch { records = []; }
  const matched = proofMatches(records, ch.token);

  // Records the attempt either way (rate limit + audit); sets domain_verified_at only on a match.
  const r = await rest(`/rest/v1/rpc/employer_mark_domain_verified`, {
    method: "POST", body: JSON.stringify({ p_org: orgId, p_token: matched ? ch.token : "no-match" }),
  });
  if (!r.ok) return json({ error: "temporarily_unavailable" }, 503, origin);
  return json({ verified: matched, record: name }, 200, origin);
}

if (!(globalThis as Record<string, unknown>).__EMPLOYER_TEST__) Deno.serve(handler);
