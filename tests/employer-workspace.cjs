const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../employer-submissions.js'),'utf8');
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.hidden=false;this.attrs={};this.events={};this.style={};this._text='';this.value='';}
 set textContent(t){this._text=String(t);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 setAttribute(k,v){this.attrs[k]=v;}append(...c){this.children.push(...c);}replaceChildren(...c){this._text='';this.children=c;}
 addEventListener(k,fn){this.events[k]=fn;}focus(){}querySelectorAll(){return[];}
}
const tick=()=>new Promise(setImmediate);
async function setup({user=null,state={orgs:[],plan:{free_active_posts:15,monthly_price_cents:1499}},rpcError=null,queue=null,note=''}={}){
 const nodes={},calls=[];let authChange,currentUser=user;
 const node=id=>nodes[id]||(nodes[id]=new Element());
 const FJ={user:async()=>currentUser,loginUrl:()=> 'employer-login.html?next=employers.html',sb:{
  rpc:async(name,args)=>{calls.push([name,args]);if(rpcError)return{error:rpcError};if(name==='operator_queue')return queue?{data:queue}:{error:new Error('operator_only')};return{data:typeof state==='function'?await state():state};},
  auth:{onAuthStateChange(fn){authChange=fn;},signOut:async()=>({error:null})}}};
 const ctx=vm.createContext({window:{FJ},document:{getElementById:node,createElement:t=>new Element(t),createTextNode:t=>{const n=new Element('#text');n.textContent=t;return n;}},Node:Element,
  fetch:async url=>({json:async()=>url.includes('job-roles')?{roles:[]}:{regions:[]}}),location:{href:''},prompt:()=>note,console});
 vm.runInContext(script,ctx);await tick();
 return{nodes,node,calls,ctx,async change(user){currentUser=user;authChange(user?'SIGNED_IN':'SIGNED_OUT');await tick();}};
}
const company={id:'fixture-org',name:'Private Synthetic Company',primary_domain:'synthetic.com',status:'verified',domain_verified:true,active_limit:15,active_posts:2,posts:[],sources:[]};
test('signed-out visitors see employer entry and never request company data',async()=>{
 const b=await setup();assert.equal(b.node('signed-out').hidden,false);assert.equal(b.node('signin').href,'employer-login.html?next=employers.html');
 assert.equal(b.calls.length,0);assert.equal(b.node('register').hidden,true);
});
test('a job seeker can start pending onboarding but metadata cannot create a company membership',async()=>{
 const b=await setup({user:{email:'fixture@synthetic.com',user_metadata:{is_employer:true,role:'operator'}}});
 assert.equal(b.node('register').hidden,false);assert.equal(b.node('operator').hidden,true);assert.equal(b.node('orgs').children.length,0);
 assert.equal(b.node('workspace-summary').hidden,true);assert.equal(b.calls[0][0],'employer_my_state');
});
test('workspace overview and private companies come only from authenticated server state',async()=>{
 const b=await setup({user:{email:'fixture@synthetic.com'},state:{orgs:[company],plan:{free_active_posts:15,monthly_price_cents:1499}}});
 assert.match(b.node('orgs').textContent,/Private Synthetic Company/);assert.equal(b.node('summary-active').textContent,'2');
 assert.equal(b.node('summary-companies').textContent,'1');assert.equal(b.node('workspace-summary').hidden,false);assert.equal(b.node('operator').hidden,true);
});
test('sign-out immediately clears company and reviewer content',async()=>{
 const b=await setup({user:{email:'fixture@synthetic.com'},state:{orgs:[company],plan:{free_active_posts:15,monthly_price_cents:1499}}});
 await b.change(null);assert.equal(b.node('orgs').textContent,'');assert.equal(b.node('queue').textContent,'');assert.equal(b.node('workspace-account').textContent,'');assert.equal(b.node('signed-out').hidden,false);
});
test('an old company request cannot render after the account changes',async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r;});const b=await setup({user:{email:'fixture@synthetic.com'},state:()=>pending});
 await b.change(null);resolve({orgs:[company],plan:{free_active_posts:15,monthly_price_cents:1499}});await tick();
 assert.equal(b.node('orgs').textContent,'');assert.equal(b.node('signed-out').hidden,false);assert.equal(b.node('workspace-summary').hidden,true);
});
test('unavailable backend leaves onboarding disabled and gives a useful message',async()=>{
 const b=await setup({user:{email:'fixture@synthetic.com'},rpcError:{code:'PGRST202',message:'function unavailable'}});
 assert.match(b.node('status').textContent,/Employer setup is being prepared/);assert.equal(b.node('register').hidden,true);assert.equal(b.node('operator').hidden,true);assert.equal(b.node('orgs').textContent,'');
});
test('reviewer verification requires an entered reason and sends that reason to the backend',async()=>{
 const queue={orgs:[{id:'other-fixture',name:'Other Synthetic',domain:'synthetic-other.com',domain_verified:true}],posts:[],sources:[]};
 const find=n=>n.tag==='button'&&n.textContent==='Verify'?n:n.children.map(find).find(Boolean);
 for(const note of ['', 'Company registry and website identity checked']){
  const b=await setup({user:{email:'reviewer@synthetic.com'},queue,note});
  const button=find(b.node('queue'));assert.ok(button);button.events.click();await tick();
  const calls=b.calls.filter(([fn])=>fn==='operator_set_org_status');assert.equal(calls.length,note?1:0);
  if(note)assert.equal(calls[0][1].p_note,note);
 }
});

test('reopening follows server approval; reviewer takedowns have no Make live action',async()=>{
 const buttons=n=>[...(n.tag==='button'?[n.textContent]:[]),...n.children.flatMap(buttons)];
 for(const can_activate of [true,false,undefined]){
  const b=await setup({user:{email:'fixture@synthetic.com'},state:{orgs:[{...company,posts:[{
   id:'post-fixture',job_title:'Data Analyst',status:'closed',has_unreviewed_changes:false,can_activate,
  }]}],plan:{free_active_posts:15,monthly_price_cents:1499}}});
  assert.equal(buttons(b.node('orgs')).includes('Make live'),can_activate===true);
  if(can_activate!==true)assert.match(b.node('orgs').textContent,/Reopening is unavailable/);
 }
});
