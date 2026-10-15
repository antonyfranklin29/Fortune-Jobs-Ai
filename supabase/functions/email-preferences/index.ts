// Deploy with --no-verify-jwt: bearer authentication is verified explicitly below.
// Public unsubscribe is a narrow, signed capability; no GET changes state.
const BASE='https://hqgakkcxcyspqhnlnscv.supabase.co';
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const SECRET=Deno.env.get('NEWSLETTER_UNSUBSCRIBE_SECRET')||'';
const ORIGINS=['https://fortunejobsai.com','https://www.fortunejobsai.com'];
const html=(body:string,status=200)=>new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fortune Jobs AI email preferences</title><body style="font:18px/1.6 Arial;max-width:600px;margin:70px auto;padding:24px;color:#10243B">'+body+'</body></html>',{status,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
async function tokenUser(token:string){
 if(SECRET.length<32||token.length>256)return null;
 const [payload,sig,...rest]=token.split('.');if(rest.length||!payload||!sig||!/^[A-Za-z0-9_-]+$/.test(payload+sig))return null;
 try{
  const id=atob(payload.replace(/-/g,'+').replace(/_/g,'/'));
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return null;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(atob(sig.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-sig.length%4)%4)),c=>c.charCodeAt(0));
  return await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(payload))?id:null;
 }catch{return null;}
}
async function db(path:string,method='GET',body?:unknown){const r=await fetch(BASE+'/rest/v1/'+path,{method,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',Prefer:'return=representation,resolution=merge-duplicates'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Database unavailable');return r.status===204?null:r.json();}
Deno.serve(async(req:Request)=>{
 const url=new URL(req.url),origin=req.headers.get('Origin');
 const cors={'Access-Control-Allow-Origin':origin&&ORIGINS.includes(origin)?origin:ORIGINS[0],'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS',Vary:'Origin','Cache-Control':'no-store'};
 const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed'},405);
 if(Number(req.headers.get('Content-Length')||0)>2000)return json({error:'Request too large'},413);
 try{
  const token=url.searchParams.get('token');
  if(token){
   const id=await tokenUser(token);if(!id)return html('<h1>Link unavailable</h1><p>Use email preferences in your profile, or contact info@fortunejobsai.com.</p>',400);
   if(req.method==='GET')return html('<h1>Stop weekly emails?</h1><p>No sign-in required. This does not delete your account.</p><form method="post"><button style="background:#D4A843;color:#10243B;padding:14px;border:0;border-radius:6px;font-size:16px">Unsubscribe</button></form>');
   await db('newsletter_preferences?user_id=eq.'+id,'PATCH',{subscribed:false,unsubscribed_at:new Date().toISOString(),updated_at:new Date().toISOString()});
   return html('<h1>You’re unsubscribed.</h1><p>Weekly newsletters are now off. You can still use Fortune Jobs AI.</p>');
  }
  if(origin&&!ORIGINS.includes(origin))return json({error:'Origin not allowed'},403);
  const bearer=req.headers.get('Authorization');if(!bearer?.startsWith('Bearer '))return json({error:'Sign in required'},401);
  const check=await fetch(BASE+'/auth/v1/user',{headers:{apikey:KEY,Authorization:bearer},signal:AbortSignal.timeout(8000)});
  if(!check.ok)return json({error:'Sign in required'},401);const user=await check.json();
  if(!user.id||!user.email_confirmed_at)return json({error:'Confirm your email first'},403);
  if(req.method==='GET'){
   const rows=await db('newsletter_preferences?user_id=eq.'+user.id+'&select=subscribed,consent_at');
   return json({subscribed:rows[0]?.subscribed||false,delivery_active:Deno.env.get('NEWSLETTER_ENABLED')==='true'});
  }
  const raw=await req.text();if(raw.length>2000)return json({error:'Request too large'},413);
  let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid request'},400);}
  if(typeof body.subscribed!=='boolean'||body.consent_version!=='weekly-v1')return json({error:'Invalid preference'},400);
  const now=new Date().toISOString();
  // Keep repeated opt-in saves from resetting the weekly schedule.
  const existing=(await db('newsletter_preferences?user_id=eq.'+user.id+'&select=subscribed'))[0];
  if(!existing||existing.subscribed!==body.subscribed){
   await db('newsletter_preferences?on_conflict=user_id','POST',{user_id:user.id,subscribed:body.subscribed,consent_version:'weekly-v1',consent_at:body.subscribed?now:null,unsubscribed_at:body.subscribed?null:now,updated_at:now,next_send_at:new Date(Date.now()+7*86400000).toISOString()});
  }
  return json({subscribed:body.subscribed,delivery_active:Deno.env.get('NEWSLETTER_ENABLED')==='true'});
 }catch{return json({error:'Email preferences are temporarily unavailable'},503);}
});
