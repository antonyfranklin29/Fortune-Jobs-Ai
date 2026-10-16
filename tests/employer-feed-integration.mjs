// Integration of Codex worker/staging with Claude's ACTUAL pending SQL.
// An ephemeral in-memory PostgreSQL instance only; no real accounts or network.
import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createEmployerFeedHandler} from '../supabase/functions/employer-feed/handler.mjs';
import {normalizeEmployerJob} from '../supabase/functions/employer-feed/lib.mjs';
import {compileRoles,regionIndex} from '../supabase/functions/job-ingest/lib.mjs';
import {ROLES,REGIONS} from '../supabase/functions/job-ingest/config.mjs';
let db;
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
before(async()=>{
  db=await PGlite.create();
  for(const path of ['tests/sql/supabase-shim.sql','migrations/20261015_ingest_taxonomy.sql',
    'migrations/20261015_ingest_catalogue.sql','migrations/20261015_ingest_feed.sql',
    'migrations/pending/20261016_employer_feed_runs.sql','migrations/pending/20261016_employer_submissions.sql',
    'migrations/pending/20261017_employer_feed_registry_bridge.sql',
    'migrations/pending/20261017_employer_feed_publish_hardening.sql']){
    try{await db.exec(read(path));}catch(e){throw Error(`${path}: ${e.message}`);}
  }
});
after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('reset role; truncate public.employer_feed_staging,public.employer_feed_leases,public.employer_feed_runs,public.pre_scraped_jobs,public.employer_orgs,auth.users cascade;');});
const OWNER='11111111-1111-1111-1111-111111111111',OPERATOR='22222222-2222-2222-2222-222222222222';
const ORG='33333333-3333-3333-3333-333333333333',SOURCE='fixture-source';
async function seed(){
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'owner@synthetic-careers.com',now()),($2,'reviewer@synthetic-review.com',now())",[OWNER,OPERATOR]);
  await db.query('insert into public.employer_operators(user_id) values($1)',[OPERATOR]);
  await db.query("insert into public.employer_orgs(id,name,primary_domain,status,domain_verified_at,verified_by,verified_at,created_by) values($1,'Synthetic Employer','synthetic-careers.com','verified',now()-interval '1 hour',$2,now(),$3)",[ORG,OPERATOR,OWNER]);
  await db.query("insert into public.employer_org_members(org_id,user_id) values($1,$2)",[ORG,OWNER]);
  await db.query(`insert into public.employer_sources(id,org_id,adapter,api_region,board_token,employer_name,status,enabled,
    rights_basis,permission_ref,approved_by,approved_at,authorization_expires_at,allow_display,allow_refresh,
    allowed_apply_hosts,submitted_by) values($1,$2,'lever','global','synthetic','Synthetic Employer','approved',true,
    'employer_written_permission','fixture-private-reference',$3,now()-interval '1 hour',now()+interval '30 days',true,true,
    array['jobs.lever.co'],$4)`,[SOURCE,ORG,OPERATOR,OWNER]);
}
async function call(name,types,args){
  const values=args.map((v,i)=>types[i]==='jsonb'?JSON.stringify(v):v);
  return(await db.query(`select public.${name}(${types.map((t,i)=>`$${i+1}::${t}`).join(',')}) as result`,values)).rows[0].result;
}
const loadSource=id=>call('employer_source_for_worker',['text'],[id]);
const store={
  begin:(id,rev,s)=>call('employer_feed_run_begin',['text','bigint','jsonb'],[id,rev,s]),
  stage:(id,token,rev,rows,sum)=>call('employer_feed_stage_registered_run',['uuid','uuid','bigint','jsonb','jsonb'],[id,token,rev,rows,sum]),
  fail:(id,token,reason)=>call('employer_feed_run_fail',['uuid','uuid','text'],[id,token,reason]),
};
const jobs=n=>Array.from({length:n},(_,i)=>({id:`job-${i}`,text:'Data Analyst',country:'US',
  categories:{location:'Raleigh, NC'},applyUrl:`https://jobs.lever.co/synthetic/job-${i}/apply`}));
