// Self-service account deletion (supabase/functions/delete-account). Offline: Deno.serve,
// Auth, Storage and PostgREST are stubbed in memory, so no real account, file or row is
// touched. Proves the recent-login gate fails closed, storage is emptied through the
// Storage API (nested folders, >2000 objects, retries, concurrent uploads) before the
// identity is deleted, bystanders are never touched, and partial failures say so honestly.
//   deno test --allow-env --allow-read --import-map=tests/deno/import_map.json tests/delete-account.ts
import { assert, assertEquals } from "./deno/assert.ts";

const SB = "https://fake.supabase.test";
Deno.env.set("SUPABASE_URL", SB);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service");

type Handler = (req: Request) => Promise<Response>;
let handler: Handler | null = null;
(Deno as unknown as { serve: unknown }).serve = (h: Handler) => { handler = h; return {}; };
const mod = await import("../supabase/functions/delete-account/index.ts");
assert(handler, "delete-account registers its request handler");
const serve: Handler = handler;

const UID = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-111111111112";   // prefix-adjacent bystander
const EMAIL = "fixture@example.test";
const now = () => Math.floor(Date.now() / 1000);
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const token = (payload: Record<string, unknown>) => `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
const fresh = (method = "password") => token({ sub: UID, iat: now(), amr: [{ method, timestamp: now() - 60 }] });

// ── in-memory backend ────────────────────────────────────────────────────────
type World = {
  files: Record<string, Set<string>>;
  rows: Record<string, number>;
  authDeleted: number;
  deletedPaths: string[];
  listOverride?: (bucket: string, folder: string, offset: number) => Response | null;
  deleteFailures: number;
  reuploads: number;           // re-add one file after each delete, this many times
  authDeleteStatus: number;
};
let w: World;
function reset(seed: Record<string, string[]> = {}) {
  w = {
    files: { resumes: new Set(seed.resumes ?? []), avatars: new Set(seed.avatars ?? []) },
    rows: { saved_jobs: 2, search_history: 3, profiles: 1 },
    authDeleted: 0, deletedPaths: [], deleteFailures: 0, reuploads: 0, authDeleteStatus: 200,
  };
}

function listing(bucket: string, folder: string, offset: number, limit: number) {
  const entries = new Map<string, boolean>();   // name -> isFolder
  for (const p of w.files[bucket]) {
    if (!p.startsWith(folder + "/")) continue;
    const rest = p.slice(folder.length + 1);
    const seg = rest.split("/")[0];
    entries.set(seg, rest.includes("/") || entries.get(seg) === true);
  }
  return [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(offset, offset + limit)
    .map(([name, isFolder]) => isFolder ? { name, id: null, metadata: null } : { name, id: crypto.randomUUID(), metadata: {} });
}

(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assertEquals(url.origin, SB, `unexpected outbound request to ${url.origin}`);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (url.pathname === "/auth/v1/user") return Response.json({ id: UID, email: EMAIL });
  let m = url.pathname.match(/^\/storage\/v1\/object\/list\/(\w+)$/);
  if (m) {
    const folder = String(body.prefix).replace(/\/$/, "");
    const o = w.listOverride?.(m[1], folder, body.offset);
    if (o) return o;
    return Response.json(listing(m[1], folder, body.offset, body.limit));
  }
  m = url.pathname.match(/^\/storage\/v1\/object\/(\w+)$/);
  if (m && method === "DELETE") {
    if (w.deleteFailures > 0) { w.deleteFailures--; return new Response("busy", { status: 503 }); }
    assert(body.prefixes.length <= 100, "deletes are batched");
    for (const p of body.prefixes) {
      assert(String(p).startsWith(`${UID}/`), `only the caller's objects may be deleted, got ${p}`);
      w.files[m[1]].delete(p); w.deletedPaths.push(p);
    }
    if (w.reuploads > 0) { w.reuploads--; w.files[m[1]].add(`${UID}/late-upload-${w.reuploads}.pdf`); }
    return Response.json(body.prefixes.map((name: string) => ({ name })));
  }
  m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
  if (m) {
    if (m[1] === "live_search_admissions") return Response.json([]);
    const n = w.rows[m[1]] ?? 0; w.rows[m[1]] = 0;
    return Response.json(Array.from({ length: n }, () => ({})));
  }
  if (url.pathname === `/auth/v1/admin/users/${UID}` && method === "DELETE") {
    if (w.authDeleteStatus === 200) w.authDeleted++;
    return new Response("{}", { status: w.authDeleteStatus });
  }
  throw new Error(`unexpected request ${method} ${url.pathname}`);
}) as typeof fetch;

