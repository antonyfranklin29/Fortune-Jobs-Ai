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
