// Job alert emails (supabase/functions/job-alerts). Offline: Deno.serve, PostgREST, Auth and
// Resend are stubbed in memory; no real account, row or email is touched.
//   deno test --allow-env --allow-read --import-map=tests/deno/import_map.json tests/job-alerts.ts
import { assert, assertEquals } from "./deno/assert.ts";
import { alertQuery, pickJobs, unsubscribeToken, type Job } from "../supabase/functions/job-alerts/select.ts";

const SB = "https://fake.supabase.test";
Deno.env.set("SUPABASE_URL", SB);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service");
Deno.env.set("INGEST_SECRET", "fixture-ingest-secret");

type Handler = (req: Request) => Promise<Response>;
let handler: Handler | null = null;
(Deno as unknown as { serve: unknown }).serve = (h: Handler) => { handler = h; return {}; };
await import("../supabase/functions/job-alerts/index.ts");
assert(handler, "job-alerts registers its handler");
const serve: Handler = handler;

const NOW = Date.now();
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3600000).toISOString();
const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222";
const JOBS: Job[] = [
  { job_title: "Power BI Developer", company: "Acme", location: "Newark, NJ", apply_url: "https://www.adzuna.com/land/ad/123", posted_at: iso(3) },
  { job_title: "Senior Power BI Developer", company: "Beta", location: "Remote", work_mode: "Remote", apply_url: "https://jobs.beta.test/1", posted_at: iso(5) },
  { job_title: "Power BI Developer", company: "Gamma", location: "Austin, TX", apply_url: "https://jobs.gamma.test/1", posted_at: iso(2) },
  { job_title: "Data Engineer", company: "Delta", location: "Newark, NJ", apply_url: "https://jobs.delta.test/1", posted_at: iso(1) },
  { job_title: "Power BI Developer", company: "Old Co", location: "Edison, New Jersey", apply_url: "https://jobs.old.test/1", posted_at: iso(24 * 5) },
];
const world = {
  prefs: [] as { user_id: string; frequency: string; subscribed: boolean }[],
  profiles: {} as Record<string, unknown>,
  claims: 0, sent: [] as Record<string, unknown>[], patches: [] as unknown[], resendStatus: 200,
};
const reset = () => Object.assign(world, {
  prefs: [{ user_id: U1, frequency: "daily", subscribed: true }, { user_id: U2, frequency: "weekly", subscribed: true }],
  profiles: { [U1]: { full_name: "Ana Lee", current_title: "Power BI Developer", saved_filters: { location: "New Jersey", country: "us" } }, [U2]: { full_name: "No Area", current_title: "Analyst", saved_filters: {} } },
  claims: 0, sent: [], patches: [], resendStatus: 200,
});

(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input), method = init?.method || "GET";
  if (url.startsWith(`${SB}/rest/v1/newsletter_preferences?subscribed=eq.true`)) return Response.json(world.prefs.filter((p) => p.subscribed));
  if (url.startsWith(`${SB}/rest/v1/newsletter_preferences?user_id=eq.`)) return Response.json([{ subscribed: world.prefs.find((p) => url.includes(p.user_id))?.subscribed }]);
  if (url.startsWith(`${SB}/rest/v1/profiles?id=eq.`)) return Response.json([world.profiles[url.split("id=eq.")[1].split("&")[0]]].filter(Boolean));
  if (url.startsWith(`${SB}/rest/v1/pre_scraped_jobs?`)) return Response.json(JOBS);
  if (url === `${SB}/rest/v1/rpc/newsletter_claim`) { world.claims++; return Response.json(`claim-${world.claims}`); }
  if (url.startsWith(`${SB}/rest/v1/newsletter_deliveries?id=eq.`)) { world.patches.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 }); }
  if (url.startsWith(`${SB}/auth/v1/admin/users/`)) return Response.json({ email: "ana@example.test", email_confirmed_at: "2026-11-01T00:00:00Z" });
  if (url === "https://api.resend.com/emails") {
    world.sent.push(JSON.parse(String(init?.body)));
    return world.resendStatus === 200 ? Response.json({ id: "re_1" }) : new Response("{}", { status: world.resendStatus });
  }
  throw new Error(`Unexpected fetch ${method} ${url}`);
}) as typeof fetch;

