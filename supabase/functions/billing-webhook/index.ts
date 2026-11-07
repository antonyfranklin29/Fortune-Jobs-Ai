// billing-webhook: Stripe tells us when a Pro subscription starts, renews, fails or ends.
// Deploy with --no-verify-jwt: Stripe calls it, and every event is checked with the signing secret.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (whsec_… from the Stripe webhook endpoint).
// Events can arrive twice or out of order, so each one re-reads the subscription from Stripe and
// stores its current state; the event id is recorded so a repeat is ignored.
import { periodEnd, stripe, verifySignature } from "./stripe.ts";

const BASE = Deno.env.get("SUPABASE_URL") || "https://hqgakkcxcyspqhnlnscv.supabase.co";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = (path: string, init: RequestInit = {}) => fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(8000) });
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("STRIPE_SECRET_KEY") || "", whsec = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  const payload = await req.text();
  if (!(await verifySignature(payload, req.headers.get("Stripe-Signature") || "", whsec))) return json({ error: "bad signature" }, 400);
  const event = JSON.parse(payload);
  const types = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"];
  if (!types.includes(event.type)) return json({ ignored: event.type });

  const seen = await db("stripe_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id: event.id, type: event.type }) });
  if (seen.status === 409) return json({ duplicate: true });
  try {
    const o = event.data?.object || {};
    const subId = o.object === "subscription" ? o.id : o.subscription;
    if (!subId || typeof subId !== "string") return json({ ok: true, note: "no subscription" });
    const sub = await stripe(secret, "GET", `subscriptions/${subId}`);
    if (sub.metadata?.site && sub.metadata.site !== "fortunejobsai") return json({ ignored: "other site" }); // the account also bills another business
    let userId = sub.metadata?.user_id;
    if (!UUID.test(String(userId || ""))) {
      const r = (await (await db(`subscriptions?stripe_customer_id=eq.${encodeURIComponent(sub.customer)}&select=user_id`)).json())[0];
      userId = r?.user_id;
    }
    if (!UUID.test(String(userId || ""))) return json({ ok: true, note: "unknown customer" });
    // One person, one Pro row: news about some other, inactive subscription (a duplicate that was
    // cancelled, say) must not overwrite an active one.
    const live = (st: string) => ["active", "trialing", "past_due"].includes(st);
    const current = (await (await db(`subscriptions?user_id=eq.${userId}&select=stripe_subscription_id,status`)).json())[0];
    if (current?.stripe_subscription_id && current.stripe_subscription_id !== sub.id && live(current.status) && !live(sub.status))
      return json({ ok: true, note: "kept the active subscription" });
    const row = { user_id: userId, stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, status: sub.status, current_period_end: periodEnd(sub), cancel_at_period_end: !!sub.cancel_at_period_end || Number.isFinite(sub.cancel_at), livemode: !!sub.livemode, updated_at: new Date().toISOString() };
    const w = await db("subscriptions", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) });
    if (!w.ok) throw new Error("db " + w.status);

    // Account emails (each sent once; see account-email). They never hold up Stripe's reply.
    const mail = (kind: string, key: string, data: Record<string, unknown> = {}) => fetch(`${BASE}/functions/v1/account-email`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-ingest-secret": Deno.env.get("INGEST_SECRET") || "" },
      body: JSON.stringify({ kind, user_id: userId, key, data }), signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    const mails: Promise<unknown>[] = [];
    if (event.type === "invoice.payment_failed" && o.id) mails.push(mail("pro_payment_failed", String(o.id)));
    else if (row.status === "canceled" || (live(row.status) && row.cancel_at_period_end))
      mails.push(mail("pro_cancelled", `cancel:${sub.id}`, { ends: row.status === "canceled" ? null : (Number.isFinite(sub.cancel_at) ? new Date(sub.cancel_at * 1000).toISOString() : row.current_period_end) }));
    else if (["active", "trialing"].includes(row.status)) mails.push(mail("pro_started", `start:${sub.id}`, { renews: row.current_period_end }));
    await Promise.all(mails);
    return json({ ok: true, status: sub.status });
  } catch {
    // Let Stripe retry: forget the event id so the retry is processed.
    await db(`stripe_events?id=eq.${encodeURIComponent(event.id)}`, { method: "DELETE" }).catch(() => {});
    return json({ error: "retry" }, 500);
  }
});
