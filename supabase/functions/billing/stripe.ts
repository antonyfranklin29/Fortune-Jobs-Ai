// Small Stripe helpers shared by billing and billing-webhook. No SDK: form-encoded REST calls.
export const PRO = { lookupKey: "fortune_pro_monthly", name: "Fortune Jobs AI Pro", amount: 999, currency: "usd", interval: "month" };

/** Stripe's form encoding: nested objects become a[b][c]=v. */
export function form(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) form(v as Record<string, unknown>, key, out);
    else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? form(x as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(secret: string, method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
  const url = `https://api.stripe.com/v1/${path}`;
  const r = await fetch(method === "GET" && body ? `${url}?${form(body)}` : url, {
    method,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "POST" && body ? form(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`stripe ${r.status}: ${data?.error?.message || "error"}`);
  return data;
}

/** The subscription's paid-through time; newer Stripe API versions keep it on the item. */
export function periodEnd(sub: Record<string, any>): string | null {
  const t = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end;
  return Number.isFinite(t) ? new Date(t * 1000).toISOString() : null;
}

/** Verifies a Stripe-Signature header (v1 = HMAC-SHA256 of "t.payload"), within 5 minutes. */
export async function verifySignature(payload: string, header: string, secret: string, now = Date.now()) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=").map((x) => x.trim())).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = header.split(",").map((p) => p.trim()).filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!secret || !Number.isFinite(t) || !sigs.length || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}