const call = (body: unknown, secret = "fixture-ingest-secret") =>
  serve(new Request("https://fn.test/job-alerts", { method: "POST", headers: { "x-ingest-secret": secret, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const liveEnv = (on: boolean) => {
  for (const [k, v] of Object.entries({ NEWSLETTER_ENABLED: "true", RESEND_API_KEY: "re_fixture", NEWSLETTER_POSTAL_ADDRESS: "1553 Route 27, Suite 1000, Somerset, NJ 08873", NEWSLETTER_UNSUBSCRIBE_SECRET: "x".repeat(40) })) on ? Deno.env.set(k, v) : Deno.env.delete(k);
};

Deno.test("only the scheduler can call it", async () => {
  reset();
  assertEquals((await call({ send: true }, "wrong")).status, 401);
});

Deno.test("dry run by default: counts, sends nothing", async () => {
  reset(); liveEnv(true);
  const r = await (await call({})).json();
  assertEquals(r, { dryRun: true, due: 2, withJobs: 1, sent: 0, skipped: 1, failed: 0 });
  assertEquals(world.sent.length, 0); assertEquals(world.claims, 0);
});

Deno.test("never sends without full email configuration, even when asked", async () => {
  reset(); liveEnv(false);
  const r = await (await call({ send: true })).json();
  assertEquals(r.dryRun, true); assertEquals(world.sent.length, 0);
});

Deno.test("live: daily email with matching jobs, unsubscribe headers and company address", async () => {
  reset(); liveEnv(true);
  const r = await (await call({ send: true })).json();
  assertEquals(r, { dryRun: false, due: 2, withJobs: 1, sent: 1, skipped: 1, failed: 0 });
  const mail = world.sent[0] as { to: string[]; subject: string; html: string; text: string; headers: Record<string, string> };
  assertEquals(mail.to, ["ana@example.test"]);
  assertEquals(mail.subject, "2 new jobs for you today · Fortune Jobs AI");
  assert(mail.html.includes("Acme") && mail.html.includes("Beta") && !mail.html.includes("Gamma") && !mail.html.includes("Old Co"), "area + remote + fresh only");
  assert(mail.html.includes("https://www.adzuna.com/details/123"), "dead Adzuna links are rewritten");
  assert(mail.html.includes("YOU DO LMS INC.") && mail.html.includes("Somerset, NJ"), "company and postal address");
  assert(mail.headers["List-Unsubscribe"].includes("/functions/v1/email-preferences?token="), "one-click unsubscribe");
  assertEquals(world.patches, [{ state: "accepted", provider_id: "re_1" }]);
});

Deno.test("an unsubscribe that lands mid-run suppresses the email", async () => {
  reset(); liveEnv(true);
  const orig = world.prefs[0];
  world.prefs = [{ ...orig }];
  // claim succeeds, but by re-check time the person has unsubscribed
  const fetch0 = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (i: Request | URL | string, init?: RequestInit) => {
    if (String(i).includes("rpc/newsletter_claim")) world.prefs[0].subscribed = false;
    return fetch0(i, init);
  }) as typeof fetch;
  const r = await (await call({ send: true })).json();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetch0;
  assertEquals(world.sent.length, 0); assertEquals(r.skipped, 1);
  assertEquals(world.patches, [{ state: "suppressed" }]);
});

Deno.test("a provider failure is recorded as unknown and never retried automatically", async () => {
  reset(); liveEnv(true); world.resendStatus = 500;
  const r = await (await call({ send: true })).json();
  assertEquals(r.failed, 1); assertEquals(world.patches, [{ state: "unknown" }]);
});

Deno.test("selection: needs a role and an area; matches state names and codes; 5 max", () => {
  assertEquals(alertQuery({ current_title: "Analyst" }, "daily"), null);
  assertEquals(alertQuery({ saved_filters: { location: "NJ" } }, "daily"), null);
  const q = alertQuery({ current_title: "Power BI Developer", preferred_locations: ["NJ"] }, "weekly", NOW)!;
  assert(q.places.includes("new jersey") && q.places.includes(", nj"), "NJ expands to the state name");
  const picked = pickJobs(JOBS, q, NOW).map((j) => j.company);
  assertEquals(picked, ["Acme", "Beta", "Old Co"]); // weekly window includes the 5-day-old job
  const many = Array.from({ length: 9 }, (_, i) => ({ ...JOBS[0], company: `C${i}`, apply_url: `https://x.test/${i}` }));
  assertEquals(pickJobs(many, q, NOW).length, 5);
});

Deno.test("unsubscribe token matches what email-preferences verifies", async () => {
  const token = await unsubscribeToken(U1, "s".repeat(40));
  const [payload, sig] = token.split(".");
  assertEquals(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), U1);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("s".repeat(40)), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - sig.length % 4) % 4)), (c) => c.charCodeAt(0));
  assert(await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(payload)), "signature verifies");
});
