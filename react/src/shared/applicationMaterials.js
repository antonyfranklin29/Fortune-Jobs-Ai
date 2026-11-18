import { documentIdentity } from './applicationDocuments.js';

// Unsaved drafts stay in memory only, scoped to the signed-in account and job.
const pending = new Map();
export const materialJobKey = job => [job.job_title, job.company, job.apply_url]
  .map(value => String(value || '').trim().toLowerCase()).join('|').slice(0, 600);
const client = async () => (await import('./supabase.js')).supabase;
const cacheKey = (userId, job) => userId + ':' + materialJobKey(job);

export async function loadMaterialContext(job, sb) {
  sb ||= await client();
  const { data: auth } = await sb.auth.getSession();
  const user = auth?.session?.user;
  if (!user) return { userId: null, session: null, identity: documentIdentity(), materials: {} };
  const [profile, saved] = await Promise.all([
    sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    sb.from('saved_jobs').select('materials').eq('user_id', user.id).eq('job_key', materialJobKey(job)).maybeSingle(),
  ]);
  if (profile.error) throw new Error('Could not read your profile. Try again before generating a document.');
  // A pending migration must not make the AI tool itself unusable. Saves report errors below.
  const materials = { ...(saved.data?.materials || {}) };
  for (const [kind, draft] of Object.entries(pending.get(cacheKey(user.id, job)) || {})) {
    if (!materials[kind] || Date.parse(draft.generated_at) >= Date.parse(materials[kind].generated_at)) materials[kind] = draft;
  }
  return { userId: user.id, session: auth.session, identity: documentIdentity(profile.data || {}, user), materials };
}

export async function keepMaterial(job, kind, material, userId, sb) {
  sb ||= await client();
  const { data } = await sb.auth.getSession();
  if (!userId || data?.session?.user?.id !== userId) throw new Error('Your account changed. Sign in again to save this draft.');
  const key = cacheKey(userId, job);
  pending.set(key, { ...pending.get(key), [kind]: material });
  const { data: saved, error } = await sb.rpc('save_job_material', {
    p_job_key: materialJobKey(job), p_kind: kind, p_material: material,
  });
  if (error) throw new Error('Draft available here. Could not keep it with the saved job. Try saving again.');
  return saved ? 'Saved with this job.' : 'Save this job to keep your draft in the tracker.';
}

export async function persistPendingMaterials(job, sb) {
  sb ||= await client();
  const { data } = await sb.auth.getSession();
  const userId = data?.session?.user?.id;
  if (!userId) return;
  for (const [kind, material] of Object.entries(pending.get(cacheKey(userId, job)) || {})) {
    await keepMaterial(job, kind, material, userId, sb);
  }
}

export async function watchMaterialAccount(onChange, sb) {
  sb ||= await client();
  let last;
  const { data } = sb.auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.id || null;
    if (last !== undefined && last !== next) { pending.clear(); onChange(); }
    last = next;
  });
  return () => data.subscription.unsubscribe();
}
