// Local built-site QA. All external requests are intercepted; jobs/counts are fictional fixtures.
import { createRequire } from 'node:module';
import { mkdir,readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const now=new Date().toISOString();
const rows=[
 ['Registered Nurse - ICU Day Shift','GA','registered-nurse','Day shift. RN license. ICU experience.','$38–45/hr'],
 ['Registered Nurse - ER Night Shift','GA','registered-nurse','Night shift. Registered Nurse. Emergency department.','$40/hr'],
 ['Registered Nurse - Night Shift','TX','registered-nurse','RN license. Night shift. Med-Surg.','$42/hr'],
 ['Local CDL-A Truck Driver','OH','cdl-truck-driver','CDL-A required. Local driver routes. Day shift.','$28/hr'],
 ['Regional CDL-B Driver','OH','cdl-truck-driver','CDL-B required. Regional driver routes.','$30/hr'],
 ['Software Engineer','NJ','software-engineer','Build software with Java and Python. Full-time engineering role.','$110,000/year'],
 ['Software Engineer II','NJ','software-engineer','Develop software in JavaScript. Full-time.','$120,000/year'],
 ['Registered Nurse','SC','registered-nurse','RN license. Day shift.','$39/hr'],
 ['Licensed Practical Nurse','GA','licensed-practical-nurse','LPN required. Evening shift.','$30/hr'],
 ['Data Analyst','NJ','data-analyst','SQL and Python data analysis.','$90,000/year'],
].map(([job_title,state_code,canonical_role,job_description,salary],i)=>({id:i+1,job_title,state_code,canonical_role,job_description,salary,company:'Example Care '+(i+1),location:({GA:'Atlanta',TX:'Austin',OH:'Columbus',NJ:'Edison',SC:'Columbia'})[state_code]+', '+state_code,apply_url:'https://example.test/jobs/'+i,source:'employer_feed',category:job_title,country:'us',closed_at:null,posted_at:now,employment_type:'Full-time'}));
const neighbours=JSON.parse(await readFile(new URL('../config/us-neighbours.json',import.meta.url)));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext();
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();
  if(!u.hostname.endsWith('.supabase.co'))return route.abort();
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','content-type':'application/json'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  let body=[];
  if(u.pathname.endsWith('/pre_scraped_jobs')){
   body=rows.filter(r=>!u.searchParams.has('state_code')||u.searchParams.get('state_code')==='eq.'+r.state_code);
   if(u.searchParams.get('source')==='neq.employer_feed')body=[];
  }
  if(u.pathname.endsWith('/rpc/catalogue_search_alternatives')){
   const {p_role,p_state}=route.request().postDataJSON();
   body=[...new Set(rows.filter(r=>r.canonical_role===p_role&&(neighbours[p_state]||[]).includes(r.state_code)).map(r=>r.state_code))].map(state=>({kind:'state',label:state,state,role_name:p_role==='registered-nurse'?'Registered Nurse':'Software Engineer',open_jobs:rows.filter(r=>r.canonical_role===p_role&&r.state_code===state).length}));
   if(p_role==='registered-nurse'&&p_state==='GA')body.push({kind:'role',label:'Licensed Practical Nurse',role_name:'Licensed Practical Nurse',state:'GA',open_jobs:1});
  }
  if(u.pathname.endsWith('/rpc/catalogue_category_counts'))body=[{sector:'healthcare',open_jobs:5},{sector:'tech',open_jobs:3},{sector:'transport',open_jobs:2}];
  return route.fulfill({status:200,headers,body:JSON.stringify(body)});
 });
 const output=new URL('../docs/screenshots/healthcare/',import.meta.url);await mkdir(output,{recursive:true});
 const cases=[['registered-nurse-georgia','Registered Nurse','Georgia'],['night-nurse-texas','night shift nurse','Texas'],['cdl-driver-ohio','CDL driver','Ohio'],['software-new-jersey','software engineer','New Jersey']];
 for(const [name,q,location] of cases){
  for(const [device,width,height]of [['desktop',1440,1100],['phone',375,900]]){
   const page=await context.newPage();await page.setViewportSize({width,height});
   await page.goto('http://127.0.0.1:8892/results.html?'+new URLSearchParams({mode:'quick',country:'us',q,location}));
   await page.getByRole('heading',{name:/[0-9] jobs? found/}).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow: '+name+' '+device);
   if(q!=='software engineer')assert.equal(await page.getByLabel('Shift',{exact:true}).count(),1);
   if(q==='software engineer')assert.equal(await page.getByLabel('Shift',{exact:true}).count(),0);
   await page.screenshot({path:new URL(name+'-'+device+'.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});await page.close();
  }
 }
 console.log('Four searches passed at desktop and 375px. Eight fixture screenshots saved.');
}finally{await browser.close();}
