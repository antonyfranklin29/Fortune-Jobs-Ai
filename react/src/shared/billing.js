// Fortune Jobs AI Pro: reads the person's subscription and opens Stripe Checkout or the Stripe portal.
import { aiSession } from './ai.js';

// Pro is open to everyone only once real payments are switched on. Until then the Subscribe button
// shows for testers who open any results page with ?pro_test=1 (remembered for the tab).
export const PRO_OPEN = false;
export function proVisible(search = typeof window !== 'undefined' ? window.location.search : '') {
  if (PRO_OPEN) return true;
  try {
    if (new URLSearchParams(search).get('pro_test') === '1') sessionStorage.setItem('fj_pro_test', '1');
    return sessionStorage.getItem('fj_pro_test') === '1';
  } catch { return false; }
}

export const PRO = { price: '$9.99', results: 50, aiPerDay: 50, freeResults: 10, freeAiPerDay: 25 };

/** True while Stripe says the subscription is active (or trialing) and the paid period hasn't ended. */
export function isActive(row, now = Date.now()) {
  return !!row && ['active', 'trialing'].includes(row.status) && (!row.current_period_end || Date.parse(row.current_period_end) > now);
}

/** The signed-in person's subscription row, or null (signed out, never subscribed, or unavailable). */
export async function mySubscription() {
  try {
    const { supabase } = await import('./supabase.js');
    const { data } = await supabase.auth.getUser();
    if (!data?.user) return null;
    const res = await supabase.from('subscriptions').select('status,current_period_end,cancel_at_period_end').eq('user_id', data.user.id).maybeSingle();
    return res.error ? null : res.data;
  } catch { return null; }
}

/** Sends the person to Stripe. Resolves to an error message when that isn't possible. */
export async function goToBilling(action, { fetchImpl = (...a) => window.fetch(...a), go = (u) => { window.location.href = u; } } = {}) {
  const s = await aiSession();
  if (!s) { go(`./login.html?next=${encodeURIComponent(window.location.pathname.replace(/^\//, '') + window.location.search)}`); return null; }
  const { url, key } = window.FJ_CONFIG || {};
  try {
    const r = await fetchImpl(`${url}/functions/v1/billing`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }), signal: AbortSignal.timeout(20000) });
    const data = await r.json().catch(() => ({}));
    if (r.ok && /^https:\/\/(checkout|billing)\.stripe\.com\//.test(data.url || '')) { go(data.url); return null; }
    return data.error || 'Payments are unavailable right now. Please try again in a minute.';
  } catch { return 'Could not reach payments. Check your connection and try again.'; }
}
