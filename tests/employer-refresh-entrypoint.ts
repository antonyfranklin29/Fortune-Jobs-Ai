import {assert,assertEquals} from './deno/assert.ts';
type Handler=(req:Request)=>Response|Promise<Response>;
let version=0;
const DB='https://fixture.supabase.test',SECRET='fixture-ingest-secret',KEY='fixture-service-key';
async function load(){
  Deno.env.set('SUPABASE_URL',DB);Deno.env.set('SUPABASE_SERVICE_ROLE_KEY',KEY);Deno.env.set('INGEST_SECRET',SECRET);
  const original=Deno.serve;let handler:Handler|undefined;
  Deno.serve=((fn:Handler)=>{handler=fn;return{};}) as typeof Deno.serve;
  try{await import(`${Deno.env.get('FJ_REFRESH_BUNDLE')??'../supabase/functions/employer-refresh/index.ts'}?fixture=${++version}`);}finally{Deno.serve=original;}
  assert(handler);return handler as Handler;
}
const request=(action='refresh')=>new Request('https://refresh.example',{method:'POST',headers:{'x-ingest-secret':SECRET},body:JSON.stringify({action})});
const source={id:'fixture-source',adapter:'lever',api_region:'global',board_token:'synthetic',employer_name:'Synthetic Employer',
  status:'approved',enabled:true,rights_basis:'employer_written_permission',permission_ref:'private-fixture-permission',approved_by:'fixture-reviewer',
  approved_at:new Date(Date.now()-3600000).toISOString(),domain_verified_at:new Date(Date.now()-3600000).toISOString(),
  authorization_expires_at:new Date(Date.now()+86400000).toISOString(),allow_display:true,allow_refresh:true,
  allow_description:false,allowed_apply_hosts:['jobs.lever.co'],attribution_text:''};
Deno.test('refresh entrypoint authenticates before SQL; disabled control never calls a provider',async()=>{
  const fn=await load();const old=fetch;const calls:string[]=[];
  globalThis.fetch=(async(input:any,init?:RequestInit)=>{
    calls.push(String(input));assertEquals(String(input),DB+'/rest/v1/rpc/employer_refresh_claim');
    assertEquals(new Headers(init?.headers).get('authorization'),'Bearer '+KEY);return Response.json({status:'disabled'});
  }) as typeof fetch;
  try{
    assertEquals((await fn(new Request('https://refresh.example',{method:'POST',body:'{}'}))).status,401);assertEquals(calls.length,0);
    assertEquals((await fn(request())).status,503);assertEquals(calls.length,1);
  }finally{globalThis.fetch=old;}
});
Deno.test('actual refresh entrypoint collects from pinned ATS then settles by ticket and run only',async()=>{
  const fn=await load();const old=fetch;const calls:string[]=[];
  globalThis.fetch=(async(input:any,init?:RequestInit)=>{
    const url=String(input);calls.push(url);const headers=new Headers(init?.headers);
    if(url.startsWith(DB+'/rest/v1/rpc/')){
      assertEquals(headers.get('apikey'),KEY);const args=JSON.parse(String(init?.body));
      if(url.endsWith('/employer_refresh_claim'))return Response.json({status:'claimed',ticket:'fixture-ticket',source_id:source.id,max_requests:6});
      if(url.endsWith('/employer_source_for_worker'))return Response.json({source,revision:1});
      if(url.endsWith('/employer_feed_run_begin'))return Response.json({status:'claimed',run_id:'fixture-run',lease_token:'private-fixture-lease'});
      if(url.endsWith('/employer_feed_stage_registered_run'))return Response.json({status:'staged',candidates_promoted:1});
      if(url.endsWith('/employer_refresh_finish')){
        assertEquals(args,{p_ticket:'fixture-ticket',p_run:'fixture-run'});
        return Response.json({status:'complete',published:1,closed:0});
      }
      throw Error('unexpected RPC');
    }
    assertEquals(url,'https://api.lever.co/v0/postings/synthetic?mode=json&skip=0&limit=100');
    assertEquals(headers.get('authorization'),null);assertEquals(headers.get('apikey'),null);assertEquals(headers.get('x-ingest-secret'),null);
    assertEquals(init?.redirect,'error');return Response.json([{id:'job-0',text:'Data Analyst',country:'US',categories:{location:'Raleigh, NC'},applyUrl:'https://jobs.lever.co/synthetic/job-0/apply'}]);
  }) as typeof fetch;
  try{
    const res=await fn(request());assertEquals(res.status,200);const body=await res.json();assertEquals(body.published,1);
    assert(!JSON.stringify(body).includes('private-fixture'));assert(calls.at(-1)?.endsWith('/employer_refresh_finish'));
    assert(!calls.some(url=>/employer_publish_feed_jobs|employer_close_feed_jobs/.test(url)));
  }finally{globalThis.fetch=old;}
});
Deno.test('private health endpoint neither collects nor mutates catalogue',async()=>{
  const fn=await load();const old=fetch;
  globalThis.fetch=(async(input:any)=>{assertEquals(String(input),DB+'/rest/v1/rpc/employer_refresh_health');return Response.json({enabled:false,eligible_sources:0});}) as typeof fetch;
  try{const res=await fn(request('health'));assertEquals(await res.json(),{enabled:false,eligible_sources:0});}finally{globalThis.fetch=old;}
});
