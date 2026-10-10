// Explicit opt-in: this exercises the production scraper and incurs usage.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
if (!process.argv.includes('--production')) throw Error('Pass --production to run paid live searches.');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const value = name => html.match(new RegExp("const " + name + "\\s*=\\s*'([^']*)'"))[1];
const headers = {apikey:value('SUPABASE_KEY'),Authorization:'Bearer '+value('SUPABASE_KEY')};
const cases = [
  ['software engineer','New York','US'], ['data analyst','San Francisco','US'],
  ['product manager','London','GB'], ['software engineer','Bengaluru','IN'],
  ['zzqvnonexistentjobxyz','New York','US'],
];
async function run(c, group) {
  const [query,location,country] = c, searchId = crypto.randomUUID(), started = performance.now();
  let firstMs = null, jobs = [], complete = false, acknowledgement;
  const submission = fetch(value('WEBHOOK_URL_LIVE'), {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({text:query,location,country,mode:'live',search_id:searchId,results_limit:10}),
    signal:AbortSignal.timeout(10000),
  }).then(r=>{acknowledgement=r.status}).catch(e=>{acknowledgement=e.name});
  try {
    while(performance.now()-started < 60000) {
      const response = await fetch(value('SUPABASE_URL')+'/rest/v1/job_matches?select=job_title,company,location,apply_url,match_score,match_reason&limit=11&search_id=eq.'+searchId,
        {headers,signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw Error('Result read HTTP '+response.status);
      const rows = await response.json();
      complete = rows.some(r=>r.job_title==='No matching jobs found');
      jobs = rows.filter(r=>r.job_title && r.job_title!=='No matching jobs found' && r.company!=='N/A');
      if(jobs.length && firstMs===null) firstMs=Math.round(performance.now()-started);
      if(complete) break;
      await new Promise(r=>setTimeout(r,1000));
    }
    await submission;
    const result = {group,query,location,country,searchId,acknowledgement,firstMs,completionMs:complete?Math.round(performance.now()-started):null,
      jobs:jobs.length,complete,validUrls:jobs.every(j=>/^https?:\/\//.test(j.apply_url)),samples:jobs.slice(0,2)};
    console.log(JSON.stringify(result)); return result;
  } catch(e) {await submission; const result={group,query,searchId,error:e.message}; console.log(JSON.stringify(result)); return result;}
}
(async()=>{
  const rows=[];
  for(const c of cases) rows.push(await run(c,'sequential'));
  rows.push(...await Promise.all(cases.map(c=>run(c,'five simultaneous'))));
  fs.writeFileSync(path.resolve(process.argv.find(a=>a.endsWith('.json'))||path.join(__dirname,'../../live-search-benchmark.json')),JSON.stringify({timestamp:new Date().toISOString(),scope:'Production webhook through stored results; one machine; five concurrent live searches, not 100.',rows},null,2));
  if(rows.some(r=>r.error||!r.complete||!r.validUrls)) process.exitCode=1;
})();
