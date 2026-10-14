const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../login.html'),'utf8');
test('switching to recovery disables hidden password validation and reset disables email validation',()=>{
 const fields=[['fullName','signup'],['email','signin signup forgot'],['password','signin signup reset']];
 const nodes={};for(const [id]of fields)nodes[id]={disabled:false};
 for(const id of ['tabSignin','tabSignup','authTitle','authSub','submitBtn','passwordLabel','pwToggle','emailLabel'])nodes[id]={classList:{toggle(){}},setAttribute(){},textContent:''};
 const containers=fields.map(([id,show])=>({dataset:{show},style:{},querySelectorAll:()=>[nodes[id]]}));
 const ctx=vm.createContext({$:id=>nodes[id],document:{querySelectorAll:()=>containers},MODES:{signin:{title:'',sub:'',btn:'',pwLabel:'Password',pwAuto:'current-password'},signup:{},forgot:{},reset:{}},hideMsg(){},mode:''});
 vm.runInContext(html.match(/^function setMode\([^]*?^}/m)[0],ctx);
 ctx.setMode('forgot');assert.equal(nodes.password.disabled,true);assert.equal(nodes.email.disabled,false);
 ctx.setMode('reset');assert.equal(nodes.password.disabled,false);assert.equal(nodes.email.disabled,true);assert.equal(nodes.password.minLength,8);
 ctx.setMode('signin');assert.equal(nodes.password.minLength,1);assert.equal(nodes.fullName.disabled,true);assert.equal(nodes.email.disabled,false);
});
test('account page inline scripts parse',()=>{for(const block of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(block[1].trim())new vm.Script(block[1]);});
const flow=require('../account-flow.js');
test('OAuth return destinations are restricted to real local product pages',()=>{
 assert.equal(flow.next('results.html?q=Data+Analyst&country=us'),'results.html?q=Data+Analyst&country=us');
 for(const value of ['https://evil.example','//evil.example','javascript:alert(1)','login.html?mode=reset','unknown.html','profile.html\\evil','profile.html\n'])assert.equal(flow.next(value),'profile.html');
});
test('provider availability fails closed and callback errors never expose raw details',()=>{
 assert.deepEqual(flow.providers({external:{google:true}}),{google:true});
 assert.deepEqual(flow.providers({external:{google:'true',apple:1}}),{google:false});
 assert.deepEqual(flow.providers(null),{google:false});
 const msg=flow.callbackError('?error=access_denied&error_description=private-secret','');
 assert.match(msg,/cancelled/);assert.ok(!msg.includes('private-secret'));
 assert.match(flow.callbackError('','#error_code=otp_expired'),/expired/);
 assert.equal(flow.callbackError('?next=profile.html',''),'');
});
test('OAuth wiring supports Google and rejects other providers, safe callback return and provider failures',async()=>{
 const calls=[],nodes={};for(const id of ['googleBtn','appleBtn','submitBtn','providerStatus'])nodes[id]={disabled:false,textContent:''};
 const fj={baseUrl:()=> 'https://fortunejobsai.com/',sb:{auth:{signInWithOAuth:async args=>{calls.push(args);return {error:new Error('provider configuration')}}}}};
 let message='';const ctx=vm.createContext({window:{FJ:fj},FJ:fj,$:id=>nodes[id],providerAvailability:{google:true,apple:true},oauthBusy:false,nextPage:()=> 'profile.html',friendly:()=> 'Please try email.',showMsg:s=>{message=s;}});
 vm.runInContext(html.match(/^async function signInWithProvider\([^]*?^}/m)[0],ctx);
 await ctx.signInWithProvider('google');await ctx.signInWithProvider('apple');await ctx.signInWithProvider('constructor');
 assert.equal(calls.length,1);assert.equal(calls[0].provider,'google');
 assert.equal(calls[0].options.redirectTo,'https://fortunejobsai.com/login.html?next=profile.html');
 assert.equal(message,'Please try email.');assert.equal(nodes.submitBtn.disabled,false);
 ctx.providerAvailability.google=false;await ctx.signInWithProvider('google');assert.equal(calls.length,1);
});
