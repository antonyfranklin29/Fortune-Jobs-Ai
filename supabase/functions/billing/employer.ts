// Employer Plus checkout and billing portal for one company (org). Only an active owner of a
// verified company may buy or manage it. The subscription carries metadata kind=employer_plus and
// org_id; billing-webhook turns Stripe's events into employer_entitlements rows.
import { EMPLOYER_PLUS, stripe } from "./stripe.ts";

const SITE = "https://fortunejobsai.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Db = (path: string, init?: RequestInit) => Promise<Response>;

async function plusPrice(secret: string) {
  const found = await stripe(secret, "GET", "prices", { lookup_keys: [EMPLOYER_PLUS.lookupKey], active: true, limit: 1 });
  if (found.data?.[0]?.id) return found.data[0].id as string;
  const product = await stripe(secret, "POST", "products", { name: EMPLOYER_PLUS.name, description: "Up to 50 live job posts at a time for one company on Fortune Jobs AI." });
  const price = await stripe(secret, "POST", "prices", { product: product.id, unit_amount: EMPLOYER_PLUS.amount, currency: EMPLOYER_PLUS.currency, recurring: { interval: EMPLOYER_PLUS.interval }, lookup_key: EMPLOYER_PLUS.lookupKey, transfer_lookup_key: true });
  return price.id as string;
}

export async function employerBilling(action: string, orgId: unknown, user: { id: string; email: string }, secret: string, db: Db): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!UUID.test(String(orgId || ""))) return { status: 400, body: { error: "Choose a company first." } };
  const owner = (await (await db(`employer_org_members?org_id=eq.${orgId}&user_id=eq.${user.id}&role=eq.owner&status=eq.active&select=user_id`)).json())[0];
  if (!owner) return { status: 403, body: { error: "Only the company owner can manage Employer Plus." } };
  const org = (await (await db(`employer_orgs?id=eq.${orgId}&select=name,status`)).json())[0];
  const config = (await (await db("employer_billing_config?select=paid_publishing_enabled&id=eq.true")).json())[0];
  const known = (await (await db(`employer_billing_customers?org_id=eq.${orgId}&select=stripe_customer_id`)).json())[0];
  let customer = known?.stripe_customer_id as string | undefined;

  if (action === "employer_portal") {
    if (!customer) return { status: 400, body: { error: "This company does not have Employer Plus yet." } };
    const portal = await stripe(secret, "POST", "billing_portal/sessions", { customer, return_url: `${SITE}/employers.html#plan` });
    return { status: 200, body: { url: portal.url } };
  }
  if (!config?.paid_publishing_enabled) return { status: 403, body: { error: "Employer Plus is not available yet." } };
  if (org?.status !== "verified") return { status: 403, body: { error: "Employer Plus is available once your company is verified." } };
  const ent = (await (await db(`employer_entitlements?org_id=eq.${orgId}&select=status,paid_through`)).json())[0];
  if (ent && ["active", "canceled", "past_due"].includes(ent.status) && (!ent.paid_through || Date.parse(ent.paid_through) > Date.now()))
    return { status: 409, body: { error: "This company already has Employer Plus. Use Manage billing to change it.", already: true } };
  if (customer) {
    const subs = await stripe(secret, "GET", "subscriptions", { customer, status: "all", limit: 10 });
    if ((subs.data || []).some((x: Record<string, any>) => ["active", "trialing", "past_due"].includes(x.status)))
      return { status: 409, body: { error: "This company already has Employer Plus. It can take a minute to show here.", already: true } };
  } else {
    const c = await stripe(secret, "POST", "customers", { email: user.email, name: org?.name || undefined, metadata: { org_id: String(orgId), site: "fortunejobsai", kind: "employer_plus" } });
    customer = c.id;
    const w = await db("employer_billing_customers", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ org_id: orgId, stripe_customer_id: customer, livemode: !!c.livemode, created_by: user.id }) });
    if (!w.ok) {
      // Another tab created it first: use that one.
      customer = (await (await db(`employer_billing_customers?org_id=eq.${orgId}&select=stripe_customer_id`)).json())[0]?.stripe_customer_id;
      if (!customer) throw new Error("customer");
    }
  }
  const session = await stripe(secret, "POST", "checkout/sessions", {
    mode: "subscription", customer, client_reference_id: String(orgId),
    line_items: [{ price: await plusPrice(secret), quantity: 1 }],
    subscription_data: { metadata: { org_id: String(orgId), site: "fortunejobsai", kind: "employer_plus", bought_by: user.id }, description: `Employer Plus for ${org?.name || "your company"}` },
    success_url: `${SITE}/employers.html?plus=welcome#plan`, cancel_url: `${SITE}/employers.html?plus=cancelled#plan`,
    allow_promotion_codes: true,
  });
  return { status: 200, body: { url: session.url } };
}
