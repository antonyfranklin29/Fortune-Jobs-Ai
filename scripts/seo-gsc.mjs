import {readFile,mkdir,writeFile} from 'node:fs/promises';import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {googleClient,collect} from './seo/gsc.mjs';import {weeklyReport} from './seo/weekly.mjs';
export function databaseClient(url,key,fetchImpl=fetch){
 const u=new URL(url);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('Invalid Supabase endpoint');
 return async(path,{method='GET',body,upsert=false}={})=>{const r=await fetchImpl(u.origin+'/rest/v1/'+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:upsert?'resolution=merge-duplicates,return=minimal':'return=representation'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Object.assign(Error('SEO data request failed (HTTP '+r.status+'); check approved migration and permissions.'),{status:r.status});
  const raw=await r.text();return raw?JSON.parse(raw):null;
 };
}
async function readAll(db,table,query=''){
 const rows=[];for(let offset=0;offset<100000;offset+=1000){const batch=await db(table+'?'+query+(query?'&':'')+'limit=1000&offset='+offset);if(!Array.isArray(batch))throw Error('Invalid SEO data response');rows.push(...batch);if(batch.length<1000)return rows;}throw Error('SEO report row bound exceeded');
}
export async function run({env=process.env,mode='daily',root=process.cwd(),fetchImpl=fetch,now=new Date()}={}){
 const output=resolve(root,'docs/ops/seo-weekly.md');await mkdir(dirname(output),{recursive:true});
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||(mode==='daily'&&!env.GSC_SERVICE_ACCOUNT_JSON)){
  await writeFile(output,'# Weekly SEO actions\n\nSetup pending: approved migration and collector credentials are required. No external requests made; no performance numbers or index status inferred.\n');return {status:'skipped',reason:'setup_pending'};
 }
 const db=databaseClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,fetchImpl);let summary={};
 if(mode==='daily'){
  let account;try{account=JSON.parse(env.GSC_SERVICE_ACCOUNT_JSON);}catch{throw Error('GSC service-account secret is not valid JSON');}
  const google=await googleClient(account,{fetchImpl,now:now.getTime()});const xml=await readFile(resolve(root,'sitemap.xml'),'utf8');
  const urls=[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1].replaceAll('&amp;','&'));
  summary=await collect({google,db,urls,now});
 }else if(mode!=='weekly')throw Error('Use daily or weekly mode');
 const since=new Date(now.getTime()-30*86400000).toISOString().slice(0,10);
 const rows=await readAll(db,'seo_gsc_daily','date=gte.'+since+'&order=date.asc,query.asc,page.asc');
 const status=await readAll(db,'seo_index_status','order=url.asc');const runs=await readAll(db,'seo_gsc_runs','date=gte.'+since+'&order=date.asc');
 await writeFile(output,weeklyReport(rows,status,runs,now));return {status:summary.failed?'partial':'completed',...summary};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=await run({mode:process.argv.includes('--weekly')?'weekly':'daily'});console.log(JSON.stringify(result));if(result.status==='partial')process.exitCode=1;}
 catch(error){console.error(error.message);process.exitCode=1;}
}
