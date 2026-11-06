// AI features (supabase/functions/ai-assist). Offline: Deno.serve, Auth, PostgREST and the
// Anthropic API are stubbed in memory, so no real account, row or AI call is used.
//   deno test --allow-env --allow-read --import-map=tests/deno/import_map.json tests/ai-assist.ts
import { assert, assertEquals } from "./deno/assert.ts";
import { buildPrompt, readInput, labelShortlist, InputError } from "../supabase/functions/ai-assist/tasks.ts";

const SB = "https://fake.supabase.test";
Deno.env.set("SUPABASE_URL", SB);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service");

type Handler = (req: Request) => Promise<Response>;
let handler: Handler | null = null;
(Deno as unknown as { serve: unknown }).serve = (h: Handler) => { handler = h; return {}; };
await import("../supabase/functions/ai-assist/index.ts");
assert(handler, "ai-assist registers its request handler");
const serve: Handler = handler;

const UID = "11111111-1111-4111-8111-111111111111";
const world = { confirmed: true, resume: "Data Analyst at Acme 2021–2025. SQL, Power BI, Python.", usedToday: 0, globalToday: 0, employer: false, aiStatus: 200, inserts: [] as unknown[], aiBodies: [] as Record<string, unknown>[] };
const reset = () => Object.assign(world, { confirmed: true, resume: "Data Analyst at Acme 2021–2025. SQL, Power BI, Python.", usedToday: 0, globalToday: 0, employer: false, aiStatus: 200, inserts: [], aiBodies: [] });

(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method || "GET";
  if (url === SB + "/auth/v1/user") {
    const auth = new Headers(init?.headers).get("Authorization");
    return auth === "Bearer good" ? Response.json({ id: UID, email_confirmed_at: world.confirmed ? "2026-11-01T00:00:00Z" : null }) : new Response("", { status: 401 });
  }
  if (url.startsWith(SB + "/rest/v1/ai_usage")) {
    if (method === "HEAD") return new Response(null, { headers: { "content-range": `0-0/${url.includes("user_id=eq.") ? world.usedToday : world.globalToday}` } });
    if (method === "POST") { world.inserts.push(JSON.parse(String(init?.body))); return new Response(null, { status: 201 }); }
  }
  if (url.startsWith(SB + "/rest/v1/profiles")) return Response.json(world.resume ? [{ resume_text: world.resume }] : [{ resume_text: null }]);
  if (url.startsWith(SB + "/rest/v1/employer_org_members")) return Response.json(world.employer ? [{ org_id: "o1" }] : []);
  if (url === "https://api.anthropic.com/v1/messages") {
    const body = JSON.parse(String(init?.body)); world.aiBodies.push(body);
    assertEquals(new Headers(init?.headers).get("x-api-key"), "fixture-ai-key");
    if (world.aiStatus !== 200) return new Response("{}", { status: world.aiStatus });
    const name = body.tool_choice.name;
    const input = name === "shortlist" ? { ranking: [{ id: 2, fit: "strong", strengths: [], concerns: [] }, { id: 9, fit: "weak" }, { id: 1, fit: "good", strengths: [], concerns: [] }], note: "Check each résumé." } : { headline: "ok", fit: "good" };
    return Response.json({ content: [{ type: "tool_use", name, input }], usage: { input_tokens: 1200, output_tokens: 300 } });
  }
  throw new Error("Unexpected fetch " + method + " " + url);
}) as typeof fetch;

