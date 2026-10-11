// Default: read-only production verification. --live explicitly runs paid searches.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const value=name=>html.match(new RegExp("const "+name+"\\s*=\\s*'([^']*)'"))[1];
const source=name=>html.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^}','m'))[0];
const accuracy=require('../search-accuracy.js');
const context=vm.createContext({fetch,AbortController,setTimeout,clearTimeout,window: {FJResume:require('../resume-matching.js')}, FJResume:require('../resume-matching.js'), FJAccuracy:accuracy,
  SUPABASE_URL:value('SUPABASE_URL'),SUPABASE_KEY:value('SUPABASE_KEY'),SEARCH_REQUEST_TIMEOUT_MS:10000,
  QUICK_CANDIDATE_LIMIT:300,FREE_RESULTS:10,STOPWORDS:new Set(['a','an','and','the','of','for','to','in','on','at','with','or','jobs','job','role','roles','position','positions','senior','junior','sr','jr'])});
vm.runInContext(['readSearchRows','stripCodeFence','sanitizeJobRow','isSearchCompletion','fetchJobs','queryTokens','quickMatchUrl','scoreJob','fetchQuickMatches', 'personalizeJobs'].map(source).join('\n'),context);
const cases=[
 ['software engineer',{location:'New York',country:'us'}],
 ['software engineer',{country:'us',job_type:'fulltime'}],
 ['data analyst',{country:'us',work_mode:'remote'}],
 ['software engineer',{country:'us',company:'Microsoft'}],
 ['software engineer',{country:'us',experience:'entry',date_posted:'7'}],
 ['zzqvnonexistentjobxyz',{}],
];
async function verify(query,filters,live){
const start=performance.now();let jobs,id,complete=!live;
if(live){
id=crypto.randomUUID();
fetch(value('WEBHOOK_URL_LIVE'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:query,mode:'live',search_id:id,results_limit:10,...filters}),signal:AbortSignal.timeout(10000)}).catch(()=>{});
while(performance.now()-start<45000){
jobs=await context.fetchJobs(new AbortController().signal,'',id,query,filters);
if(jobs && (!jobs.length||jobs.completed)){complete=true;break;}
await new Promise(r=>setTimeout(r,1000));}
}else jobs=await context.fetchQuickMatches(query,filters,new AbortController().signal);
const rows=jobs || [],urls=rows.map(j=>accuracy.canonicalUrl(j.apply_url));
const valid=rows.every(j=>accuracy.matches(j,query,filters))&&new Set(urls).size===urls.length;
const record={mode:live?'live':'quick',query,filters,searchId:id,complete,ms:Math.round(performance.now()-start),jobs:rows.length,valid,
  samples:rows.slice(0,3).map(j=>({title:j.job_title,company:j.company,location:j.location,sourceCountry:accuracy.metadata(j).location?.country}))};
console.log(JSON.stringify(record));return record;
}
(async()=>{
const rows=[];
for(const [q,f] of cases) rows.push(await verify(q,f,false));
if(process.argv.includes('--live')) for(const [q,f] of [
 ['software engineer',{location:'New York',country:'us',job_type:'fulltime'}],
 ['product manager',{location:'London',country:'gb'}],
 ['Power BI Developer',{country:'us',work_mode:'remote'}],
 ['software engineer',{location:'New York',country:'us',company:'zzqvnonexistentcompanyxyz'}],
 ['zzqvnonexistentjobxyz',{location:'New York',country:'us'}],
]) rows.push(await verify(q,f,true));
fs.writeFileSync(path.resolve(process.argv.find(a=>a.endsWith('.json'))||path.join(__dirname,'../../result-accuracy-verification.json')),JSON.stringify({timestamp:new Date().toISOString(),scope:'Production candidate reads and verified filtering from one machine; sampled titles and filters, not all occupations or countries.',rows},null,2));
if(rows.some(r=>!r.complete||!r.valid)) process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1});
