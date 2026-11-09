// deno test --allow-env --no-check --import-map=tests/deno/import_map.json tests/billing.ts
import { assert, assertEquals } from "./deno/assert.ts";
import { form, periodEnd, verifySignature } from "../supabase/functions/billing/stripe.ts";

async function sign(payload: string, secret: string, t: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("webhook signatures: valid, tampered, stale, missing secret", async () => {
  const now = 1_800_000_000_000, t = now / 1000, body = '{"id":"evt_1"}';
  const sig = await sign(body, "whsec_x", t);
  assert(await verifySignature(body, `t=${t},v1=${sig}`, "whsec_x", now));
  assert(await verifySignature(body, `t=${t},v1=bad,v1=${sig}`, "whsec_x", now));
  assert(!(await verifySignature(body + " ", `t=${t},v1=${sig}`, "whsec_x", now)));
  assert(!(await verifySignature(body, `t=${t - 600},v1=${await sign(body, "whsec_x", t - 600)}`, "whsec_x", now)));
  assert(!(await verifySignature(body, `t=${t},v1=${sig}`, "", now)));
});

Deno.test("Stripe form encoding and period end", () => {
  const f = form({ mode: "subscription", line_items: [{ price: "price_1", quantity: 1 }], subscription_data: { metadata: { user_id: "u" } }, skip: undefined });
  assertEquals(f.get("line_items[0][price]"), "price_1");
  assertEquals(f.get("subscription_data[metadata][user_id]"), "u");
  assertEquals(f.has("skip"), false);
  assertEquals(periodEnd({ current_period_end: 1_800_000_000 }), new Date(1_800_000_000_000).toISOString());
  assertEquals(periodEnd({ items: { data: [{ current_period_end: 1_800_000_000 }] } }), new Date(1_800_000_000_000).toISOString());
  assertEquals(periodEnd({}), null);
});

Deno.test("webhook keeps its own copy of the Stripe helpers in step", async () => {
  const a = await Deno.readTextFile(new URL("../supabase/functions/billing/stripe.ts", import.meta.url));
  const b = await Deno.readTextFile(new URL("../supabase/functions/billing-webhook/stripe.ts", import.meta.url));
  assertEquals(a, b);
});

import { entitlementStatus } from "../supabase/functions/billing/stripe.ts";
import { employerBilling } from "../supabase/functions/billing/employer.ts";

Deno.test("Employer Plus: Stripe status to entitlement status", () => {
  assertEquals(entitlementStatus({ status: "active" }), "active");
  assertEquals(entitlementStatus({ status: "active", cancel_at_period_end: true }), "canceled");
  assertEquals(entitlementStatus({ status: "active", cancel_at: 1_800_000_000 }), "canceled");
  assertEquals(entitlementStatus({ status: "past_due" }), "past_due");
  for (const s of ["canceled", "unpaid", "incomplete", "incomplete_expired", ""]) assertEquals(entitlementStatus({ status: s }), "expired");
});

const ORG = "11111111-2222-4333-8444-555555555555";
const USER = { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", email: "owner@vendorco.com" };
function fakeDb(rows: Record<string, unknown[]>) {
  const writes: string[] = [];
  const db = (path: string, init: RequestInit = {}) => {
    if (init.method === "POST") { writes.push(path); return Promise.resolve(new Response("", { status: 201 })); }
    const table = path.split("?")[0];
    return Promise.resolve(new Response(JSON.stringify(rows[table] || []), { status: 200 }));
  };
  return { db, writes };
}
function fakeStripe() {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit = {}) => {
    const path = String(url).replace("https://api.stripe.com/v1/", "").split("?")[0];
    calls.push(`${init.method} ${path}${init.body ? "?" + init.body : ""}`);
    const body = path === "prices" && init.method === "GET" ? { data: [{ id: "price_plus" }] }
      : path === "customers" ? { id: "cus_new", livemode: true }
      : path === "subscriptions" ? { data: [] }
      : path === "checkout/sessions" ? { url: "https://checkout.stripe.com/c/pay_1" }
      : path === "billing_portal/sessions" ? { url: "https://billing.stripe.com/p/1" } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

Deno.test("Employer Plus checkout: owner of a verified company only, one per company", async () => {
  const s = fakeStripe();
  try {
    const none = fakeDb({ employer_org_members: [] });
    assertEquals((await employerBilling("employer_checkout", ORG, USER, "sk_live_x", none.db)).status, 403);
    assertEquals((await employerBilling("employer_checkout", "nope", USER, "sk_live_x", none.db)).status, 400);
    const base = { employer_org_members: [{ user_id: USER.id }], employer_billing_config: [{ paid_publishing_enabled: true }] };
    const pending = fakeDb({ ...base, employer_orgs: [{ name: "VendorCo", status: "pending" }] });
    assertEquals((await employerBilling("employer_checkout", ORG, USER, "sk_live_x", pending.db)).body.error, "Employer Plus is available once your company is verified.");
    const has = fakeDb({ ...base, employer_orgs: [{ name: "VendorCo", status: "verified" }], employer_entitlements: [{ status: "active", paid_through: "2999-01-01T00:00:00Z" }] });
    assertEquals((await employerBilling("employer_checkout", ORG, USER, "sk_live_x", has.db)).status, 409);
    const ok = fakeDb({ ...base, employer_orgs: [{ name: "VendorCo", status: "verified" }] });
    const r = await employerBilling("employer_checkout", ORG, USER, "sk_live_x", ok.db);
    assertEquals(r.body.url, "https://checkout.stripe.com/c/pay_1");
    assert(ok.writes.includes("employer_billing_customers"));
    const session = decodeURIComponent(s.calls.find((c) => c.startsWith("POST checkout/sessions"))!);
    assert(session.includes("subscription_data[metadata][kind]=employer_plus"));
    assert(session.includes(`subscription_data[metadata][org_id]=${ORG}`));
    assert(session.includes("line_items[0][price]=price_plus"));
  } finally { s.restore(); }
});

Deno.test("Employer Plus portal needs an existing customer", async () => {
  const s = fakeStripe();
  try {
    const base = { employer_org_members: [{ user_id: USER.id }], employer_orgs: [{ name: "VendorCo", status: "verified" }] };
    assertEquals((await employerBilling("employer_portal", ORG, USER, "sk_live_x", fakeDb(base).db)).status, 400);
    const r = await employerBilling("employer_portal", ORG, USER, "sk_live_x", fakeDb({ ...base, employer_billing_customers: [{ stripe_customer_id: "cus_1" }] }).db);
    assertEquals(r.body.url, "https://billing.stripe.com/p/1");
  } finally { s.restore(); }
});
