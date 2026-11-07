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