const request=()=>new Request('https://worker.example',{method:'POST',headers:{'x-ingest-secret':'fixture-secret'},
  body:JSON.stringify({source_id:SOURCE,dry_run:false})});
const handler=(n,patch={})=>createEmployerFeedHandler({secret:'fixture-secret',enabled:true,loadSource,store,
  roles:compileRoles(ROLES),idx:regionIndex(REGIONS),fetchPage:async()=>jobs(n),...patch});
async function selectJobs(ids){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
  await call('employer_select_feed_jobs',['text','text[]','boolean'],[SOURCE,ids,true]);
}
const publish=(ids,revision=1)=>call('employer_publish_feed_jobs',['text','integer','text[]'],[SOURCE,revision,ids]);

test('Claude permission/workflow/quota SQL scenarios pass alongside the feed-run migration',async()=>{
  const script=read('tests/sql/employer-submissions.sql').split(/\r?\n/).filter(line=>!/^\s*\\/.test(line)).join('\n');
  try{
    const results=await db.exec(script);
    assert.ok(results.some(result=>result.rows?.some(row=>String(row.result).startsWith('PASS: employer submissions'))));
  }catch(e){await db.exec('rollback');throw Error(`Employer SQL scenario: ${e.message}; ${e.where||''}`);}
});

test('real registry -> worker -> private candidates stays unpublished until selection',async()=>{
  await seed();const response=await handler(16)(request());const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.candidates_promoted,16);assert.equal(body.published,0);
  assert.equal((await db.query('select count(*)::int as n from public.pre_scraped_jobs')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from public.employer_feed_candidates where not selected')).rows[0].n,16);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
  await call('employer_select_feed_jobs',['text','text[]','boolean'],[SOURCE,jobs(16).map(j=>j.id),true]);
  const published=await call('employer_publish_feed_jobs',['text','integer','text[]'],[SOURCE,1,jobs(16).map(j=>j.id)]);
  assert.equal(published.published,15);assert.equal(published.blocked_quota,1);assert.equal(published.state,'upgrade_required');
  assert.equal((await db.query('select count(*)::int as n from public.pre_scraped_jobs where employer_org_id=$1 and closed_at is null',[ORG])).rows[0].n,15);
  const retry=await call('employer_publish_feed_jobs',['text','integer','text[]'],[SOURCE,1,jobs(16).map(j=>j.id)]);
  assert.equal(retry.published,0);assert.equal(retry.updated,15);
});

test('registered staging rejects revision changes at the database boundary',async()=>{
  await seed();const snapshot=await loadSource(SOURCE);const run=await store.begin(SOURCE,1,snapshot.source);
  await db.query('update public.employer_sources set revision=2 where id=$1',[SOURCE]);
  const result=await store.stage(run.run_id,run.lease_token,1,[],{source_id:SOURCE,source_revision:1,
    accepted:0,received:0,requests_used:1,rejected:{},enumeration_complete:true});
  assert.equal(result.reason,'source_changed');
  assert.equal((await db.query('select count(*)::int as n from public.employer_feed_candidates')).rows[0].n,0);
});

test('registry bridge and checkpoints are not callable/readable by ordinary visitors',async()=>{
  for(const role of ['anon','authenticated']){
    assert.equal((await db.query("select has_function_privilege($1,'public.employer_feed_stage_registered_run(uuid,uuid,bigint,jsonb,jsonb)','EXECUTE') as allowed",[role])).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege($1,'public.employer_source_for_worker(text)','EXECUTE') as allowed",[role])).rows[0].allowed,false);
    assert.equal((await db.query("select has_table_privilege($1,'public.employer_feed_candidate_checkpoints','SELECT') as allowed",[role])).rows[0].allowed,false);
  }
});

test('publication refuses a selected candidate from an old approved source revision',async()=>{
  await seed();await handler(1)(request());await selectJobs(['job-0']);
  await db.query('update public.employer_sources set revision=2 where id=$1',[SOURCE]);
  const result=await publish(['job-0'],2);
  assert.equal(result.published,0);assert.equal(result.skipped[0].reason,'stale_candidate_revision');
  assert.equal((await db.query('select count(*)::int as n from public.pre_scraped_jobs')).rows[0].n,0);
});

test('publication rejects stale candidates, another ATS tenant and contradictory role evidence',async()=>{
  await seed();await handler(1)(request());await selectJobs(['job-0']);
  await db.query("update public.employer_feed_candidates set staged_at=now()-interval '8 days'");
  assert.equal((await publish(['job-0'])).skipped[0].reason,'candidate_refresh_required');
  await db.query("update public.employer_feed_candidates set staged_at=now(),payload=jsonb_set(payload,'{apply_url}','\"https://jobs.lever.co/other-tenant/job-0/apply\"'::jsonb)");
  assert.equal((await publish(['job-0'])).skipped[0].reason,'apply_tenant_mismatch');
  await db.query("update public.employer_feed_candidates set payload=jsonb_set(jsonb_set(payload,'{apply_url}','\"https://jobs.lever.co/synthetic/job-0/apply\"'::jsonb),'{canonical_role}','\"software-engineer\"'::jsonb)");
  assert.equal((await publish(['job-0'])).skipped[0].reason,'invalid_listing_evidence');
});

test('feed refresh updates existing search metadata and application URL, with bounded validity',async()=>{
  await seed();await handler(1)(request());await selectJobs(['job-0']);await publish(['job-0']);
  await handler(1,{fetchPage:async()=>[{...jobs(1)[0],text:'Senior Data Analyst',
    applyUrl:'https://jobs.lever.co/synthetic/job-0/apply?channel=careers'}]})(request());
  const result=await publish(['job-0']);assert.equal(result.updated,1);assert.equal(result.published,0);
  const row=(await db.query('select *,expires_at<=now()+interval \'7 days\' as bounded from public.pre_scraped_jobs')).rows[0];
  assert.equal(row.job_title,'Senior Data Analyst');assert.match(row.search_text,/senior data analyst/);
  assert.match(row.apply_url,/channel=careers/);assert.equal(row.bounded,true);
});

test('reactivating an expired feed job cannot bypass the 15-active-job quota',async()=>{
  await seed();await handler(16)(request());await selectJobs(jobs(16).map(j=>j.id));
  assert.equal((await publish(jobs(15).map(j=>j.id))).published,15);
  await db.query("update public.pre_scraped_jobs set expires_at=now()-interval '1 minute' where source_listing_id=$1",[SOURCE+':job-0']);
  assert.equal((await publish(['job-15'])).published,1);
  const retry=await publish(['job-0']);assert.equal(retry.published,0);assert.equal(retry.blocked_quota,1);
  assert.equal((await db.query('select public.employer_active_count($1) as n',[ORG])).rows[0].n,15);
});

test('an older private batch cannot overwrite candidates from a newer collected batch',async()=>{
  await seed();const snapshot=await loadSource(SOURCE);const old=await store.begin(SOURCE,1,snapshot.source);
  const row=normalizeEmployerJob(jobs(1)[0],snapshot.source,{roles:compileRoles(ROLES),idx:regionIndex(REGIONS),now:new Date()}).row;
  const summary={source_id:SOURCE,source_revision:1,accepted:1,received:1,requests_used:1,rejected:{},enumeration_complete:true};
  await call('employer_feed_run_stage',['uuid','uuid','bigint','jsonb','jsonb'],[old.run_id,old.lease_token,1,[row],summary]);
  assert.equal((await handler(1)(request())).status,200);
  const result=await store.stage(old.run_id,old.lease_token,1,[row],summary);
  assert.equal(result.reason,'stale_batch');
});
