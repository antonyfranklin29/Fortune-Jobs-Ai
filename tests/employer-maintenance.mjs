import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createEmployerRefreshHandler} from '../supabase/functions/employer-refresh/handler.mjs';
import {checkMaintenance} from '../scripts/employer-maintenance-health.mjs';
const {files}=createRequire(import.meta.url)('../scripts/build-employer-backend.cjs');
const {buildUpgrade,buildSchedule}=createRequire(import.meta.url)('../scripts/build-employer-maintenance.cjs');
let db;
before(async()=>{db=await PGlite.create();for(const p of ['tests/sql/supabase-shim.sql','migrations/20261015_ingest_taxonomy.sql',
  'migrations/20261015_ingest_catalogue.sql','migrations/20261015_ingest_feed.sql',...files.map(n=>'migrations/pending/'+n)])
    await db.exec(readFileSync(new URL('../'+p,import.meta.url),'utf8'));});
after(async()=>{await db.close();});
beforeEach(async()=>{await db.exec(`reset role;truncate employer_feed_runs,employer_feed_leases,employer_orgs,auth.users,pre_scraped_jobs cascade;
  update employer_maintenance_control set cleanup_enabled=false,last_checked_at=null,last_cleanup_at=null,last_status=null,last_report=null,last_failure_at=null,installed_at=clock_timestamp();
  update employer_refresh_control set enabled=false,active_ticket=null,lease_until=null;`);});
