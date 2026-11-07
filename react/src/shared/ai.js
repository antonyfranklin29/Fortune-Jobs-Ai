// Calls the ai-assist Edge Function with the signed-in person's session.
// The Supabase client is loaded lazily so pages and tests that never use AI don't load it.

export async function aiSession() {
  const { supabase } = await import('./supabase.js');
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

/**
 * @returns {Promise<{ ok: true, result: any, remaining: number } | { ok: false, status: number, error: string, need?: string }>}
 */
export async function callAi(task, payload, { fetchImpl = (...a) => window.fetch(...a), session } = {}) {
  const s = session === undefined ? await aiSession() : session;
  if (!s) return { ok: false, status: 401, error: 'Sign in to use AI features.' };
  const { url, key } = window.FJ_CONFIG || {};
  let response;
  try {
    response = await fetchImpl(`${url}/functions/v1/ai-assist`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, ...payload }),
      signal: AbortSignal.timeout(70000),
    });
  } catch {
    return { ok: false, status: 0, error: 'Could not reach Fortune AI Coach. Check your connection and try again.' };
  }
  let data = {};
  try { data = await response.json(); } catch { /* keep the generic message */ }
  if (!response.ok) return { ok: false, status: response.status, error: data.error || 'Fortune AI Coach is unavailable right now.', need: data.need };
  return { ok: true, result: data.result, remaining: data.remaining };
}

/** The job fields the AI needs, trimmed to the server's limits. */
export const jobForAi = (job, describe = (t) => t) => ({
  title: String(job.job_title || '').slice(0, 160),
  company: String(job.company || '').slice(0, 200),
  location: String(job.location || '').slice(0, 200),
  description: describe(String(job.job_description || '')).slice(0, 12000),
});
