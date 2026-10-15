// Manual, dry-run by default. No scheduler or live sending is activated by this file.
import {createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {renderDigest,safeUrl} from '../newsletter/email.mjs';
const require=createRequire(import.meta.url), accuracy=require('../search-accuracy.js');
export function selectJobs(rows,profile,now=Date.now()){
 const f=profile.saved_filters || {}, title=String(profile.current_title || f.text || '').trim();
 // Require a role and geographic preference; never mail arbitrary fallback jobs.
 if(!title || !f.country || !(f.location || f.city || f.region))return [];
 const seen=new Set();
 return rows.filter(j=>{
  const posted=Date.parse(j.posted_at),url=safeUrl(j.apply_url);
  if(!url || !Number.isFinite(posted) || posted>now || posted<now-7*86400000)return false;
  if(!accuracy.matches(j,title,f,now))return false;
  const key=accuracy.canonicalUrl(url);if(seen.has(key))return false;seen.add(key);return true;
 }).sort((a,b)=>Date.parse(b.posted_at)-Date.parse(a.posted_at)).slice(0,5);
}
export function unsubscribeToken(id,secret){const payload=Buffer.from(id).toString('base64url');return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');}
export async function run(env=process.env,fetcher=fetch){
 const live=process.argv.includes('--send');
 const url=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url || !key)throw Error('Missing server database credentials');
 if(url!=='https://hqgakkcxcyspqhnlnscv.supabase.co')throw Error('Unexpected project URL');
 if(live && (env.NEWSLETTER_ENABLED!=='true'||!env.RESEND_API_KEY||!env.NEWSLETTER_POSTAL_ADDRESS||!env.NEWSLETTER_UNSUBSCRIBE_SECRET||env.NEWSLETTER_UNSUBSCRIBE_SECRET.length<32))throw Error('Delivery disabled or configuration incomplete');
 async function db(path,method='GET',body){const r=await fetcher(url+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Database request failed: '+r.status);return r.status===204?null:r.json();}
 const due=await db('newsletter_preferences?subscribed=eq.true&next_send_at=lte.'+encodeURIComponent(new Date().toISOString())+'&order=next_send_at.asc&limit=20');
 const now=Date.now(), campaign='weekly-'+new Date(now).toISOString().slice(0,10);
 let eligible=0,accepted=0;
 for(const pref of due){
  const profile=(await db('profiles?id=eq.'+pref.user_id+'&select=full_name,current_title,saved_filters'))[0];
  if(!profile)continue;
  // Bounded fresh corpus only. A sparse or stale corpus causes a skipped email.
  const rows=await db('pre_scraped_jobs?posted_at=gte.'+encodeURIComponent(new Date(now-7*86400000).toISOString())+'&order=posted_at.desc&limit=1000');
  const jobs=selectJobs(rows,profile,now);if(!jobs.length)continue;eligible++;
  if(!live)continue;
  const auth=await fetcher(url+'/auth/v1/admin/users/'+pref.user_id,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});
  if(!auth.ok)throw Error('Recipient verification failed');const user=await auth.json();
  if(!user.email_confirmed_at||!user.email)continue;
  const unsub=url+'/functions/v1/email-preferences?token='+unsubscribeToken(pref.user_id,env.NEWSLETTER_UNSUBSCRIBE_SECRET);
  const content=renderDigest({name:profile.full_name,jobs,address:env.NEWSLETTER_POSTAL_ADDRESS,unsubscribeUrl:unsub});
  const claim=await db('rpc/newsletter_claim','POST',{p_user:pref.user_id,p_campaign:campaign});if(!claim)continue;
  const fresh=(await db('newsletter_preferences?user_id=eq.'+pref.user_id+'&select=subscribed'))[0];
  if(!fresh?.subscribed){await db('newsletter_deliveries?id=eq.'+claim,'PATCH',{state:'suppressed'});continue;}
  // Unknown outcomes remain reserved/unknown and block automatic retries across days.
  try{
   const r=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':claim},body:JSON.stringify({from:'Fortune Jobs AI <info@fortunejobsai.com>',reply_to:'info@fortunejobsai.com',to:[user.email],...content,headers:{'List-Unsubscribe':'<'+unsub+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}),signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error('Provider rejected request');const sent=await r.json();if(!sent.id)throw Error('Provider missing receipt');
   await db('newsletter_deliveries?id=eq.'+claim,'PATCH',{state:'accepted',provider_id:sent.id});accepted++;
  }catch{await db('newsletter_deliveries?id=eq.'+claim,'PATCH',{state:'unknown'});throw Error('Delivery outcome needs operator review; no automatic retry');}
 }
 return {dryRun:!live,checked:due.length,eligible,accepted};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)run().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1;});
