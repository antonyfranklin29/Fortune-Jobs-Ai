// Domain-proof edge function against a fake Supabase and a stubbed DNS resolver.
//   deno test --allow-env --no-check --import-map=tests/deno/import_map.json tests/employer-submissions-edge.ts
import { assert, assertEquals } from "./deno/assert.ts";

const SB = "https://fake.supabase.test";
Deno.env.set("SUPABASE_URL", SB);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
(globalThis as Record<string, unknown>).__EMPLOYER_TEST__ = true;

const ORG = "3f1c2d4e-1111-4222-8333-444455556666";
const USER = "9a9a9a9a-1111-4222-8333-444455556666";
const OTHER = "8b8b8b8b-1111-4222-8333-444455556666";
const TOKEN = "0123456789abcdef0123456789abcdef";
const state = { checked_at: null as string | null, verified: false, marks: [] as string[], lookups: [] as string[] };
let dns: string[][] = [];

(Deno as unknown as { resolveDns: unknown }).resolveDns = (name: string, type: string) => {
  assertEquals(type, "TXT"); state.lookups.push(name); return Promise.resolve(dns);
};
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!url.href.startsWith(SB)) throw new Error(`unexpected network call: ${url.host}`);
  const auth = new Headers(init?.headers).get("authorization") ?? "";
  if (url.pathname === "/auth/v1/user") {
    if (auth === "Bearer user-token") return Response.json({ id: USER, email_confirmed_at: "2026-10-01T00:00:00Z" });
    if (auth === "Bearer other-token") return Response.json({ id: OTHER, email_confirmed_at: "2026-10-01T00:00:00Z" });
    if (auth === "Bearer unconfirmed") return Response.json({ id: OTHER, email_confirmed_at: null });
    return new Response("{}", { status: 401 });
  }
  assertEquals(auth, "Bearer service-key", "database calls use the server credential");
  const q = url.searchParams;
  if (url.pathname === "/rest/v1/employer_org_members") return Response.json(q.get("user_id") === `eq.${USER}` && q.get("org_id") === `eq.${ORG}` ? [{ org_id: ORG }] : []);
  if (url.pathname === "/rest/v1/employer_orgs") return Response.json([{ primary_domain: "acme.com", status: "pending", domain_verified_at: state.verified ? "2026-10-15T00:00:00Z" : null }]);
  if (url.pathname === "/rest/v1/employer_domain_challenges") return Response.json([{ token: TOKEN, checked_at: state.checked_at }]);
  if (url.pathname === "/rest/v1/rpc/employer_mark_domain_verified") {
    const b = JSON.parse(String(init?.body));
    state.marks.push(b.p_token); state.checked_at = new Date().toISOString();
    if (b.p_token === TOKEN) state.verified = true;
    return Response.json(b.p_token === TOKEN);
  }
  throw new Error(`unhandled ${url.pathname}`);
}) as typeof fetch;

const { handler } = await import("../supabase/functions/employer-submissions/index.ts");
const call = (token: string | null, body: unknown) => handler(new Request("https://fn.test", {
  method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", origin: "https://fortunejobsai.com" },
  body: JSON.stringify(body) })).then(async (r: Response) => ({ status: r.status, body: await r.json() }));

Deno.test("anonymous, anon-key and unconfirmed callers are refused", async () => {
  assertEquals((await call(null, { action: "check_domain", org_id: ORG })).status, 401);
  assertEquals((await call("service-key", { action: "check_domain", org_id: ORG })).status, 401);
  assertEquals((await call("unconfirmed", { action: "check_domain", org_id: ORG })).status, 403);
});

Deno.test("non-members learn nothing and trigger no lookup", async () => {
  const r = await call("other-token", { action: "check_domain", org_id: ORG });
  assertEquals(r.status, 404);
  assertEquals(state.lookups.length, 0);
});

Deno.test("requests cannot steer the lookup or ask for anything but a check", async () => {
  assertEquals((await call("user-token", { action: "approve", org_id: ORG })).status, 400);
  assertEquals((await call("user-token", { action: "check_domain", org_id: "x' or 1=1" })).status, 400);
  assertEquals(state.lookups.length, 0);
});

Deno.test("missing record: not verified, attempt recorded, then rate-limited", async () => {
  dns = [["some-other=thing"]];
  const r = await call("user-token", { action: "check_domain", org_id: ORG, domain: "evil.internal" });
  assertEquals(r.status, 200);
  assertEquals(r.body.verified, false);
  assertEquals(state.lookups, ["_fortunejobsai.acme.com"], "domain comes from the database, not the request");
  assertEquals(state.marks, ["no-match"], "the real token is never sent on a mismatch");
  assertEquals((await call("user-token", { action: "check_domain", org_id: ORG })).status, 429);
});

Deno.test("matching record verifies the domain", async () => {
  state.checked_at = new Date(Date.now() - 120_000).toISOString();
  dns = [["fortunejobsai-verify=", TOKEN]];
  const r = await call("user-token", { action: "check_domain", org_id: ORG });
  assertEquals(r.body.verified, true);
  assert(state.verified);
  assertEquals((await call("user-token", { action: "check_domain", org_id: ORG })).body.verified, true, "idempotent once verified");
});
