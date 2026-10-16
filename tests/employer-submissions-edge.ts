// Offline domain-check endpoint tests. No real accounts, DNS, or credentials.
import { assert, assertEquals } from './deno/assert.ts';
const SB='https://fake.supabase.test', ORG='3f1c2d4e-1111-4222-8333-444455556666';
const USER='9a9a9a9a-1111-4222-8333-444455556666', OTHER='8b8b8b8b-1111-4222-8333-444455556666';
const TOKEN='0123456789abcdef0123456789abcdef', ATTEMPT='aaaaaaaa-1111-4222-8333-444455556666';
Deno.env.set('SUPABASE_URL',SB); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','fixture-service');
(globalThis as Record<string,unknown>).__EMPLOYER_TEST__=true;
let checked=false, verified=false, inactive=false, invalidated=false, broken=false;
let dns:string[][]=[], lookups:string[]=[], marks:boolean[]=[];
function reset(){checked=false;verified=false;inactive=false;invalidated=false;broken=false;dns=[];lookups=[];marks=[];}
(Deno as unknown as {resolveDns:unknown}).resolveDns=(name:string,type:string)=>{
  assertEquals(type,'TXT');lookups.push(name);return Promise.resolve(dns);
};
globalThis.fetch=(async(input:Request|URL|string,init?:RequestInit)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  assertEquals(url.origin,SB);const auth=new Headers(init?.headers).get('authorization');
  if(url.pathname==='/auth/v1/user'){
    if(auth==='Bearer user-token')return Response.json({id:USER,email_confirmed_at:'2026-10-01'});
    if(auth==='Bearer other-token')return Response.json({id:OTHER,email_confirmed_at:'2026-10-01'});
    if(auth==='Bearer unconfirmed')return Response.json({id:OTHER});
    return new Response('{}',{status:401});
  }
  assertEquals(auth,'Bearer fixture-service');
  if(broken) return new Response('invalid-json');
  const b=JSON.parse(String(init?.body));assertEquals(b.p_org,ORG);
  if(url.pathname==='/rest/v1/rpc/employer_domain_check_begin'){
    if(b.p_user!==USER)return Response.json({state:'not_found'});
    if(inactive)return Response.json({state:'inactive'});
    if(verified)return Response.json({state:'verified'});
    if(checked)return Response.json({state:'rate_limited'});
    checked=true;return Response.json({state:'lookup',domain:'acme.com',token:TOKEN,attempt_id:ATTEMPT});
  }
  if(url.pathname==='/rest/v1/rpc/employer_domain_check_finish'){
    assertEquals(b.p_user,USER);assertEquals(b.p_attempt,ATTEMPT);assertEquals(b.p_token,TOKEN);
    marks.push(b.p_matched);
    if(invalidated)return Response.json({state:'invalidated'});
    verified=b.p_matched;return Response.json({state:'finished',verified});
  }
  throw Error('unexpected RPC');
}) as typeof fetch;
const {handler}=await import('../supabase/functions/employer-submissions/index.ts');
const payload={action:'check_domain',org_id:ORG};
async function call(token:string|null,body:unknown=payload){
  const res=await handler(new Request('https://fn.test',{method:'POST',headers:{...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)}));
  return {status:res.status,body:await res.json()};
}
Deno.test('anonymous, project credentials and unconfirmed users are refused',async()=>{
  reset();for(const token of [null,'anon-key','fixture-service'])assertEquals((await call(token)).status,401);
  assertEquals((await call('unconfirmed')).status,403);assertEquals(lookups.length,0);
});
Deno.test('non-members cannot reserve a DNS check',async()=>{
  reset();assertEquals((await call('other-token')).status,404);assertEquals(lookups.length,0);assertEquals(checked,false);
});
Deno.test('strict object requests reject extra fields, null, arrays and wrong action',async()=>{
  reset();for(const body of [null,[],{...payload,domain:'evil.internal'},{...payload,action:'approve'},{...payload,org_id:'bad'}]){
    assertEquals((await call('user-token',body)).status,400);
  }assertEquals(checked,false);
});
Deno.test('unadvertised and multibyte oversized bodies are refused before lookup',async()=>{
  reset();for(const text of [' '.repeat(1001),JSON.stringify({...payload,padding:'é'.repeat(600)})]){
    const res=await handler(new Request('https://fn.test',{method:'POST',headers:{authorization:'Bearer user-token'},body:text}));
    assertEquals(res.status,413);
  }assertEquals(checked,false);
});
Deno.test('mismatch consumes the atomic minute; another check does not resolve DNS',async()=>{
  reset();dns=[['other=value']];assertEquals((await call('user-token')).body.verified,false);
  assertEquals(lookups,['_fortunejobsai.acme.com']);assertEquals(marks,[false]);
  assertEquals((await call('user-token')).status,429);assertEquals(lookups.length,1);
});
Deno.test('two overlapping requests issue at most one lookup',async()=>{
  reset();const results=await Promise.all([call('user-token'),call('user-token')]);
  assertEquals(results.map(x=>x.status).sort(),[200,429]);assertEquals(lookups.length,1);
});
Deno.test('matching proof returns database-confirmed verification and stays idempotent',async()=>{
  reset();dns=[['fortunejobsai-verify=',TOKEN]];assertEquals((await call('user-token')).body.verified,true);assert(verified);
  assertEquals((await call('user-token')).body.verified,true);assertEquals(lookups.length,1);
});
Deno.test('suspended organization is refused even with old domain verification',async()=>{
  reset();inactive=true;verified=true;assertEquals((await call('user-token')).status,409);assertEquals(lookups.length,0);
});
Deno.test('a stale proof cannot report success after token/status changes',async()=>{
  reset();dns=[['fortunejobsai-verify=',TOKEN]];invalidated=true;
  assertEquals((await call('user-token')).body.error,'check_invalidated');assertEquals(verified,false);
});
Deno.test('malformed upstream data returns a sanitized retriable error',async()=>{
  reset();broken=true;const res=await call('user-token');assertEquals(res.status,503);
  assertEquals(res.body,{error:'temporarily_unavailable'});
});
