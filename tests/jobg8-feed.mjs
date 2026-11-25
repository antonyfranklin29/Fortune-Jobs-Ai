import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Unzip,UnzipInflate,zipSync,strToU8} from 'fflate';
import {SaxesParser} from 'saxes';
import {PGlite} from '@electric-sql/pglite';
import {readZip,normalize} from '../supabase/functions/jobg8-ingest/feed.mjs';
import {createIngestHandler} from '../supabase/functions/jobg8-ingest/handler.mjs';
import {createClickHandler} from '../supabase/functions/partner-click/handler.mjs';
import {cleanText} from '../supabase/functions/_shared/live-job-partner.mjs';
import {compileRoles,classifyRole} from '../supabase/functions/jobg8-ingest/core.mjs';
import {ROLES,REGIONS} from '../supabase/functions/jobg8-ingest/config.mjs';
const fixture=readFileSync('tests/fixtures/jobg8/five-jobs.xml','utf8');
const zip={Unzip,UnzipInflate,SaxesParser};
const roles=compileRoles(ROLES),stateIndex=new Map(REGIONS.regions.flatMap(r=>[[r.code,r.code],[r.name.toLowerCase(),r.code]]));
const context={stateIndex,classify:title=>classifyRole(title,roles),cleanText};
function archive(xml=fixture) {return zipSync({'jobs.xml':strToU8(xml)});}
function stream(bytes){let pos=0;return new ReadableStream({pull(c){if(pos===bytes.length){c.close();return;}const end=Math.min(pos+37,bytes.length);c.enqueue(bytes.slice(pos,end));pos=end;}});}
async function rows(xml=fixture){const out=[];await readZip(stream(archive(xml)),async batch=>out.push(...batch.map(r=>normalize(r,context))),zip);return out;}
const request=()=>new Request('https://fixture.test/ingest',{method:'POST',headers:{'x-ingest-secret':'fixture-secret'},body:'{}'});
async function database(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
create table saved_jobs(id int,job_key text,job_title text,company text,location text,salary text,apply_url text,match_reason text,match_score text);
create table ingest_regions(code text primary key);insert into ingest_regions values('GA'),('OH'),('NJ'),('TX'),('CA');
create table ingest_runs(id bigint generated always as identity primary key,source text not null,started_at timestamptz default clock_timestamp(),finished_at timestamptz,status text default 'running',requests_used int default 0,fetched int default 0,inserted int default 0,updated int default 0,closed int default 0,rejected jsonb default '{}',note text);
create table pre_scraped_jobs(id bigint generated always as identity primary key,source text,source_listing_id text,country text,job_title text,company text,location text,state_code text,canonical_role text,category text,salary text,apply_url text unique,job_description text,employment_type text,source_metadata jsonb,posted_at timestamptz,scraped_at timestamptz,fetched_at timestamptz,last_seen_at timestamptz,closed_at timestamptz,search_text text);
create unique index listing_uq on pre_scraped_jobs(source,source_listing_id) where source_listing_id is not null;`);
await db.exec(readFileSync('migrations/20261122_partner_clicks.sql','utf8'));
await db.exec(readFileSync('migrations/20261122_partner_search_limits.sql','utf8'));
await db.exec(readFileSync('migrations/pending/20261122_jobg8_feed.sql','utf8'));
const rpc=async(name,args)=>{const keys=Object.keys(args);const result=await db.query('select public.'+name+'('+keys.map((k,i)=>k+'=> $'+(i+1)).join(',')+') as result',keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));return result.rows[0].result;};return{db,rpc};}

test('five-job ZIP streams across arbitrary chunks; maps identity, exact signed links, states and nullable price fields',async()=>{
 const result=await rows();assert.equal(result.length,5);assert.equal(result[0].company,'Example Care Hospital');assert.equal(result[0].location,'Atlanta, GA');assert.equal(result[2].canonical_role,'software-engineer');assert.equal(result[0].jobg8_sell_price,0.2);
 assert.equal(result[0].apply_url,'https://click.example.test/apply/RN-GA?token=a%2fb+X&signature=One%20Two');assert.equal(result[0].salary,'$38 – $45 / hour');assert(!result[0].job_description.includes('alert'));assert(!result[0].job_description.includes('<'));assert.equal(result[0].source_metadata.SubClassification,'fixture-0');assert(!('FutureOptionalNode' in result[0].source_metadata));
 const optional=fixture.replace(/<SellPrice>.*?<\/SellPrice>/g,'').replace(/<SalaryMinimum>.*?<\/SalaryPeriod>/g,'');const empty=await rows(optional);assert.equal(empty[0].jobg8_sell_price,null);assert.equal(empty[0].salary,null);
});

test('rejects dangerous XML and truncation; skips invalid advertiser names and non-US rows',async()=>{
 await assert.rejects(rows(fixture.replace('<Jobs>','<!DOCTYPE Jobs [<!ENTITY steal SYSTEM "file:///etc/passwd">]><Jobs>')));
 assert.equal((await rows(fixture.replace('Example Care Hospital','Jobg8')))[0].skip,'invalid_identity');
 await assert.rejects(rows(fixture.replace('</Jobs>','')));
 await assert.rejects(readZip(stream(archive().slice(0,40)),async()=>{},zip));
 assert.equal((await rows(fixture.replace('United States','Canada')))[0].skip,'non_us_job');
 const long=fixture.replace(/<Description><!\[CDATA\[[\s\S]*?\]\]><\/Description>/,'<Description><![CDATA['+'A'.repeat(15000)+']]></Description>');assert.equal((await rows(long))[0].job_description.length,10000);
});

test('snapshot fixture: 5 inserted, then 1 inserted / 1 updated / 1 closed; first-seen date survives',async()=>{
 const{db,rpc}=await database();try{
 let xml=fixture,modified='Sun, 22 Nov 2026 12:00:00 GMT';const methods=[];
 const fetchImpl=async(url,options)=>{assert.equal(url,'https://feed.example.test/private-feed.zip');methods.push(options.method);return new Response(options.method==='HEAD'?null:archive(xml),{headers:{'last-modified':modified}});};
 const handler=createIngestHandler({getEnv:k=>({INGEST_SECRET:'fixture-secret',JOBG8_FEED_URL:'https://feed.example.test/private-feed.zip',JOBG8_MODE:'live'})[k],rpc,fetchImpl,zip,context});
 let response=await handler(request());const initial=await response.json();assert.equal(response.status,200);assert.equal(initial.inserted,5);assert.equal(initial.updated,0);assert.equal(initial.closed,0);
 const before=(await db.query("select posted_at from pre_scraped_jobs where source_listing_id='RN-GA'")).rows[0].posted_at;
 const unchanged=await(await handler(request())).json();assert.equal(unchanged.status,'unchanged');assert.deepEqual(methods,['HEAD','GET','HEAD']);
 xml=fixture.replace('Collaborate with colleagues.','Provide safe patient care.').replace(/<Job><SenderReference>CDL-OH[\s\S]*?<\/Job>/,'').replace('</Jobs>',fixture.match(/<Job><SenderReference>SE-NJ[\s\S]*?<\/Job>/)[0].replace('SE-NJ','NEW-NJ').replaceAll('/SE-NJ?','/NEW-NJ?').replace('Software Engineer','Senior Software Engineer')+'</Jobs>');
 modified='Sun, 22 Nov 2026 13:00:00 GMT';response=await handler(request());const next=await response.json();assert.equal(response.status,200);assert.equal(next.inserted,1);assert.equal(next.updated,1);assert.equal(next.closed,1); // one description was amended
 assert.equal(new Date((await db.query("select posted_at from pre_scraped_jobs where source_listing_id='RN-GA'")).rows[0].posted_at).getTime(),new Date(before).getTime());
 assert.equal((await db.query("select count(*)::int as n from pre_scraped_jobs where source='jobg8' and closed_at is null")).rows[0].n,5);
 modified='Sun, 22 Nov 2026 14:00:00 GMT';const limited=await handler(request());assert.equal(limited.status,429);assert.equal(methods.filter(m=>m==='GET').length,2);
 const modes=await db.query("select distinct mode from ingest_runs where source='jobg8'");assert.equal(modes.rows[0].mode,'live');
 console.log('Fixture initial: inserted=5 updated=0 closed=0; amended snapshot: inserted=1 updated=1 closed=1');
 }finally{await db.close()}
});

test('failed, incomplete and duplicate snapshots never close existing jobs; leases fence concurrent workers and visitors',async()=>{
 const{db,rpc}=await database();try{
 const first=await rpc('jobg8_start',{p_mode:'live'}),auth={p_run:first.run_id,p_token:first.token};
 assert.equal((await rpc('jobg8_start',{p_mode:'qa'})).status,'busy');
 await assert.rejects(rpc('jobg8_publish',{...auth,p_after:''}),/snapshot_incomplete/);
 const records=await rows();await rpc('jobg8_stage',{...auth,p_rows:records});await assert.rejects(rpc('jobg8_stage',{...auth,p_rows:records}),/duplicate key/);
 await rpc('jobg8_ready',auth);await rpc('jobg8_publish',{...auth,p_after:''});await rpc('jobg8_finish',{...auth,p_modified:'v1',p_ok:true});
 const bad=createIngestHandler({getEnv:k=>({INGEST_SECRET:'fixture-secret',JOBG8_FEED_URL:'https://feed.example.test/private-feed.zip'})[k],rpc,fetchImpl:async(_u,o)=>new Response(o.method==='HEAD'?null:archive(fixture.replace('</Jobs>','')),{headers:{'last-modified':'v2'}}),zip,context});
 assert.equal((await bad(request())).status,502);assert.equal((await db.query('select count(*)::int as n from pre_scraped_jobs where closed_at is null')).rows[0].n,5);
 await assert.rejects(rpc('jobg8_ready',auth),/lease_lost/);
 await db.exec('set role anon');await assert.rejects(rpc('jobg8_start',{p_mode:'qa'}),/permission denied/);await db.exec('reset role');
 }finally{await db.close()}
});

test('QA mode stores jobs hidden; bad rows are skipped and counted; mostly-bad feeds abort',async()=>{
 const{db,rpc}=await database();try{
 const one=fixture.match(/<Job><SenderReference>RN-GA[\s\S]*?<\/Job>/)[0];
 let xml=fixture.replace('</Jobs>',one.replace('Georgia','Ontario').replaceAll('RN-GA','BAD-1')+one+[1,2,3].map(i=>one.replaceAll('RN-GA','RN-X'+i)).join('')+'</Jobs>'),modified='v1';
 const fetchImpl=async(_u,o)=>new Response(o.method==='HEAD'?null:archive(xml),{headers:{'last-modified':modified}});
 const handler=createIngestHandler({getEnv:k=>({INGEST_SECRET:'fixture-secret',JOBG8_FEED_URL:'https://feed.example.test/private-feed.zip',JOBG8_MODE:'qa'})[k],rpc,fetchImpl,zip,context});
 const ok=await(await handler(request())).json();assert.equal(ok.status,'succeeded',JSON.stringify(ok));assert.equal(ok.inserted,8);
 assert.deepEqual(ok.skipped,{unknown_state:1,duplicate_reference:1});
 assert.equal((await db.query("select count(*)::int as n from pre_scraped_jobs where source='jobg8' and closed_at is null")).rows[0].n,0);
 assert.match((await db.query("select note from ingest_runs order by id desc limit 1")).rows[0].note,/unknown_state=1/);
 xml=fixture.replaceAll('United States','Canada');modified='v2';await db.exec("update jobg8_feed_state set gets='{}'");
 const bad=await handler(request());const body=await bad.json();assert.equal(bad.status,502);assert.equal(body.reason,'too_many_skipped');
 }finally{await db.close()}
});

test('auth and missing feed configuration make zero external requests; no application link is ever requested',async()=>{
 let called=0;const handler=createIngestHandler({getEnv:k=>k==='INGEST_SECRET'?'fixture-secret':null,rpc:async()=>{called++;},fetchImpl:async()=>{called++;},zip,context});
 assert.equal((await handler(new Request('https://fixture.test',{method:'POST'}))).status,401);assert.equal((await handler(request())).status,503);assert.equal(called,0);
});

test('Jobg8 click logger ignores bots and over-limit requests without storing visitor fields',async()=>{
 let admitted=0,logged=0;const handler=createClickHandler({admit:async()=>{admitted++;return admitted<=1},log:async()=>{logged++;}});
 const click=ua=>new Request('https://fixture.test/click',{method:'POST',headers:{origin:'https://fortunejobsai.com','user-agent':ua,'x-forwarded-for':'203.0.113.8'},body:JSON.stringify({p_partner:'jobg8'})});
 await handler(click('curl/8'));assert.equal(admitted,0);await handler(click('Mozilla/5.0'));await handler(click('Mozilla/5.0'));assert.equal(logged,1);
});

test('streaming batches stay at 500 or fewer and extra archive members are rejected',async()=>{
 const one=fixture.match(/<Job>[\s\S]*?<\/Job>/)[0];
 const xml='<Jobs>'+Array.from({length:1203},(_,i)=>one.replace('RN-GA','RN-'+i)).join('')+'</Jobs>';
 const sizes=[];assert.equal(await readZip(stream(archive(xml)),async batch=>sizes.push(batch.length),zip),1203);
 assert.deepEqual(sizes,[500,500,203]);
 const extra=zipSync({'jobs.xml':strToU8(fixture),'another.xml':strToU8(fixture)});
 await assert.rejects(readZip(stream(extra),async()=>{},zip),/invalid_archive/);
});

test('unpublished batches cannot finish and URL conflicts never steal other sources',async()=>{
 const {db,rpc}=await database();try{
  const run=await rpc('jobg8_start',{p_mode:'qa'}),auth={p_run:run.run_id,p_token:run.token},records=await rows();
  await db.query("insert into pre_scraped_jobs(source,source_listing_id,company,apply_url) values('adzuna','other','Untouched',$1)",[records[0].apply_url]);
  await rpc('jobg8_stage',{...auth,p_rows:records});await rpc('jobg8_ready',auth);
  await assert.rejects(rpc('jobg8_finish',{...auth,p_ok:true,p_modified:'v1'}),/unpublished_jobs/);
  const batch=await rpc('jobg8_publish',{...auth,p_after:''});assert.equal(batch.inserted,4);assert.equal(batch.conflicts,1);
  await rpc('jobg8_finish',{...auth,p_ok:true,p_modified:'v1'});
  assert.equal((await db.query("select company from pre_scraped_jobs where source='adzuna'")).rows[0].company,'Untouched');
 }finally{await db.close()}
});

test('generated role/state helpers exactly match the canonical ingest configuration',()=>{
 assert.deepEqual(ROLES,JSON.parse(readFileSync('config/job-roles.json','utf8')));
 assert.deepEqual(REGIONS,JSON.parse(readFileSync('config/us-regions.json','utf8')));
});
