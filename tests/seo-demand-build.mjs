import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,copyFile,readFile,writeFile,access,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname,resolve,sep,basename} from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
const source=fileURLToPath(new URL('../',import.meta.url));
test('full generator publishes every demand type, valid sitemap/llms links, then retires newly thin pages',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fortune-seo-test-'));
 try{
  for(const name of ['scripts/build-job-seo.mjs','scripts/seo-freshness.mjs','jobs/catalogue.mjs','jobs/geo.mjs','jobs/demand.mjs','jobs/levels.mjs','jobs/h1b.mjs','config/care-sectors.json','config/job-roles.json','config/us-regions.json','config/h1b-soc-roles.json','config.js','application-tracker.html','sitemap.xml','llms.txt','react/src/shared/applyUrl.js']){const dest=join(root,name);await mkdir(dirname(dest),{recursive:true});await copyFile(join(source,name),dest);}
  const jobs=Array.from({length:25},(_,i)=>({id:i+1,canonical_role:'data-analyst',job_title:i<6?'Junior Data Analyst':i===24?'Data Analyst Intern':'Data Analyst',company:'Example '+i+' Inc.',country:'us',location:'Austin, TX',state_code:'TX',is_remote:true,posted_at:'2020-01-01',apply_url:'https://whatjobs.test/'+i+'?sig=a%2fb+X',source:'whatjobs',salary:'$100,000/year',closed_at:null}));
  const stats=Array.from({length:6},(_,i)=>({employer_key:'example '+i+' inc',employer_name:'Example '+i+' Inc.',state_code:'TX',soc_code:'15-2051',role_id:'data-analyst',fiscal_year:2026,certified_lcas:1,median_wage_annual:100000,updated_at:'2026-11-24T00:00:00+00:00'}));
  const input=join(root,'fixture.json'),runner=join(root,'run.mjs');
  await writeFile(input,JSON.stringify({jobs,stats}));
  await writeFile(runner,`import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';const fixture=JSON.parse(await readFile(${JSON.stringify(input)},'utf8'));globalThis.fetch=async value=>{const url=new URL(value);if(url.pathname==='/rest/v1/h1b_data_state')return Response.json([{latest_full_fy:2026,current_fy:2027,updated_at:'2026-11-24T00:00:00+00:00'}]);if(url.pathname==='/rest/v1/h1b_employer_stats')return Response.json(fixture.stats);if(url.pathname!=='/rest/v1/pre_scraped_jobs')throw Error('Unexpected network request');return Response.json(url.searchParams.get('source')==='eq.employer_direct'?[]:fixture.jobs.filter(job=>job.closed_at==null));};process.argv[1]=${JSON.stringify(join(root,'scripts/build-job-seo.mjs'))};await import(pathToFileURL(process.argv[1]));`);
  const run=()=>execFileSync(process.execPath,[runner],{stdio:'pipe'});run();
  const manifest=JSON.parse(await readFile(join(root,'jobs/demand-pages.json'),'utf8'));assert.equal(manifest.paths.length,12);
  for(const path of manifest.paths){const html=await readFile(join(root,path,'index.html'),'utf8');assert(html.includes('FAQPage'));assert(!html.includes('JobPosting'));}
  const h1b=await readFile(join(root,'h1b/index.html'),'utf8');assert(h1b.includes('6 employers'));assert(!h1b.includes('(0)'));
  const entry=await readFile(join(root,'jobs/entry-level/index.html'),'utf8');assert(entry.includes('6 jobs + 1 internship'));assert(entry.includes('Browse roles and locations'));
  const llms=await readFile(join(root,'llms.txt'),'utf8');for(const path of ['/jobs/remote/','/jobs/entry-level/','/salaries/','/h1b/'])assert(llms.includes('https://fortunejobsai.com'+path));
  const sitemap=await readFile(join(root,'sitemap.xml'),'utf8');for(const path of manifest.paths)assert(sitemap.includes('<loc>https://fortunejobsai.com'+path+'</loc><lastmod>'));
  await writeFile(input,JSON.stringify({jobs:jobs.slice(0,4),stats:stats.slice(0,4)}));run();
  assert.equal(JSON.parse(await readFile(join(root,'jobs/demand-pages.json'),'utf8')).paths.length,0);
  for(const path of ['/jobs/remote/','/jobs/entry-level/','/salaries/','/h1b/'])await assert.rejects(access(join(root,path,'index.html')));
  const thin=await readFile(join(root,'jobs/data-analyst/austin-tx/index.html'),'utf8');assert(thin.includes('noindex,follow'));
  const after=await readFile(join(root,'sitemap.xml'),'utf8');assert(!after.includes('/jobs/entry-level/'));assert(!after.includes('/h1b/'));
 }finally{
  // Windows-safe cleanup: only the freshly allocated task-specific temp directory.
  assert(resolve(root).startsWith(resolve(tmpdir())+sep) && basename(root).startsWith('fortune-seo-test-'));
  await rm(root,{recursive:true,force:true});
 }
});