const rpc=async(fn,args=[]) => (await db.query(`select ${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
async function run(age=8,{source='synthetic',status='staged',payloads=1}={}){
  const id=randomUUID();await db.query(`insert into employer_feed_runs(id,source_id,source_revision,source_snapshot,status,started_at,lease_expires_at,finished_at,accepted)
    values($1,$2,1,'{"permission_ref":"fixture-private"}',$3,now()-make_interval(days=>$4::int),now()-make_interval(days=>$4::int),now()-make_interval(days=>$4::int),$5)`,[id,source,status,age,payloads]);
  for(let i=0;i<payloads;i++)await db.query("insert into employer_feed_staging(run_id,source_listing_id,payload) values($1,$2,'{\"job_title\":\"Synthetic Analyst\"}')",[id,source+':job-'+i]);
  return id;
}
const snapshot=async()=> (await db.query(`select jsonb_build_object('runs',(select jsonb_agg(to_jsonb(r) order by id) from employer_feed_runs r),
  'payloads',(select jsonb_agg(to_jsonb(s) order by run_id,source_listing_id) from employer_feed_staging s),
  'jobs',(select jsonb_agg(to_jsonb(j) order by id) from pre_scraped_jobs j)) state`)).rows[0].state;
test('default preview reports eligibility without purging; actual cleanup and legacy alias are blocked',async()=>{
  await run(8);await run(31);await db.exec("insert into pre_scraped_jobs(category,job_title,apply_url) values('Data Analyst','Existing Job','https://synthetic.com/job')");
  const before=await snapshot();const report=await rpc('employer_maintenance_run',[false,25]);
  assert.equal(report.status,'dry_run');assert.equal(report.payloads_eligible,2);assert.equal(report.runs_eligible,1);assert.equal(report.payloads_removed,0);
  assert.deepEqual(await snapshot(),before);
  assert.equal((await rpc('employer_maintenance_run',[true,25])).reason,'cleanup_not_approved');
  assert.equal((await rpc('employer_feed_run_prune')).reason,'cleanup_not_approved');assert.deepEqual(await snapshot(),before);
  const health=await rpc('employer_maintenance_health');assert.equal(health.last_status,'dry_run');assert.equal(health.last_cleanup_at,null);assert.equal(health.attention_required,false);
  assert(!JSON.stringify(report).includes('fixture-private'));
});
test('approved synthetic cleanup retains recent and collecting runs, clears 7-day snapshots, removes 30-day summaries',async()=>{
  const eight=await run(8),old=await run(31),recent=await run(6),collecting=await run(31,{status:'collecting'});
  await db.exec('update employer_maintenance_control set cleanup_enabled=true');const report=await rpc('employer_maintenance_run',[true,25]);
  assert.equal(report.status,'cleaned');assert.equal(report.payloads_removed,2);assert.equal(report.snapshots_cleared,2);assert.equal(report.runs_removed,1);
  assert.equal((await db.query('select count(*)::int n from employer_feed_runs where id=$1',[old])).rows[0].n,0);
  assert.deepEqual((await db.query('select source_snapshot from employer_feed_runs where id=$1',[eight])).rows[0].source_snapshot,{});
  for(const id of [recent,collecting])assert.equal((await db.query('select count(*)::int n from employer_feed_staging where run_id=$1',[id])).rows[0].n,1);
  assert.equal((await rpc('employer_maintenance_run',[true,25])).runs_removed,0);
});
test('one invocation respects run and total payload budgets without cascade bypass',async()=>{
  for(let i=0;i<4;i++)await run(31,{source:'synthetic'+i,payloads:500});
  await db.exec('update employer_maintenance_control set cleanup_enabled=true');const result=await rpc('employer_maintenance_run',[true,3]);
  assert.equal(result.payloads_removed,1000);assert.equal(result.runs_removed,2);assert.equal(result.snapshots_cleared,3);
  assert.equal((await db.query('select count(*)::int n from employer_feed_staging')).rows[0].n,1000);
  assert.equal((await db.query('select count(*)::int n from employer_feed_runs')).rows[0].n,2);
});
test('a source with a live collection lease is protected, even when another old run is eligible',async()=>{
  const id=await run(31);await db.query("insert into employer_feed_leases(source_id,run_id,token,expires_at) values('synthetic',$1,$2,now()+interval '1 hour')",[id,randomUUID()]);
  await db.exec('update employer_maintenance_control set cleanup_enabled=true');assert.equal((await rpc('employer_maintenance_plan',[25])).payloads_eligible,0);
  assert.equal((await rpc('employer_maintenance_run',[true,25])).runs_removed,0);
});
test('an admitted refresh prevents actual cleanup, while preview remains available',async()=>{
  await run(31);await db.exec('update employer_maintenance_control set cleanup_enabled=true');
  await db.query('update employer_refresh_control set active_ticket=$1,lease_until=now()+interval \'1 hour\'',[randomUUID()]);
  assert.equal((await rpc('employer_maintenance_run',[true,25])).reason,'refresh_in_progress');
  assert.equal((await rpc('employer_maintenance_run',[false,25])).status,'dry_run');
});
test('the latest registered batch remains protected even when it is old enough for cleanup',async()=>{
  const owner=randomUUID(),org=randomUUID(),id=await run(31);
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'owner@synthetic.com',now())",[owner]);
  await db.query("insert into employer_orgs(id,name,primary_domain,created_by) values($1,'Synthetic Company','synthetic.com',$2)",[org,owner]);
  await db.query("insert into employer_sources(id,org_id,adapter,board_token,employer_name,submitted_by) values('synthetic',$1,'lever','synthetic','Synthetic Company',$2)",[org,owner]);
  await db.query("insert into employer_feed_candidate_checkpoints(source_id,last_run_id,last_started_at) values('synthetic',$1,now()-interval '31 days')",[id]);
  await db.exec('update employer_maintenance_control set cleanup_enabled=true');const before=await snapshot();
  const report=await rpc('employer_maintenance_run',[true,25]);assert.equal(report.protected_current_runs,1);assert.equal(report.payloads_removed,0);
  assert.deepEqual(await snapshot(),before);assert.equal((await rpc('employer_maintenance_health')).attention_required,true);
});
test('a cleanup failure rolls back every removal and records a sanitised failure',async()=>{
  await run(31);await db.exec(`update employer_maintenance_control set cleanup_enabled=true;
    create function fixture_maintenance_fail() returns trigger language plpgsql as $$begin raise exception 'fixture private error';end$$;
    create trigger fixture_maintenance_fail before delete on employer_feed_runs for each row execute function fixture_maintenance_fail();`);
  const before=await snapshot();
  try{const report=await rpc('employer_maintenance_run',[true,25]);assert.equal(report.status,'failed');assert.deepEqual(await snapshot(),before);
    assert(!JSON.stringify(report).includes('private error'));assert.equal((await rpc('employer_maintenance_health')).attention_required,true);
  }finally{await db.exec('drop trigger fixture_maintenance_fail on employer_feed_runs;drop function fixture_maintenance_fail()');}
});
test('maintenance health distinguishes successful dry runs, missing checks and stale collecting runs',async()=>{
  assert.equal((await rpc('employer_maintenance_health')).attention_required,false);
  await db.exec("update employer_maintenance_control set installed_at=now()-interval '2 days'");
  assert.equal((await rpc('employer_maintenance_health')).overdue,true);
  await rpc('employer_maintenance_run',[false,25]);assert.equal((await rpc('employer_maintenance_health')).overdue,false);
  await run(2,{status:'collecting'});assert.equal((await rpc('employer_maintenance_health')).attention_required,true);
});
test('ordinary roles cannot execute private maintenance or inspect its control; internal helper is not an RPC',async()=>{
  for(const role of ['anon','authenticated']){
    for(const fn of ['employer_maintenance_plan(integer)','employer_maintenance_run(boolean,integer)','employer_maintenance_health()'])
      assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed,false);
    assert.equal((await db.query("select has_table_privilege($1,'employer_maintenance_control','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed",[role])).rows[0].allowed,false);
  }
  assert.equal((await db.query("select has_function_privilege('service_role','employer_maintenance_candidates(timestamptz,integer)','EXECUTE') allowed")).rows[0].allowed,false);
  for(const limit of [null,0,51])await assert.rejects(rpc('employer_maintenance_plan',[limit]),/invalid_limit/);
});
test('HTTP maintenance preview cannot accept apply, source or retention overrides',async()=>{
  const calls=[];const handler=createEmployerRefreshHandler({secret:'fixture',maintenancePreview:async()=>{calls.push('preview');return{status:'dry_run'};},maintenanceHealth:async()=>({overdue:false})});
  const request=body=>new Request('https://worker.example',{method:'POST',headers:{'x-ingest-secret':'fixture'},body:JSON.stringify(body)});
  for(const body of [{action:'maintenance_preview',apply:true},{action:'maintenance_preview',source_id:'synthetic'},{action:'maintenance_preview',days:0},{action:'maintenance_apply'}])
    assert.equal((await handler(request(body))).status,400);
  assert.equal((await handler(request({action:'maintenance_preview'}))).status,200);assert.deepEqual(calls,['preview']);
});

test('incremental maintenance installation preserves data and existing grants and refuses a repeated install',async()=>{
  const isolated=await PGlite.create();
  try{
    for(const p of ['tests/sql/supabase-shim.sql','migrations/20261015_ingest_taxonomy.sql','migrations/20261015_ingest_catalogue.sql','migrations/20261015_ingest_feed.sql',
      ...files.filter(f=>f!=='20261025_employer_maintenance.sql').map(f=>'migrations/pending/'+f)])await isolated.exec(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
    await isolated.exec("insert into pre_scraped_jobs(category,job_title,apply_url) values('Data Analyst','Existing Job','https://synthetic.com/kept')");
    const before=(await isolated.query('select to_jsonb(j) row from pre_scraped_jobs j')).rows;
    await isolated.exec(buildUpgrade());assert.deepEqual((await isolated.query('select to_jsonb(j) row from pre_scraped_jobs j')).rows,before);
    assert.equal((await isolated.query('select cleanup_enabled from employer_maintenance_control')).rows[0].cleanup_enabled,false);
    await assert.rejects(isolated.exec(buildUpgrade()),/maintenance already installed/);await isolated.exec('rollback');
  }finally{await isolated.close();}
});

test('schedule installation is idempotent, always dry-run, preserves unrelated jobs and detects a name conflict',async()=>{
  // A local metadata fixture only; no scheduler or background process runs here.
  await db.exec(`create schema cron;
    create table cron.job(jobid bigint generated always as identity primary key,jobname text,command text,schedule text,database text,username text,active boolean default true,unique(jobname,username));
    create table cron.job_run_details(runid bigint generated always as identity primary key,jobid bigint,status text,end_time timestamptz);
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command,database,username) values($1,$2,$3,current_database(),current_user)
        on conflict(jobname,username) do update set schedule=excluded.schedule,command=excluded.command,active=true returning jobid;$$;
    insert into cron.job(jobname,command,schedule,database,username) values('unrelated_fixture','select 1','0 0 * * *',current_database(),current_user);`);
  try{
    await db.exec(buildSchedule());await db.exec(buildSchedule());
    const jobs=(await db.query('select jobname,command from cron.job order by jobname')).rows;
    assert.equal(jobs.length,2);assert.equal(jobs.find(j=>j.jobname==='unrelated_fixture').command,'select 1');
    assert.equal(jobs.find(j=>j.jobname!=='unrelated_fixture').command,'select public.employer_maintenance_run(false,25);');
    assert.equal((await rpc('employer_maintenance_health')).schedule_active,true);
    await db.exec("insert into cron.job_run_details(jobid,status,end_time) select jobid,'failed',now() from cron.job where jobname<>'unrelated_fixture'");
    assert.equal((await rpc('employer_maintenance_health')).attention_required,true);
    assert.equal((await db.query("select has_schema_privilege('anon','cron','USAGE') allowed")).rows[0].allowed,false);
    // Managed extension owners may retain PUBLIC EXECUTE. With no schema USAGE,
    // ordinary users still cannot invoke the scheduler or read its tables.
    await db.exec('grant execute on function cron.schedule(text,text,text) to public');
    assert.equal((await db.query("select has_function_privilege('anon','cron.schedule(text,text,text)','EXECUTE') allowed")).rows[0].allowed,true);
    for(const role of ['anon','authenticated']){
      await db.exec('set role '+role);
      try{
        await assert.rejects(db.query("select cron.schedule('forged_fixture','* * * * *','select 1')"),/permission denied for schema cron/);
        await assert.rejects(db.query('select * from cron.job limit 0'),/permission denied for schema cron/);
      }finally{await db.exec('reset role');}
    }
    await db.exec("update cron.job set command='select 42' where jobname<>'unrelated_fixture'");
    await assert.rejects(db.exec(buildSchedule()),/maintenance schedule conflict/);await db.exec('rollback');
    assert.equal((await db.query("select command from cron.job where jobname<>'unrelated_fixture'")).rows[0].command,'select 42');
  }finally{await db.exec('drop schema cron cascade');}
});

test('maintenance monitor fails closed on missing, overdue, inactive or failed health reports',async()=>{
  for(const patch of [{},{overdue:true},{attention_required:true},{schedule_active:false}]){
    const health={attention_required:false,overdue:false,schedule_active:true,...patch};
    const report=await checkMaintenance({url:'https://fixture.supabase.test/functions/v1/employer-refresh',secret:'fixture',publishableKey:'public-fixture',
      fetchImpl:async(url,init)=>{assert.deepEqual(JSON.parse(init.body),{action:'maintenance_health'});assert.equal(init.redirect,'error');return Response.json(health);}});
    assert.equal(report.status,Object.keys(patch).length?'attention_required':'healthy');
  }
  await assert.rejects(checkMaintenance({url:'https://fixture.supabase.test',secret:'fixture',publishableKey:'public-fixture',fetchImpl:async()=>Response.json({})}),/invalid_maintenance_health/);
});
