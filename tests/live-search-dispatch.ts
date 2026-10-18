// Live Search dispatch. The shared secret must reach Make in the request header
// only, never in the JSON body (Make keeps bodies in its execution history). A
// refused dispatch must release its slot. Offline: stubs Deno.serve, the database
// and Make; nothing is sent anywhere.
//   deno test --allow-env --allow-read --import-map=tests/deno/import_map.json tests/live-search-dispatch.ts
import { assert, assertEquals } from "./deno/assert.ts";

const SB = "https://fake.supabase.test";
const MAKE = "https://make.fixture.test/hook";
const SECRET = "fixture-gateway-secret-do-not-use";
Deno.env.set("SUPABASE_URL", SB);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service");
Deno.env.set("CLIENT_HASH_SALT", "fixture-salt");
Deno.env.set("MAKE_LIVE_WEBHOOK_URL", MAKE);
Deno.env.set("MAKE_GATEWAY_SECRET", SECRET);
Deno.env.delete("GATEWAY_TEST_KEY");

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

let dbCalls: string[] = [];
let makeRequests: { headers: Headers; body: string }[] = [];
let makeStatus = 202;
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.href === MAKE) {
    makeRequests.push({ headers: new Headers(init?.headers), body: String(init?.body ?? "") });
    return new Response("Accepted", { status: makeStatus });
  }
  assertEquals(url.origin, SB, `unexpected outbound request to ${url.origin}`);
  dbCalls.push(url.pathname);
  if (url.pathname === "/rest/v1/live_search_limits") return Response.json([LIMITS]);
  if (url.pathname === "/rest/v1/rpc/live_search_try_admit") return Response.json({ admitted: true });
  if (url.pathname === "/rest/v1/rpc/live_search_settle") return Response.json({});
  if (url.pathname === "/rest/v1/rpc/live_search_mark_unconfirmed") return Response.json({});
  throw new Error(`unexpected database call ${url.pathname}`);
}) as typeof fetch;

const search = () =>
  new Request("https://fake.live-search.test/", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://fortunejobsai.com" },
    body: JSON.stringify({ text: "data analyst", location: "New Jersey", location_scope: "region" }),
  });

Deno.test("the secret reaches Make in the header and never in the body", async () => {
  dbCalls = []; makeRequests = []; makeStatus = 202;
  const res = await serve(search());
  assertEquals(res.status, 202);
  const body = await res.json();
  assert(String(body.search_id).startsWith("s_"), "the gateway mints the search id");
  assertEquals(makeRequests.length, 1, "exactly one dispatch");
  assertEquals(makeRequests[0].headers.get("x-fj-gateway-secret"), SECRET);
  assert(!makeRequests[0].body.includes(SECRET), "the secret must not appear in the request body");
  const sent = JSON.parse(makeRequests[0].body);
  assertEquals(sent.search_id, body.search_id, "Make receives the id the page will poll with");
  assertEquals(sent.mode, "live");
  assertEquals(sent.location_scope, "region");
});

Deno.test("a refused dispatch releases its slot and reports upstream_rejected", async () => {
  dbCalls = []; makeRequests = []; makeStatus = 500;
  const res = await serve(search());
  assertEquals(res.status, 502);
  assertEquals((await res.json()).reason, "upstream_rejected");
  assertEquals(dbCalls.filter((p) => p.endsWith("/live_search_settle")).length, 1, "a conclusive refusal settles the slot");
  makeStatus = 202;
});
