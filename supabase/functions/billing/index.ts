// billing: starts a Stripe Checkout for Fortune Jobs AI Pro, or opens the Stripe customer portal
// (change card, cancel). Signed-in users only. Deploy with --no-verify-jwt: the token is checked here.
// Secret: STRIPE_SECRET_KEY (a test key, sk_test_…, until real payments are switched on).
// The $9.99/month price is created once in Stripe (lookup key fortune_pro_monthly) and reused.
import { PRO, periodEnd, stripe } from "./stripe.ts";
import { employerBilling } from "./employer.ts";

const BASE = Deno.env.get("SUPABASE_URL") || "https://hqgakkcxcyspqhnlnscv.supabase.co";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE = "https://fortunejobsai.com";
const ORIGINS = ["https://fortunejobsai.com", "https://www.fortunejobsai.com"];
const TEST_USERS = "252d4e5d-294b-4c48-8c99-4153f1470dd5"; // the owner's account, for test-mode checkouts

const db = (path: string, init: RequestInit = {}) => fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(8000) });

async function proPrice(secret: string) {
  const found = await stripe(secret, "GET", "prices", { lookup_keys: [PRO.lookupKey], active: true, limit: 1 });
  if (found.data?.[0]?.id) return found.data[0].id as string;
  const product = await stripe(secret, "POST", "products", { name: PRO.name, description: "50 results per search and 50 AI Coach actions a day." });
  const price = await stripe(secret, "POST", "prices", { product: product.id, unit_amount: PRO.amount, currency: PRO.currency, recurring: { interval: PRO.interval }, lookup_key: PRO.lookupKey, transfer_lookup_key: true });
  return price.id as string;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = { "Access-Control-Allow-Origin": origin && ORIGINS.includes(origin) ? origin : ORIGINS[0], "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "POST,OPTIONS", Vary: "Origin", "Cache-Control": "no-store" };
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (origin && !ORIGINS.includes(origin)) return json({ error: "Origin not allowed" }, 403);
  const secret = Deno.env.get("STRIPE_SECRET_KEY") || "";
  if (!secret) return json({ error: "Subscriptions are not switched on yet." }, 503);
  try {
    const bearer = req.headers.get("Authorization");
    if (!bearer?.startsWith("Bearer ")) return json({ error: "Sign in to subscribe.", status: 401 }, 401);
    const check = await fetch(`${BASE}/auth/v1/user`, { headers: { apikey: KEY, Authorization: bearer }, signal: AbortSignal.timeout(8000) });
    const user = check.ok ? await check.json() : null;
    if (!user?.id) return json({ error: "Sign in to subscribe.", status: 401 }, 401);
    if (!user.email_confirmed_at) return json({ error: "Confirm your email address first." }, 403);
    let body: { action?: string; org?: string } = {};
    try { body = await req.json(); } catch { /* empty */ }
    if (body.action === "employer_checkout" || body.action === "employer_portal") {
      // Employer Plus is bought per company and never uses a test key.
      if (secret.startsWith("sk_test_")) return json({ error: "Employer Plus is launching soon." }, 403);
      const r = await employerBilling(body.action, body.org, { id: user.id, email: user.email }, secret, db);
      return json(r.body, r.status);
    }

    const row = (await (await db(`subscriptions?user_id=eq.${user.id}&select=stripe_customer_id,status,current_period_end`)).json())[0];
    let customer = row?.stripe_customer_id as string | undefined;

    if (body.action === "portal") {
      if (!customer) return json({ error: "You don't have a subscription yet." }, 400);
      const portal = await stripe(secret, "POST", "billing_portal/sessions", { customer, return_url: `${SITE}/profile.html#subscription` });
      return json({ url: portal.url });
    }
    if (body.action !== "checkout") return json({ error: "Unknown action" }, 400);
    // With a test key only named testers may start a checkout, so nobody gets Pro with a test card.
    const testers = (Deno.env.get("BILLING_TEST_USERS") || TEST_USERS).split(",").map((x) => x.trim());
    if (secret.startsWith("sk_test_") && !testers.includes(user.id)) return json({ error: "Pro is launching soon." }, 403);
    if (row && ["active", "trialing"].includes(row.status) && (!row.current_period_end || Date.parse(row.current_period_end) > Date.now()))
      return json({ error: "You already have Pro. Manage it from your profile.", already: true }, 409);

    // Ask Stripe too, not just our table, so a second tab or a delayed webhook can't create a second
    // subscription. If Stripe already has one, record it and send the person to their profile.
    if (customer) {
      const subs = await stripe(secret, "GET", "subscriptions", { customer, status: "all", limit: 10 });
      const open = (subs.data || []).find((x: Record<string, any>) => ["active", "trialing", "past_due"].includes(x.status));
      if (open) {
        await db("subscriptions", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id: user.id, stripe_customer_id: customer, stripe_subscription_id: open.id, status: open.status, current_period_end: periodEnd(open), cancel_at_period_end: !!open.cancel_at_period_end || Number.isFinite(open.cancel_at), livemode: !!open.livemode, updated_at: new Date().toISOString() }) });
        return json({ error: "You already have Pro. Manage it from your profile.", already: true }, 409);
      }
    }
    if (!customer) {
      const c = await stripe(secret, "POST", "customers", { email: user.email, metadata: { user_id: user.id, site: "fortunejobsai" } });
      customer = c.id;
      await db("subscriptions", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id: user.id, stripe_customer_id: customer, livemode: !!c.livemode, updated_at: new Date().toISOString() }) });
    }
    const session = await stripe(secret, "POST", "checkout/sessions", {
      mode: "subscription", customer, client_reference_id: user.id,
      line_items: [{ price: await proPrice(secret), quantity: 1 }],
      subscription_data: { metadata: { user_id: user.id, site: "fortunejobsai" }, description: "Fortune Jobs AI Pro" },
      success_url: `${SITE}/profile.html?pro=welcome#subscription`, cancel_url: `${SITE}/results.html?pro=cancelled`,
      allow_promotion_codes: true,
    });
    return json({ url: session.url });
  } catch {
    return json({ error: "Payments are unavailable right now. Please try again in a minute." }, 503);
  }
});
