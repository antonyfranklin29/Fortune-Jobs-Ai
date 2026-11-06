// job-alerts: emails opted-in people new jobs matching their role and area, daily or weekly
// (their choice on email-preferences.html). Called once a day by the database scheduler.
// Deploy with --no-verify-jwt; callable only with the INGEST_SECRET header, never by a browser.
// Safe by default: without {"send":true}, NEWSLETTER_ENABLED=true and every Resend setting it
// only counts who would get an email (a dry run) and sends nothing.
// Secrets: INGEST_SECRET, RESEND_API_KEY, NEWSLETTER_ENABLED, NEWSLETTER_POSTAL_ADDRESS,
//          NEWSLETTER_UNSUBSCRIBE_SECRET (shared with email-preferences), optional NEWSLETTER_FROM.
// Sends from fortunejobsai.com, the domain verified in Resend; replies go to info@.
import { renderDigest } from "../_shared/digest.mjs";
import { alertQuery, campaignFor, pickJobs, unsubscribeToken, type Job, type Profile } from "./select.ts";

const BASE = Deno.env.get("SUPABASE_URL") || "https://hqgakkcxcyspqhnlnscv.supabase.co";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Unsubscribe links always point at the real project (the email template insists on it).
const PUBLIC_BASE = "https://hqgakkcxcyspqhnlnscv.supabase.co";
const BATCH = 40; // people per run; the claim function also caps sends at 95 a day

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function db(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`${BASE}/rest/v1/${path}`, { method, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`db ${r.status}`);
  return r.status === 204 ? null : r.json();
}

Deno.serve(async (req: Request) => {
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "Content-Type": "application/json" } });
  const secret = Deno.env.get("INGEST_SECRET") || "";
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!KEY || !safeEqual(req.headers.get("x-ingest-secret") || "", secret)) return json({ error: "unauthorised" }, 401);
  let body: { send?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body = dry run */ }

  const env = (k: string) => Deno.env.get(k) || "";
  const address = env("NEWSLETTER_POSTAL_ADDRESS"), unsubSecret = env("NEWSLETTER_UNSUBSCRIBE_SECRET"), resend = env("RESEND_API_KEY");
  const live = body.send === true && env("NEWSLETTER_ENABLED") === "true" && !!resend && !!address && unsubSecret.length >= 32;

  const now = Date.now();
  const due = await db(`newsletter_preferences?subscribed=eq.true&next_send_at=lte.${encodeURIComponent(new Date(now).toISOString())}&select=user_id,frequency&order=next_send_at.asc&limit=${BATCH}`) as { user_id: string; frequency: "daily" | "weekly" }[];
  const report = { dryRun: !live, due: due.length, withJobs: 0, sent: 0, skipped: 0, failed: 0 };

  for (const pref of due) {
    const profile = (await db(`profiles?id=eq.${pref.user_id}&select=full_name,current_title,preferred_locations,saved_filters`))[0] as Profile | undefined;
    const query = profile && alertQuery(profile, pref.frequency, now);
    if (!query) { report.skipped++; continue; } // no role or area on the profile: never mail random jobs
    const rows = await db(query.path) as Job[];
    const jobs = pickJobs(rows, query, now);
    if (!jobs.length) { report.skipped++; continue; } // nothing new: skip this email
    report.withJobs++;
    if (!live) continue;

    const auth = await fetch(`${BASE}/auth/v1/admin/users/${pref.user_id}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(10000) });
    if (!auth.ok) { report.failed++; continue; }
    const user = await auth.json();
    if (!user.email || !user.email_confirmed_at) { report.skipped++; continue; }

    const unsub = `${PUBLIC_BASE}/functions/v1/email-preferences?token=${await unsubscribeToken(pref.user_id, unsubSecret)}`;
    let content;
    try { content = renderDigest({ name: profile!.full_name, jobs, address, unsubscribeUrl: unsub, frequency: pref.frequency }); }
    catch { report.failed++; continue; } // e.g. a malformed postal address: never send a non-compliant email
    const claim = await db("rpc/newsletter_claim", "POST", { p_user: pref.user_id, p_campaign: campaignFor(pref.frequency, now) });
    if (!claim) { report.skipped++; continue; }
    const fresh = (await db(`newsletter_preferences?user_id=eq.${pref.user_id}&select=subscribed`))[0];
    if (!fresh?.subscribed) { await db(`newsletter_deliveries?id=eq.${claim}`, "PATCH", { state: "suppressed" }); report.skipped++; continue; }
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json", "Idempotency-Key": String(claim) },
        body: JSON.stringify({ from: env("NEWSLETTER_FROM") || "Fortune Jobs AI <jobs@fortunejobsai.com>", reply_to: "info@fortunejobsai.com", to: [user.email], ...content, headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
        signal: AbortSignal.timeout(15000),
      });
      const sent = r.ok ? await r.json() : null;
      if (!sent?.id) throw new Error("no receipt");
      await db(`newsletter_deliveries?id=eq.${claim}`, "PATCH", { state: "accepted", provider_id: sent.id });
      report.sent++;
    } catch {
      // The email may or may not have gone out: never retry automatically (the claim blocks it).
      await db(`newsletter_deliveries?id=eq.${claim}`, "PATCH", { state: "unknown" }).catch(() => {});
      report.failed++;
    }
  }
  return json(report);
});

