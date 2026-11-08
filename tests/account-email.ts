// deno test --allow-env --allow-read --no-check --import-map=tests/deno/import_map.json tests/account-email.ts
import { assert, assertEquals } from "./deno/assert.ts";
import { KINDS, render } from "../supabase/functions/account-email/templates.mjs";

Deno.test("every account email renders, with the operator line and no newsletter wording", () => {
  for (const k of KINDS) {
    const m = render(k, { name: "Franklin Antony", data: { renews: "2026-12-07T19:56:01Z", ends: "2026-12-07T19:56:01Z", hadPro: true }, address: "1 Main St, Somerset, NJ" });
    assert(m.subject && m.html.includes("Hi Franklin,") && m.text.includes("Hi Franklin,"), k);
    assert(m.html.includes("operated by YOU DO LMS INC"), k);
    assert(m.html.includes("not a newsletter"), k);
    assert(!/unsubscribe/i.test(m.html), k);
  }
});

Deno.test("dates and Pro details are right", () => {
  assert(render("pro_started", { data: { renews: "2026-12-07T19:56:01Z" } }).html.includes("December 7, 2026"));
  assertEquals(render("pro_cancelled", { data: { ends: "2026-12-07T19:56:01Z" } }).subject, "Your Pro subscription ends on December 7, 2026");
  assertEquals(render("pro_cancelled", { data: {} }).subject, "Your Pro subscription has ended");
  assert(render("account_deleted", { data: { hadPro: true } }).text.includes("Pro subscription has been cancelled"));
  assert(!render("account_deleted", { data: { hadPro: false } }).text.includes("Pro subscription"));
});

Deno.test("names are escaped", () => {
  const m = render("welcome", { name: "<script>x</script>" });
  assert(!m.html.includes("<script>x"));
});

Deno.test("review emails: reviewer alerts link to the Review queue; employer decisions carry the reason, escaped", async () => {
  const { render, KINDS } = await import("../supabase/functions/account-email/templates.mjs");
  for (const k of ["review_company", "review_post", "post_approved", "post_rejected", "company_suspended"]) {
    if (!KINDS.includes(k)) throw new Error("missing kind " + k);
  }
  const c = render("review_company", { data: { company: "Acme <b>", domain: "acme.com", registrant: "jane@acme.com", auto_verified: true } });
  if (!c.html.includes("employers.html#review") || c.html.includes("Acme <b>") || !c.text.includes("3 live jobs")) throw new Error("review_company");
  const p = render("review_post", { data: { company: "Acme", domain: "acme.com", title: "Analyst", apply_url: "https://evil.example/apply" } });
  if (!p.subject.includes("Analyst") || !p.html.includes("https://evil.example/apply")) throw new Error("review_post");
  const r = render("post_rejected", { name: "Jane Doe", data: { company: "Acme", title: "Analyst", note: "Fee <script>", live: true } });
  if (!r.html.includes("Fee &lt;script&gt;") || !r.html.includes("stays up") || !r.text.includes("Reason: Fee")) throw new Error("post_rejected");
  const a = render("post_approved", { data: { company: "Acme", title: "Analyst", live: false } });
  if (!a.html.includes("Make live")) throw new Error("post_approved");
  const s = render("company_suspended", { data: { company: "Acme", status: "suspended", note: "Scam posts" } });
  if (!s.subject.includes("suspended") || !s.html.includes("Scam posts")) throw new Error("company_suspended");
});
