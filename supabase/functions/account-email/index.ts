// account-email: sends one account email (welcome, Pro started, payment failed, Pro cancelled,
// account deleted) from info@fortunejobsai.com through Resend. Server-to-server only: callers
// (the auth confirmation trigger, billing-webhook, delete-account) send the INGEST_SECRET header.
// Each email is sent at most once per (person, kind, key), recorded in account_emails.
// Body: {"kind":"pro_started","user_id":"…","key":"sub_123","data":{"renews":"2026-12-07T…"},"email":"…"?}
// "email" is only accepted for account_deleted, where the account may already be gone.
import { KINDS, render } from "./templates.mjs";

const BASE = Deno.env.get("SUPABASE_URL") || "https://hqgakkcxcyspqhnlnscv.supabase.co";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const db = (path: string, init: RequestInit = {}) => fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(8000) });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!KEY || !safeEqual(req.headers.get("x-ingest-secret") || "", Deno.env.get("INGEST_SECRET") || "")) return json({ error: "unauthorised" }, 401);
  const resend = Deno.env.get("RESEND_API_KEY") || "";
  if (!resend) return json({ status: "skipped", reason: "email not configured" });
  let body: { kind?: string; user_id?: string; key?: string; data?: Record<string, unknown>; email?: string } = {};
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const kind = String(body.kind || ""), uid = String(body.user_id || ""), key = String(body.key || kind).slice(0, 200);
  if (!KINDS.includes(kind) || !UUID.test(uid)) return json({ error: "bad request" }, 400);

  try {
    // The person: name from the profile, email from the account (or the caller, for a deletion).
    const auth = await fetch(`${BASE}/auth/v1/admin/users/${uid}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(8000) });
    const user = auth.ok ? await auth.json() : null;
    const email = String(user?.email || (kind === "account_deleted" ? body.email || "" : "")).trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ status: "skipped", reason: "no email" });
    if (kind !== "account_deleted" && !user?.email_confirmed_at) return json({ status: "skipped", reason: "email not confirmed" });
    const name = (await (await db(`profiles?id=eq.${uid}&select=full_name`)).json().catch(() => []))[0]?.full_name || user?.user_metadata?.full_name || "";

    // Once only: the insert fails on a repeat (same person, kind and key).
    const claim = await db("account_emails", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: uid, kind, key }) });
    if (claim.status === 409) return json({ status: "duplicate" });
    if (!claim.ok) throw new Error("claim " + claim.status);
    const id = (await claim.json())[0]?.id;

    const content = render(kind, { name, data: body.data || {}, address: Deno.env.get("NEWSLETTER_POSTAL_ADDRESS") || "" });
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json", "Idempotency-Key": `acct-${id}` },
      body: JSON.stringify({ from: Deno.env.get("ACCOUNT_EMAIL_FROM") || "Fortune Jobs AI <info@fortunejobsai.com>", reply_to: "info@fortunejobsai.com", to: [email], ...content }),
      signal: AbortSignal.timeout(15000),
    });
    const sent = r.ok ? await r.json() : null;
    if (!sent?.id) {
      // Not sent: forget the claim so a later attempt can try again.
      await db(`account_emails?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
      return json({ status: "failed" }, 502);
    }
    await db(`account_emails?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ provider_id: sent.id }) }).catch(() => {});
    return json({ status: "sent" });
  } catch {
    return json({ status: "failed" }, 500);
  }
});
