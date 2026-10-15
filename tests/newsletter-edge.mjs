// Isolated endpoint tests: fake Auth/REST only, no external network.
const assert={equal(a,b){if(a!==b)throw Error('Assertion failed: '+a+' !== '+b);},ok(v){if(!v)throw Error('Assertion failed');}};
let handler;Deno.serve=(fn)=>{handler=fn;return {};};
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','disposable-test-key');
Deno.env.set('NEWSLETTER_UNSUBSCRIBE_SECRET','x'.repeat(40));
let calls=[];
const user='00000000-0000-4000-8000-000000000001';
globalThis.fetch=async(url,init={})=>{calls.push({url,init});const body=url.endsWith('/auth/v1/user')?{id:user,email_confirmed_at:'2026-10-14'}:[];return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});};
await import('../supabase/functions/email-preferences/index.ts');
const base='https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/email-preferences';
const payload=btoa(user).replace(/=/g,'');
const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('x'.repeat(40)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload));
const token=payload+'.'+btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
Deno.test('unsigned preferences require auth and reject foreign origins',async()=>{calls=[];assert.equal((await handler(new Request(base))).status,401);assert.equal((await handler(new Request(base,{headers:{Origin:'https://evil.example'}}))).status,403);assert.equal(calls.length,0);});
Deno.test('signed unsubscribe GET never writes; POST writes only token owner',async()=>{calls=[];let r=await handler(new Request(base+'?token='+token));assert.equal(r.status,200);assert.equal(calls.length,0);r=await handler(new Request(base+'?token='+token,{method:'POST',body:'List-Unsubscribe=One-Click'}));assert.equal(r.status,200);assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('user_id=eq.'+user));assert.equal(JSON.parse(calls[0].init.body).subscribed,false);});
Deno.test('tampered unsubscribe token cannot modify preferences',async()=>{calls=[];assert.equal((await handler(new Request(base+'?token='+token.slice(0,-5)+'abcde',{method:'POST'}))).status,400);assert.equal(calls.length,0);});
Deno.test('preference write ignores supplied foreign user ID and trusts verified JWT identity',async()=>{calls=[];const r=await handler(new Request(base,{method:'POST',headers:{Authorization:'Bearer disposable-token','Content-Type':'application/json'},body:JSON.stringify({subscribed:true,consent_version:'weekly-v1',user_id:'foreign'})}));assert.equal(r.status,200);const write=calls.find(c=>c.init.method==='POST');assert.equal(JSON.parse(write.init.body).user_id,user);assert.equal(JSON.parse(write.init.body).consent_version,'weekly-v1');});
