const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../login.html'),'utf8');
test('switching to recovery disables hidden password validation and reset disables email validation',()=>{
 const fields=[['fullName','signup'],['email','signin signup forgot'],['password','signin signup reset']];
 const nodes={};for(const [id]of fields)nodes[id]={disabled:false};
 for(const id of ['tabSignin','tabSignup','authTitle','authSub','submitBtn','passwordLabel'])nodes[id]={classList:{toggle(){}},textContent:''};
 const containers=fields.map(([id,show])=>({dataset:{show},style:{},querySelectorAll:()=>[nodes[id]]}));
 const ctx=vm.createContext({$:id=>nodes[id],document:{querySelectorAll:()=>containers},MODES:{signin:{title:'',sub:'',btn:'',pwLabel:'Password',pwAuto:'current-password'},signup:{},forgot:{},reset:{}},hideMsg(){},mode:''});
 vm.runInContext(html.match(/^function setMode\([^]*?^}/m)[0],ctx);
 ctx.setMode('forgot');assert.equal(nodes.password.disabled,true);assert.equal(nodes.email.disabled,false);
 ctx.setMode('reset');assert.equal(nodes.password.disabled,false);assert.equal(nodes.email.disabled,true);assert.equal(nodes.password.minLength,8);
 ctx.setMode('signin');assert.equal(nodes.password.minLength,1);assert.equal(nodes.fullName.disabled,true);assert.equal(nodes.email.disabled,false);
});
test('account page inline scripts parse',()=>{for(const block of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(block[1].trim())new vm.Script(block[1]);});
