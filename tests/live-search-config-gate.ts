// Live Search configuration gate. An unconfigured gateway (no Make webhook or
// secret) must refuse the request BEFORE admission, so it consumes no visitor
// allowance and reserves no capacity. An authorised dry run must still be
// admitted without Make. Offline: stubs Deno.serve, the database and Make.
//   deno test --allow-env --allow-read --import-map=tests/deno/import_map.json tests/live-search-config-gate.ts
import { assert, assertEquals } from "./deno/assert.ts";

const SB = "https://fake.supabase.test";
const TEST_KEY = "fixture-dry-run-key";
Deno.env.set("SUPABASE_URL", SB);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service");
Deno.env.set("CLIENT_HASH_SALT", "fixture-salt");
Deno.env.set("GATEWAY_TEST_KEY", TEST_KEY);
// The gateway is deliberately NOT configured for Make in this test.
Deno.env.delete("MAKE_LIVE_WEBHOOK_URL");
Deno.env.delete("MAKE_GATEWAY_SECRET");

type Handler = (req: Request) => Promise<Response>;
let handler: Handler | null = null;
(Deno as unknown as { serve: unknown }).serve = (h: Handler) => {
  handler = h;
  return {};
};
await import("../supabase/functions/live-search/index.ts");
assert(handler, "live-search registers its request handler");
const serve: Handler = handler;

const LIMITS = {
  max_concurrent: 5, per_client_per_minute: 5, per_client_per_hour: 20, per_client_per_day: 50,
  global_per_hour: 500, global_per_day: 5000, slot_seconds: 300, queue_wait_ms: 0,
  max_query_chars: 200, paused: false,
};

// Every database call the gateway makes goes through here. Anything else (in
// particular any call to Make) fails the test immediately.
let calls: string[] = [];
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: Request | URL | string) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assertEquals(url.origin, SB, `unexpected outbound request to ${url.origin}`);
  calls.push(url.pathname);
  if (url.pathname === "/rest/v1/live_search_limits") return Response.json([LIMITS]);
  if (url.pathname === "/rest/v1/rpc/live_search_try_admit") return Response.json({ admitted: true });
  if (url.pathname === "/rest/v1/rpc/live_search_settle") return Response.json({});
  throw new Error(`unexpected database call ${url.pathname}`);
}) as typeof fetch;

const admissions = () => calls.filter((p) => p.endsWith("/live_search_try_admit")).length;
const settles = () => calls.filter((p) => p.endsWith("/live_search_settle")).length;
const search = (headers: Record<string, string> = {}) =>
  new Request("https://fake.live-search.test/", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ text: "backend engineer" }),
  });

Deno.test("unconfigured gateway refuses before admission, however often it is asked", async () => {
  calls = [];
  for (let i = 0; i < 3; i++) {
    const res = await serve(search());
    assertEquals(res.status, 503);
    assertEquals(res.headers.get("retry-after"), "60");
    assertEquals((await res.json()).reason, "gateway_not_configured");
  }
  assertEquals(admissions(), 0, "a misconfigured request must not be admitted");
  assertEquals(settles(), 0, "nothing was admitted, so nothing needs settling");
});

Deno.test("a wrong dry-run key is refused the same way", async () => {
  calls = [];
  const res = await serve(search({ "x-fj-test-key": "not-the-key" }));
  assertEquals(res.status, 503);
  assertEquals((await res.json()).reason, "gateway_not_configured");
  assertEquals(admissions(), 0);
});

Deno.test("an authorised dry run is still admitted without Make", async () => {
  calls = [];
  const res = await serve(search({ "x-fj-test-key": TEST_KEY }));
  assertEquals(res.status, 202);
  const body = await res.json();
  assertEquals(body.status, "accepted");
  assertEquals(body.dry_run, true);
  assertEquals(admissions(), 1, "dry run holds its slot exactly like a real search");
  assertEquals(settles(), 0, "the completion trigger releases the slot, not the handler");
});
