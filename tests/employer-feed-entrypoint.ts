// Cold-start/HTTP-to-RPC wiring tests. No network, credentials or production DB.
import { assert, assertEquals } from './deno/assert.ts';

const DB='https://fixture.supabase.test';
const SECRET='fixture-ingest-secret';
const SERVICE='fixture-service-key';
type Handler=(req:Request)=>Response|Promise<Response>;
let coldStart=0;
async function loadWorker(enabled:boolean){
  Deno.env.set('SUPABASE_URL',DB); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY',SERVICE);
  Deno.env.set('INGEST_SECRET',SECRET);Deno.env.set('EMPLOYER_FEED_ENABLED',String(enabled));
  const original=Deno.serve;let captured:Handler|undefined;
  // Replace the listener only while importing; no socket is created.
  Deno.serve=((fn:Handler)=>{captured=fn;return{};}) as typeof Deno.serve;
  try{await import(`../supabase/functions/employer-feed/index.ts?fixture=${++coldStart}`);}
  finally{Deno.serve=original;}
  assert(captured);return captured as Handler;
}
const source={id:'fixture-source',adapter:'lever',api_region:'global',board_token:'synthetic',
  employer_name:'Synthetic Employer',status:'approved',enabled:true,rights_basis:'employer_written_permission',
  permission_ref:'fixture-private-permission',approved_by:'fixture-reviewer',
  approved_at:new Date(Date.now()-3600000).toISOString(),domain_verified_at:new Date(Date.now()-3600000).toISOString(),
  authorization_expires_at:new Date(Date.now()+86400000).toISOString(),allow_display:true,allow_refresh:true,
  allow_description:false,allowed_apply_hosts:['jobs.lever.co'],attribution_text:''};
const req=(dry_run=true)=>new Request('https://worker.example',{method:'POST',
  headers:{'x-ingest-secret':SECRET},body:JSON.stringify({source_id:source.id,dry_run})});

Deno.test('entrypoint requires explicit enablement and its own secret before any RPC',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=(()=>{calls++;throw Error('unexpected network');}) as typeof fetch;
  try{
    const disabled=await loadWorker(false);
    assertEquals((await disabled(req())).status,503);
    const enabled=await loadWorker(true);
    const anon=new Request('https://worker.example',{method:'POST',headers:{authorization:'Bearer fixture-anon-jwt'},body:'{}'});
    assertEquals((await enabled(anon)).status,401);assertEquals(calls,0);
  }finally{globalThis.fetch=original;}
});

Deno.test('entrypoint stages through exact private RPCs and never sends credentials to an employer API',async()=>{
  const fn=await loadWorker(true);const original=globalThis.fetch;
  const calls:Array<{url:string,body:any}>=[];
  globalThis.fetch=(async(input:any,init?:RequestInit)=>{
    const url=String(input);const headers=new Headers(init?.headers);
    if(url.startsWith(DB+'/rest/v1/rpc/')){
      assertEquals(headers.get('apikey'),SERVICE);assertEquals(headers.get('authorization'),'Bearer '+SERVICE);
      const body=JSON.parse(String(init?.body));calls.push({url,body});
      if(url.endsWith('/employer_source_for_worker')){assertEquals(body.p_source,source.id);return Response.json({source,revision:1});}
      if(url.endsWith('/employer_feed_run_begin'))return Response.json({status:'claimed',run_id:'fixture-run',lease_token:'fixture-lease'});
      if(url.endsWith('/employer_feed_stage_registered_run'))return Response.json({status:'staged',accepted:1,candidates_promoted:1});
      throw Error('unexpected RPC');
    }
    assertEquals(url,'https://api.lever.co/v0/postings/synthetic?mode=json&skip=0&limit=100');
    assertEquals(headers.get('authorization'),null);assertEquals(headers.get('apikey'),null);
    assertEquals(init?.redirect,'error');calls.push({url,body:null});
    return Response.json([{id:'job-123',text:'Data Analyst',country:'US',categories:{location:'Raleigh, NC'},
      applyUrl:'https://jobs.lever.co/synthetic/job-123/apply'}]);
  }) as typeof fetch;
  try{
    const response=await fn(req(false));const body=await response.json();
    assertEquals(response.status,200);assertEquals(body.status,'staged');assertEquals(body.published,0);assertEquals(body.candidates_promoted,1);
    assert(!JSON.stringify(body).includes('fixture-lease'));assert(!JSON.stringify(body).includes(source.permission_ref));
    const staged=calls.find(c=>c.url.endsWith('/employer_feed_stage_registered_run'));
    assert(staged);assertEquals(staged.body.p_token,'fixture-lease');assertEquals(staged.body.p_rows[0].employer_source_id,source.id);
    assert(!calls.some(c=>/upsert|publish|close|pre_scraped_jobs/.test(c.url)));
  }finally{globalThis.fetch=original;}
});

Deno.test('a missing registry bridge returns 503 before any provider or staging call',async()=>{
  const fn=await loadWorker(true);const original=globalThis.fetch;let calls=0;
  globalThis.fetch=(async input=>{calls++;assert(String(input).endsWith('/employer_source_for_worker'));
    return new Response('private-backend-detail',{status:404});}) as typeof fetch;
  try{
    const response=await fn(req(false));assertEquals(response.status,503);assertEquals(calls,1);
    const text=await response.text();assert(text.includes('registry_unavailable'));assert(!text.includes('private-backend-detail'));
  }finally{globalThis.fetch=original;}
});
