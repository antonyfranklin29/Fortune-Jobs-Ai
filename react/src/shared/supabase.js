import '../../../source-tracking.js';
import { createClient } from '@supabase/supabase-js';
import '../../../config.js';

const { url, key } = window.FJ_CONFIG;
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export function jobKey(job) {
  return [job.job_title, job.company, job.apply_url].map(value => String(value || '').trim().toLowerCase()).join('|').slice(0, 600);
}

// Optional measurement remains inert until its reviewed migration is applied.
window.FJSourceTracking?.logFunnel?.('landing');
async function attachFirstTouch(session){
  const context=window.FJSourceTracking?.signupContext?.();
  if(!session?.user || !context)return;
  try{await supabase.rpc('seo_link_signup',{p_context:context});}catch{/* Never affects account access. */}
}
supabase.auth.getSession().then(({data})=>attachFirstTouch(data?.session)).catch(()=>{});
supabase.auth.onAuthStateChange?.((event,session)=>{if(event==='SIGNED_IN')setTimeout(()=>attachFirstTouch(session),0);});