const call = (tok: string, payload: Record<string, unknown> = { confirm: "DELETE MY ACCOUNT", email: EMAIL }) =>
  serve(new Request("https://fake.fn.test/", {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", origin: "https://fortunejobsai.com" },
    body: JSON.stringify(payload),
  }));
const bystanders = () => [`${OTHER}/resume.pdf`, `${UID}x/resume.pdf`];

// ── recent-authentication gate ───────────────────────────────────────────────
Deno.test("recent login: email and Google sign-in within 15 minutes pass", () => {
  assertEquals(mod.secondsSinceAuth(fresh("password")), 60);
  assertEquals(mod.secondsSinceAuth(fresh("oauth")), 60);
});

Deno.test("recent login fails closed without reliable authentication evidence", () => {
  const t = now();
  // A refreshed token: issued just now, but the sign-in itself was an hour ago.
  assertEquals(mod.secondsSinceAuth(token({ iat: t, amr: [{ method: "password", timestamp: t - 3600 }] })), 3600);
  // No amr at all: a fresh iat is not evidence of a recent login.
  assertEquals(mod.secondsSinceAuth(token({ iat: t })), null);
  assertEquals(mod.secondsSinceAuth(token({ iat: t, amr: "password" })), null);
  assertEquals(mod.secondsSinceAuth(token({ iat: t, amr: [] })), null);
  // Non-interactive or unrecognised methods do not count.
  assertEquals(mod.secondsSinceAuth(token({ iat: t, amr: [{ method: "token_refresh", timestamp: t }] })), null);
  assertEquals(mod.secondsSinceAuth(token({ iat: t, amr: [{ method: "anonymous", timestamp: t }] })), null);
  // A future authentication event, or a non-numeric one, is rejected.
  assertEquals(mod.secondsSinceAuth(token({ iat: t, amr: [{ method: "password", timestamp: t + 3600 }] })), null);
  assertEquals(mod.secondsSinceAuth(token({ iat: t, amr: [{ method: "password", timestamp: String(t) }] })), null);
  assertEquals(mod.secondsSinceAuth("not-a-jwt"), null);
});

Deno.test("a stale or evidence-free token is refused before anything is deleted", async () => {
  reset({ resumes: [`${UID}/cv.pdf`] });
  for (const tok of [token({ iat: now() }), token({ iat: now(), amr: [{ method: "password", timestamp: now() - 16 * 60 }] })]) {
    const res = await call(tok);
    assertEquals(res.status, 401);
    assertEquals((await res.json()).reason, "reauth_required");
  }
  assertEquals(w.deletedPaths.length, 0);
  assertEquals(w.authDeleted, 0);
});

Deno.test("confirmation and email mismatches are distinct and delete nothing", async () => {
  reset({ resumes: [`${UID}/cv.pdf`] });
  let res = await call(fresh(), { confirm: "delete my account", email: EMAIL });
  assertEquals((await res.json()).reason, "confirmation_required");
  res = await call(fresh(), { confirm: "DELETE MY ACCOUNT", email: "someone@else.test" });
  assertEquals((await res.json()).reason, "email_mismatch");
  assertEquals(w.deletedPaths.length, 0);
  assertEquals(w.authDeleted, 0);
});

