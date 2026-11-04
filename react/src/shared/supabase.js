import { createClient } from '@supabase/supabase-js';
import '../../../config.js';

const { url, key } = window.FJ_CONFIG;
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export function jobKey(job) {
  return [job.job_title, job.company, job.apply_url].map(value => String(value || '').trim().toLowerCase()).join('|').slice(0, 600);
}
