// ai-assist: the website's AI features, answered by Claude through the Anthropic API.
// Deploy with --no-verify-jwt: the bearer token is checked explicitly below.
// Needs the ANTHROPIC_API_KEY secret; without it every request gets 503 "not switched on yet".
// The key never leaves this function. Résumé text is read from the person's own profile.
import { EMPLOYER_TASKS, InputError, LIMITS, RESUME_TASKS, buildPrompt, isTask, labelShortlist, readInput, type TaskName } from "./tasks.ts";

const BASE = Deno.env.get("SUPABASE_URL") || "https://hqgakkcxcyspqhnlnscv.supabase.co";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ORIGINS = ["https://fortunejobsai.com", "https://www.fortunejobsai.com"];
const MODEL = Deno.env.get("AI_MODEL") || "claude-haiku-5-5";
const MAX_BODY = 200_000;

async function db(path: string, init: RequestInit = {}, headers: Record<string, string> = {}) {
  const r = await fetch(BASE + "/rest/v1/" + path, { ...init, headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", ...headers }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("db " + r.status);
  return r;
}
async function count(path: string) {
  const r = await db(path + "&select=id", { method: "HEAD" }, { Prefer: "count=exact", Range: "0-0" });
  return Number(r.headers.get("content-range")?.split("/")[1] || 0);
}

async function callClaude(spec: ReturnType<typeof buildPrompt>, apiKey: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: spec.max_tokens, system: spec.system, messages: [{ role: "user", content: spec.user }], tools: [spec.tool], tool_choice: { type: "tool", name: spec.tool.name } }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error("ai " + r.status);
  const data = await r.json();
  const block = (data.content || []).find((b: { type: string; name?: string }) => b.type === "tool_use" && b.name === spec.tool.name);
  if (!block?.input) throw new Error("ai empty");
  return { result: block.input, usage: data.usage || {} };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = { "Access-Control-Allow-Origin": origin && ORIGINS.includes(origin) ? origin : ORIGINS[0], "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "POST,OPTIONS", Vary: "Origin", "Cache-Control": "no-store" };
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (origin && !ORIGINS.includes(origin)) return json({ error: "Origin not allowed" }, 403);
  if (Number(req.headers.get("Content-Length") || 0) > MAX_BODY) return json({ error: "Request too large" }, 413);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!apiKey) return json({ error: "AI features are not switched on yet." }, 503);

  try {
    const bearer = req.headers.get("Authorization");
    if (!bearer?.startsWith("Bearer ")) return json({ error: "Sign in to use AI features." }, 401);
    const check = await fetch(BASE + "/auth/v1/user", { headers: { apikey: KEY, Authorization: bearer }, signal: AbortSignal.timeout(8000) });
    if (!check.ok) return json({ error: "Your session has expired. Sign in again." }, 401);
    const user = await check.json();
    if (!user?.id) return json({ error: "Sign in to use AI features." }, 401);
    if (!user.email_confirmed_at) return json({ error: "Confirm your email address first." }, 403);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "Request too large" }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return json({ error: "Invalid request" }, 400); }
    if (!body || typeof body !== "object" || !isTask(body.task)) return json({ error: "Unknown AI task" }, 400);
    const task: TaskName = body.task;
    // deno-lint-ignore no-explicit-any
    let input: any;
    try { input = readInput(task, body); } catch (e) { if (e instanceof InputError) return json({ error: e.message }, 400); throw e; }

    if (EMPLOYER_TASKS.includes(task)) {
      const rows = await (await db(`employer_org_members?user_id=eq.${user.id}&status=eq.active&select=org_id,employer_orgs!inner(status)&employer_orgs.status=eq.verified&limit=1`)).json();
      if (!rows.length) return json({ error: "Employer AI tools are for verified employer accounts." }, 403);
    }
    if (RESUME_TASKS.includes(task) && !input.resume_text) {
      const rows = await (await db(`profiles?id=eq.${user.id}&select=resume_text`)).json();
      input.resume_text = String(rows[0]?.resume_text || "").slice(0, 15000).trim();
      if (!input.resume_text) return json({ error: "Add your résumé to your profile first.", need: "resume" }, 400);
    }

    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const day = encodeURIComponent(since.toISOString());
    const used = await count(`ai_usage?user_id=eq.${user.id}&created_at=gte.${day}`);
    if (used >= LIMITS.perUserPerDay) return json({ error: `You've used today's ${LIMITS.perUserPerDay} AI actions. They reset at midnight UTC.`, remaining: 0 }, 429);
    if (await count(`ai_usage?created_at=gte.${day}`) >= LIMITS.globalPerDay) return json({ error: "AI features are busy today. Please try again tomorrow." }, 429);

    const { result, usage } = await callClaude(buildPrompt(task, input), apiKey);
    await db("ai_usage", { method: "POST", body: JSON.stringify({ user_id: user.id, task, model: MODEL, input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 }) }, { Prefer: "return=minimal" });
    const answer = task === "candidate_shortlist" ? labelShortlist(result, input.candidates) : result;
    return json({ task, result: answer, remaining: Math.max(0, LIMITS.perUserPerDay - used - 1) });
  } catch {
    return json({ error: "The AI assistant is unavailable right now. Please try again in a minute." }, 503);
  }
});
