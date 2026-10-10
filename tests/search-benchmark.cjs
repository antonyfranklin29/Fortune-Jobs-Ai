// Production read-only benchmark. Uses public anon access; never prints keys.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const value = name => html.match(new RegExp("const " + name + "\\s*=\\s*'([^']*)'"))[1];
const source = name => html.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'))[0];
const cases = [
  ['software engineer', {}], ['data analyst', {}], ['product manager', {}],
  ['marketing manager', {}], ['ux designer', {}], ['financial analyst', {}],
  ['engineer', {job_type:'Full-time'}], ['data analyst', {work_mode:'Remote'}],
  ['software engineer', {company:'Microsoft'}], ['engineer', {date_posted:'7'}],
];
const context = vm.createContext({fetch, AbortController, setTimeout, clearTimeout,
  SUPABASE_URL:value('SUPABASE_URL'), SUPABASE_KEY:value('SUPABASE_KEY'),
  SEARCH_REQUEST_TIMEOUT_MS:10000, QUICK_CANDIDATE_LIMIT:300,
  STOPWORDS:new Set(['a','an','and','the','of','for','to','in','on','at','with','or','jobs','job','role','roles','position','positions','senior','junior','sr','jr'])});
vm.runInContext(['readSearchRows','queryTokens','quickMatchUrl','scoreJob','fetchQuickMatches'].map(source).join('\n'),context);
const percentile = (values,p) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
async function run(i) {
  const [query,filters] = cases[i%cases.length];
  const start = performance.now();
  try { const jobs = await context.fetchQuickMatches(query,filters,new AbortController().signal);
    return {case:i%cases.length, ms:Math.round(performance.now()-start), jobs:jobs.length, ok:true};
  } catch(error) { return {case:i%cases.length, ms:Math.round(performance.now()-start), ok:false, error:error.message}; }
}
function summary(rows) {
  const successes=rows.filter(r=>r.ok), durations=successes.map(r=>r.ms);
  return {requests:rows.length, failures:rows.length-successes.length, empty:successes.filter(r=>!r.jobs).length,
    p50Ms:percentile(durations,.5),p95Ms:percentile(durations,.95),maxMs:Math.max(...durations)};
}
(async()=>{
  const sequential=[];
  for(let i=0;i<30;i++) sequential.push(await run(i));
  console.log('Sequential',summary(sequential));
  const burst=await Promise.all(Array.from({length:100},(_,i)=>run(i)));
  console.log('100 simultaneous database searches',summary(burst));
  const report={timestamp:new Date().toISOString(), scope:'Actual production database reads and client ranking from one machine; excludes browser rendering and live scraper concurrency.',cases,sequential:{summary:summary(sequential),samples:sequential},concurrent:{summary:summary(burst),samples:burst}};
  const output=path.resolve(process.argv[2]||path.join(__dirname,'../../quick-match-benchmark.json'));
  fs.writeFileSync(output,JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