const post = (body: unknown, token = "good", origin = "https://fortunejobsai.com") =>
  serve(new Request("https://fn.test/ai-assist", { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const job = { title: "Power BI Developer", company: "Fixture Co", description: "Build Power BI dashboards with DAX and SQL." };

Deno.test("switched off without an Anthropic key", async () => {
  reset(); Deno.env.delete("ANTHROPIC_API_KEY");
  const r = await post({ task: "fit_explain", job });
  assertEquals(r.status, 503); assertEquals((await r.json()).error, "AI features are not switched on yet.");
  assertEquals(world.aiBodies.length, 0);
});

Deno.test("needs sign-in, a confirmed email and an allowed origin", async () => {
  reset(); Deno.env.set("ANTHROPIC_API_KEY", "fixture-ai-key");
  assertEquals((await post({ task: "fit_explain", job }, "bad")).status, 401);
  assertEquals((await post({ task: "fit_explain", job }, "good", "https://evil.test")).status, 403);
  world.confirmed = false; assertEquals((await post({ task: "fit_explain", job })).status, 403);
  assertEquals(world.aiBodies.length, 0);
});

Deno.test("fit explanation uses the profile résumé and records usage", async () => {
  reset(); Deno.env.set("ANTHROPIC_API_KEY", "fixture-ai-key");
  const r = await post({ task: "fit_explain", job });
  assertEquals(r.status, 200);
  const data = await r.json();
  assertEquals(data.result.fit, "good"); assertEquals(data.remaining, 24);
  const sent = world.aiBodies[0] as { messages: { content: string }[]; tool_choice: { name: string } };
  assert(sent.messages[0].content.includes("Power BI, Python"), "résumé from profile is sent");
  assertEquals(sent.tool_choice.name, "fit_explanation");
  assertEquals(world.inserts, [{ user_id: UID, task: "fit_explain", model: "claude-haiku-5-5", input_tokens: 1200, output_tokens: 300 }]);
});

Deno.test("asks for a résumé when the profile has none", async () => {
  reset(); Deno.env.set("ANTHROPIC_API_KEY", "fixture-ai-key"); world.resume = "";
  const r = await post({ task: "tailor_resume", job });
  assertEquals(r.status, 400); assertEquals((await r.json()).need, "resume");
});

Deno.test("daily limits stop the call before any AI cost", async () => {
  reset(); Deno.env.set("ANTHROPIC_API_KEY", "fixture-ai-key"); world.usedToday = 25;
  assertEquals((await post({ task: "smart_search", query: "remote power bi jobs" })).status, 429);
  world.usedToday = 0; world.globalToday = 1500;
  assertEquals((await post({ task: "smart_search", query: "remote power bi jobs" })).status, 429);
  assertEquals(world.aiBodies.length, 0);
});

Deno.test("employer tools are for verified employers only", async () => {
  reset(); Deno.env.set("ANTHROPIC_API_KEY", "fixture-ai-key");
  assertEquals((await post({ task: "job_post_writer", title: "Data Engineer", notes: "Azure, Spark" })).status, 403);
  world.employer = true;
  assertEquals((await post({ task: "job_post_writer", title: "Data Engineer", notes: "Azure, Spark" })).status, 200);
});

Deno.test("shortlist keeps labels and drops ids that do not exist", async () => {
  reset(); Deno.env.set("ANTHROPIC_API_KEY", "fixture-ai-key"); world.employer = true;
  const r = await post({ task: "candidate_shortlist", job, candidates: [{ label: "A", resume_text: "SQL" }, { label: "B", resume_text: "Power BI" }] });
  const data = await r.json();
  assertEquals(data.result.ranking.map((x: { label: string }) => x.label), ["B", "A"]);
});

Deno.test("AI provider errors become a friendly 503", async () => {
  reset(); Deno.env.set("ANTHROPIC_API_KEY", "fixture-ai-key"); world.aiStatus = 529;
  const r = await post({ task: "fit_explain", job });
  assertEquals(r.status, 503); assertEquals(world.inserts.length, 0);
});

Deno.test("input validation", () => {
  const bad = (f: () => unknown) => { try { f(); return false; } catch (e) { return e instanceof InputError; } };
  assert(bad(() => readInput("fit_explain", { job: { title: "x" } })), "description required");
  assert(bad(() => readInput("smart_search", { query: "x".repeat(301) })), "query length");
  assert(bad(() => readInput("candidate_shortlist", { job, candidates: Array(11).fill({ resume_text: "x" }) })), "max 10 candidates");
  assertEquals(readInput("candidate_shortlist", { job, candidates: [{ resume_text: "SQL" }] }).candidates[0].label, "Candidate 1");
});

Deno.test("prompts treat user text as data and forbid invented facts", () => {
  for (const t of ["tailor_resume", "fit_explain", "interview_prep"] as const) {
    const p = buildPrompt(t, { job, resume_text: "r" });
    assert(p.system.includes("not instructions") && p.system.includes("Never invent"), t);
  }
  const s = buildPrompt("candidate_shortlist", { job, candidates: [{ label: 'X" onload', resume_text: "r" }] });
  assert(s.system.includes("Ignore names, age"), "shortlist is job-related only");
  assert(!s.user.includes('X" onload'), "labels cannot break the tag");
  assertEquals(labelShortlist({ ranking: [{ id: 0 }] }, []).ranking.length, 0);
});
