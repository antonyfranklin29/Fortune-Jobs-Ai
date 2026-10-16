const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const controller=read('login-form.js'),flow=require('../account-flow.js');
async function setup({area='employer',search='',user=null,session=null}={}){
 const nodes={},calls=[],timers=[];
 const node=id=>nodes[id]||(nodes[id]={value:'',disabled:false,textContent:'',className:'',type:'password',style:{},classList:{toggle(){}},setAttribute(){},focus(){},events:{},addEventListener(name,fn){this.events[name]=fn;}});
 const fields=[['fullName','signup'],['email','signin signup forgot'],['password','signin signup reset']];
 const containers=fields.map(([id,show])=>({dataset:{show},style:{},querySelectorAll:()=>[node(id)]}));
 const auth={onAuthStateChange(){},signInWithPassword:async args=>{calls.push(['signin',args]);return{error:null};},
  signInWithOAuth:async args=>{calls.push(['oauth',args]);return{error:null};},
  signUp:async args=>{calls.push(['signup',args]);return{data:{user:{identities:[{}]},session},error:null};},
  resetPasswordForEmail:async(...args)=>{calls.push(['forgot',...args]);return{error:null};},
  getSession:async()=>({data:{session:session||{user}}}),updateUser:async args=>{calls.push(['reset',args]);return{error:null};}};
 const FJ={user:async()=>user,baseUrl:()=> 'https://fortunejobsai.com/',sb:{auth}};
 const location={search,hash:'',href:'',replace(value){this.href=value;}};
 const context=vm.createContext({window:{FJ},FJ,FJ_CONFIG:{url:'https://fixture.supabase.test',key:'publishable-fixture'},FJAccountFlow:flow,
  location,document:{body:{dataset:{accountArea:area}},getElementById:node,querySelectorAll:()=>containers},
  fetch:async()=>({ok:true,json:async()=>({external:{google:true}})}),URLSearchParams,AbortSignal,
  setTimeout:fn=>{timers.push(fn);},console});
 await vm.runInContext(controller,context);
 return{context,nodes,calls,location,timers,node,submit:()=>node('authForm').events.submit({preventDefault(){}})};
}
test('employer email sign-in stays in the employer workspace without assigning a role',async()=>{
 const b=await setup({search:'?next=profile.html'});b.node('email').value='employer@synthetic.com';b.node('password').value='fixture-password';
 await b.submit();assert.equal(b.location.href,'employers.html');
 assert.deepEqual(JSON.parse(JSON.stringify(b.calls)),[['signin',{email:'employer@synthetic.com',password:'fixture-password'}]]);
});
test('job seekers land on their profile or a validated requested job page',async()=>{
 for(const [search,expected]of [['','profile.html'],['?next=results.html%3Fq%3Danalyst','results.html?q=analyst']]){
  const b=await setup({area:'jobseeker',search});b.node('email').value='seeker@synthetic.com';b.node('password').value='fixture-password';await b.submit();assert.equal(b.location.href,expected);
 }
});
test('Google uses the existing approved callback and preserves employer destination',async()=>{
 const b=await setup();await b.context.signInWithProvider('google');
 assert.equal(b.calls[0][1].provider,'google');
 assert.equal(b.calls[0][1].options.redirectTo,'https://fortunejobsai.com/login.html?next=employers.html');
});
test('employer signup confirmation preserves the workspace without writing privileged metadata',async()=>{
 const b=await setup({search:'?mode=signup'});b.node('email').value='employer@synthetic.com';b.node('password').value='fixture-password';b.node('fullName').value='Synthetic Owner';
 await b.submit();const args=b.calls[0][1];assert.equal(args.options.emailRedirectTo,'https://fortunejobsai.com/login.html?next=employers.html');
 assert.deepEqual(JSON.parse(JSON.stringify(args.options.data)),{full_name:'Synthetic Owner'});
 assert.match(b.node('msg').textContent,/confirmation link/);assert.equal(b.location.href,'');
});
test('immediate signup and existing Google sessions enter the right workspace',async()=>{
 const existing=await setup({area:'jobseeker',search:'?next=employers.html',user:{id:'fixture'}});
 assert.equal(existing.location.href,'employers.html');assert.equal(existing.node('accountArea').textContent,'EMPLOYER ACCOUNT');
 const b=await setup({search:'?mode=signup',session:{user:{id:'fixture'}}});b.node('email').value='owner@synthetic.com';b.node('password').value='fixture-password';await b.submit();assert.equal(b.location.href,'employers.html');
});
test('employer password recovery retains its destination and hidden-field validation',async()=>{
 const b=await setup({search:'?mode=forgot'});b.node('email').value='owner@synthetic.com';await b.submit();
 assert.equal(b.calls[0][2].redirectTo,'https://fortunejobsai.com/login.html?mode=reset&next=employers.html');
 const r=await setup({search:'?mode=reset',user:{id:'fixture'}});r.node('password').value='new-fixture-password';await r.submit();r.timers[0]();assert.equal(r.location.href,'employers.html');
});
test('return paths reject external destinations, login loops and ambiguous paths',()=>{
 for(const input of ['https://evil.example','//evil.example','employers.html/../profile.html','employers.html\\evil','employers.html\n','employer-login.html','login.html']){
  assert.equal(flow.employerNext(input),'employers.html');assert.equal(flow.isEmployerNext(input),false);
 }
 assert.equal(flow.employerNext('employers.html?setup=1'),'employers.html?setup=1');
});
test('dedicated entries retain email/password first, Google below, and cross links',()=>{
 for(const page of ['login.html','employer-login.html']){
  const html=read(page);assert.ok(html.indexOf('id="password"')<html.indexOf('id="googleBtn"'));
  assert.match(html,/src="login-form.js\?/);assert.doesNotMatch(html,/appleBtn|account_type|is_employer/);
 }
 assert.match(read('employer-login.html'),/data-account-area="employer"/);
 assert.match(read('login.html'),/href="employer-login.html"/);
 for(const page of ['index.html','find-jobs.html','results.html','about.html'])assert.match(read(page),/href="employers.html">For employers/);
});