// ── storage ──────────────────────────────────────────────────────────────────
Deno.test("more than 2000 objects and nested folders are all removed before the identity", async () => {
  const many = Array.from({ length: 2150 }, (_, i) => `${UID}/bulk/${String(i).padStart(5, "0")}.pdf`);
  reset({ resumes: [...many, `${UID}/cv.pdf`, `${UID}/a/b/c/deep.pdf`, ...bystanders()], avatars: [`${UID}/me.png`, `${OTHER}/me.png`] });
  const res = await call(fresh("oauth"));
  const body = await res.json();
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals(body.status, "deleted");
  assertEquals([...w.files.resumes].sort(), bystanders().sort(), "bystander and prefix-adjacent files survive");
  assertEquals([...w.files.avatars], [`${OTHER}/me.png`]);
  assertEquals(w.authDeleted, 1);
  assertEquals(body.steps.find((s: { step: string }) => s.step === "storage:resumes").removed, 2152);
});

Deno.test("a malformed listing fails closed and keeps the identity", async () => {
  for (const bad of [new Response("<html>", { status: 200 }), Response.json({ items: [] }), Response.json([{ name: "../escape", id: "x" }]), Response.json([{ id: "x" }])]) {
    reset({ resumes: [`${UID}/cv.pdf`] });
    w.listOverride = () => bad.clone();
    const res = await call(fresh());
    const body = await res.json();
    assertEquals(res.status, 409);
    assertEquals(body.reason, "partial_cleanup");
    assertEquals(body.steps.find((s: { step: string }) => s.step === "storage:resumes").error, "list_malformed");
    assertEquals(w.authDeleted, 0, "identity must not be deleted while storage state is unknown");
  }
});

Deno.test("a transient storage failure stops before the identity; a retry resumes and finishes", async () => {
  reset({ resumes: Array.from({ length: 250 }, (_, i) => `${UID}/f${i}.pdf`) });
  w.deleteFailures = 1;
  let res = await call(fresh());
  let body = await res.json();
  assertEquals(res.status, 409);
  assertEquals(w.authDeleted, 0);
  assert(/permanently deleted and cannot be restored/.test(body.message), "the message never implies a restore");
  assert(!/restored\./.test(body.message.replace("cannot be restored", "")), "no claim that data was put back");
  // Fail after partial progress, then retry.
  reset({ resumes: Array.from({ length: 250 }, (_, i) => `${UID}/f${i}.pdf`) });
  let deletes = 0;
  const realFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (u.pathname === "/storage/v1/object/resumes" && init?.method === "DELETE" && ++deletes === 2) return new Response("busy", { status: 503 });
    return realFetch(input, init);
  }) as typeof fetch;
  res = await call(fresh());
  assertEquals(res.status, 409);
  assertEquals(w.files.resumes.size, 150, "the first batch stayed deleted");
  (globalThis as unknown as { fetch: typeof fetch }).fetch = realFetch;
  res = await call(fresh());
  body = await res.json();
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals(w.files.resumes.size, 0);
  assertEquals(w.authDeleted, 1);
});

Deno.test("uploads during deletion are caught; persistent uploads keep the identity", async () => {
  reset({ resumes: [`${UID}/cv.pdf`] });
  w.reuploads = 1;                          // one late upload: caught by the re-list
  let res = await call(fresh());
  assertEquals(res.status, 200);
  assertEquals(w.files.resumes.size, 0);
  reset({ resumes: [`${UID}/cv.pdf`] });
  w.reuploads = 10;                         // keeps uploading: refuse to close the account
  res = await call(fresh());
  const body = await res.json();
  assertEquals(res.status, 409);
  assertEquals(body.steps.find((s: { step: string }) => s.step === "storage:resumes").error, "storage_not_empty");
  assertEquals(w.authDeleted, 0);
});

Deno.test("a failed identity deletion reports that the data is already gone", async () => {
  reset({ resumes: [`${UID}/cv.pdf`] });
  w.authDeleteStatus = 500;
  const res = await call(fresh());
  const body = await res.json();
  assertEquals(res.status, 409);
  assertEquals(body.reason, "identity_not_closed");
  assert(/permanently deleted/.test(body.message));
  // Retrying is idempotent: storage and rows are already empty, the identity closes.
  w.authDeleteStatus = 200;
  const again = await call(fresh());
  assertEquals(again.status, 200);
  assertEquals(w.authDeleted, 1);
});
