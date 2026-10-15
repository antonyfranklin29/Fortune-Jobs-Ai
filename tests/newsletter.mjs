import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderDigest,safeUrl} from '../newsletter/email.mjs';
import {selectJobs,unsubscribeToken,run} from '../scripts/newsletter-worker.mjs';
const now=Date.parse('2026-10-14T12:00:00Z');
const profile={current_title:'Data Analyst',saved_filters:{country:'us',city:'New York',location:'New York, NY'}};
const job={job_title:'Data Analyst',company:'Example',location:'New York, NY',country:'us',posted_at:'2026-10-13T12:00:00Z',apply_url:'https://example.com/job/1'};
test('digest refuses stale, future, irrelevant and duplicate jobs without unrelated fallback',()=>{
 const input=[job,{...job},{...job,posted_at:'2026-09-01'},{...job,posted_at:'2027-01-01'},{...job,job_title:'Nurse'},{...job,location:'Boston, MA'},{...job,apply_url:'javascript:alert(1)'}];
 assert.equal(selectJobs(input,profile,now).length,1);
 assert.equal(selectJobs(input,{current_title:'Data Analyst'},now).length,0);
 assert.equal(selectJobs([{...job,posted_at:null}],profile,now).length,0);
});
test('renderer escapes profile/job/address content, rejects unsafe URLs and missing footer configuration',()=>{
 const unsub='https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/email-preferences?token=x.y';
 const opts={name:'<script>',jobs:[{...job,job_title:'<img onerror=x>',company:'A&B'}],address:'Example PO Box 1',unsubscribeUrl:unsub};
 const mail=renderDigest(opts);assert.ok(!mail.html.includes('<script>'));assert.ok(mail.html.includes('&lt;img'));assert.ok(mail.text.includes('Unsubscribe:'));
 assert.throws(()=>renderDigest({...opts,address:''}));assert.throws(()=>renderDigest({...opts,jobs:[]}));
 assert.throws(()=>renderDigest({...opts,unsubscribeUrl:'https://evil.example'}));assert.equal(safeUrl('https://user:pass@example.com'),null);
});
test('unsubscribe capability is a stable HMAC, and changing user ID invalidates signature',()=>{
 const id='00000000-0000-4000-8000-000000000001',secret='a'.repeat(40),token=unsubscribeToken(id,secret),[p,s]=token.split('.');
 assert.equal(Buffer.from(p,'base64url').toString(),id);assert.equal(s,createHmac('sha256',secret).update(p).digest('base64url'));
 assert.notEqual(s,unsubscribeToken(id.replace(/1$/,'2'),secret).split('.')[1]);
});
const env={SUPABASE_URL:'https://hqgakkcxcyspqhnlnscv.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test',NEWSLETTER_ENABLED:'true',NEWSLETTER_POSTAL_ADDRESS:'PO Box example',NEWSLETTER_UNSUBSCRIBE_SECRET:'x'.repeat(40),RESEND_API_KEY:'test'};
function mock(opts={}){const calls=[];return {calls,fetcher:async(url,init={})=>{calls.push({url,init});const response=x=>new Response(JSON.stringify(x),{status:200,headers:{'Content-Type':'application/json'}});
 if(url.includes('api.resend.com')){if(opts.timeout)throw Error('timeout');return response({id:'provider-1'});}
 if(url.includes('/admin/users/'))return response({email:'test@example.com',email_confirmed_at:'2026-10-13'});
 if(url.includes('rpc/newsletter_claim'))return response('00000000-0000-4000-8000-000000000002');
 if(init.method==='PATCH')return response([]);
 if(url.includes('newsletter_preferences?user_id'))return response([{subscribed:!opts.optedOut}]);
 if(url.includes('newsletter_preferences?'))return response([{user_id:'00000000-0000-4000-8000-000000000001'}]);
 if(url.includes('profiles?'))return response([profile]);
 if(url.includes('pre_scraped_jobs?'))return response([{...job,posted_at:new Date(Date.now()-86400000).toISOString()}]);
 throw Error('Unexpected request');}};}
test('dry run never reserves or sends email',async()=>{const m=mock();const result=await run(env,m.fetcher);assert.equal(result.dryRun,true);assert.equal(result.eligible,1);assert.ok(!m.calls.some(x=>x.url.includes('resend.com')||x.url.includes('/rpc/')));});
test('live send refuses missing address before making any requests',async()=>{process.argv.push('--send');try{await assert.rejects(run({...env,NEWSLETTER_POSTAL_ADDRESS:''},()=>{throw Error('must not call');}),/configuration incomplete/);}finally{process.argv.pop();}});
test('unsubscribe after claim suppresses provider call',async()=>{process.argv.push('--send');try{const m=mock({optedOut:true});await run(env,m.fetcher);assert.ok(!m.calls.some(x=>x.url.includes('api.resend.com')));assert.ok(m.calls.some(x=>x.init.body?.includes('suppressed')));}finally{process.argv.pop();}});
test('provider timeout marks unknown; does not retry sending',async()=>{process.argv.push('--send');try{const m=mock({timeout:true});await assert.rejects(run(env,m.fetcher),/operator review/);assert.equal(m.calls.filter(x=>x.url.includes('api.resend.com')).length,1);assert.ok(m.calls.some(x=>x.init.body?.includes('unknown')));}finally{process.argv.pop();}});
test('accepted send includes plain text and one-click unsubscribe, reports accepted not delivered',async()=>{process.argv.push('--send');try{const m=mock();const result=await run(env,m.fetcher);assert.equal(result.accepted,1);const send=m.calls.find(x=>x.url.includes('api.resend.com'));const body=JSON.parse(send.init.body);assert.ok(body.text);assert.equal(body.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');assert.ok(send.init.headers['Idempotency-Key']);}finally{process.argv.pop();}});
test('profile and preferences scripts parse after replacing placeholder alert controls',()=>{const html=readFileSync(new URL('../profile.html',import.meta.url),'utf8');for(const block of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(block[1].trim())new vm.Script(block[1]);new vm.Script(readFileSync(new URL('../newsletter-preferences.js',import.meta.url),'utf8'));assert.ok(!html.includes('id="alertsToggle"'));});
