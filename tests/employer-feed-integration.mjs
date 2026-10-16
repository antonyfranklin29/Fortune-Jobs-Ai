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
import {createRequire} from 'node:module';
const {build:buildEmployerBackend}=createRequire(import.meta.url)('../scripts/build-employer-backend.cjs');
let db;
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
before(async()=>{
  db=await PGlite.create();
  for(const path of ['tests/sql/supabase-shim.sql','migrations/20261015_ingest_taxonomy.sql',
    'migrations/20261015_ingest_catalogue.sql','migrations/20261015_ingest_feed.sql',
    'migrations/pending/20261016_employer_feed_runs.sql','migrations/pending/20261016_employer_submissions.sql',
    'migrations/pending/20261017_employer_feed_registry_bridge.sql',
    'migrations/pending/20261017_employer_feed_publish_hardening.sql',
    'migrations/pending/20261017_employer_domain_checks.sql',
    'migrations/pending/20261017_employer_account_deletion.sql',
    'migrations/pending/20261017_employer_search_visibility.sql',
    'migrations/pending/20261018_employer_access_hardening.sql',
    'migrations/pending/20261019_employer_pending_account_cleanup.sql']){
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

test('DNS reservations check membership, consume the minute atomically and invalidate stale attempts',async()=>{
  await seed();await db.query('update public.employer_orgs set domain_verified_at=null where id=$1',[ORG]);
  await db.query('insert into public.employer_domain_challenges(org_id) values($1)',[ORG]);
  const unclaimed=(await db.query('select token from public.employer_domain_challenges where org_id=$1',[ORG])).rows[0].token;
  assert.equal((await call('employer_domain_check_finish',['uuid','uuid','uuid','text','boolean'],[ORG,OWNER,null,unclaimed,true])).state,'invalidated');
  const begin=user=>call('employer_domain_check_begin',['uuid','uuid'],[ORG,user]);
  assert.equal((await begin(OPERATOR)).state,'not_found');
  const first=await begin(OWNER);assert.equal(first.state,'lookup');
  assert.equal((await begin(OWNER)).state,'rate_limited');
  const finish=(attempt,token,matched)=>call('employer_domain_check_finish',['uuid','uuid','uuid','text','boolean'],[ORG,OWNER,attempt,token,matched]);
  assert.equal((await finish(first.attempt_id,'b'.repeat(32),true)).state,'invalidated');
  assert.equal((await finish(first.attempt_id,first.token,false)).verified,false);
  assert.equal((await finish(first.attempt_id,first.token,true)).state,'invalidated','completed attempts cannot be replayed');
  await db.query("update public.employer_domain_challenges set checked_at=now()-interval '2 minutes'");
  const next=await begin(OWNER);assert.notEqual(next.attempt_id,first.attempt_id);
  assert.equal((await finish(first.attempt_id,first.token,true)).state,'invalidated');
  assert.equal((await finish(next.attempt_id,next.token,true)).verified,true);
  await db.query("update public.employer_orgs set status='suspended' where id=$1",[ORG]);
  assert.equal((await begin(OWNER)).state,'inactive');
  assert.equal(await call('employer_mark_domain_verified',['uuid','text'],[ORG,next.token]),false);
});

test('DNS checks and account-deletion triggers have no anonymous inherited EXECUTE',async()=>{
  const signatures=['employer_domain_check_begin(uuid,uuid)','employer_domain_check_finish(uuid,uuid,uuid,text,boolean)','employer_before_account_deleted()'];
  for(const signature of signatures)for(const role of ['anon','authenticated']){
    assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed',[role,'public.'+signature])).rows[0].allowed,false);
  }
});

test('account deletion unlinks employer references, suspends a last-owner org and hides its jobs',async()=>{
  await seed();await handler(1)(request());await selectJobs(['job-0']);await publish(['job-0']);
  await db.query("insert into public.employer_source_evidence(source_id,kind,attested_by) values($1,'employer_attestation',$2)",[SOURCE,OWNER]);
  await db.query("select public.employer_audit_log($1::uuid,'employer',$2::uuid,'org',($2::uuid)::text,'fixture')",[OWNER,ORG]);
  await call('employer_save_post',['uuid','uuid','jsonb'],[ORG,null,{
    job_title:'Data Analyst',canonical_role:'data-analyst',state_code:'NJ',city:'Edison',
    description:'Build dashboards and reports for operations. '.repeat(3),apply_url:'https://synthetic-careers.com/direct-job',
    posting_date:new Date().toISOString().slice(0,10),closing_date:new Date(Date.now()+86400000*20).toISOString().slice(0,10),
  }]);
  await db.query('update public.employer_posts set reviewed_by=$1',[OPERATOR]);
  await db.query('delete from auth.users where id=$1',[OWNER]);
  const org=(await db.query('select status,created_by from public.employer_orgs where id=$1',[ORG])).rows[0];
  assert.equal(org.status,'suspended');assert.equal(org.created_by,null);
  assert.equal((await db.query('select submitted_by from public.employer_sources')).rows[0].submitted_by,null);
  assert.equal((await db.query('select selected_by from public.employer_feed_candidates')).rows[0].selected_by,null);
  assert.equal((await db.query('select attested_by from public.employer_source_evidence')).rows[0].attested_by,null);
  assert.equal((await db.query('select created_by from public.employer_posts')).rows[0].created_by,null);
  assert.equal((await db.query('select count(*)::int n from public.employer_audit where actor=$1',[OWNER])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from public.pre_scraped_jobs')).rows[0].n,1,'retain operational history');
  await db.exec('set role anon');
  assert.equal((await db.query('select count(*)::int n from public.pre_scraped_jobs')).rows[0].n,0,'RLS immediately hides orphaned organization');
  await db.exec('reset role');
});

test('another active owner keeps a shared company live; an ordinary member does not inherit ownership',async()=>{
  await seed();const other='44444444-4444-4444-4444-444444444444';
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'coowner@synthetic-careers.com',now())",[other]);
  await db.query('insert into public.employer_org_members(org_id,user_id,role) values($1,$2,\'owner\')',[ORG,other]);
  await db.query('delete from auth.users where id=$1',[OWNER]);
  assert.equal((await db.query('select status from public.employer_orgs')).rows[0].status,'verified');
  await db.query("insert into public.employer_org_members(org_id,user_id,role) values($1,$2,'member')",[ORG,OPERATOR]);
  await db.query('delete from auth.users where id=$1',[other]);
  assert.equal((await db.query('select status from public.employer_orgs')).rows[0].status,'suspended');
  assert.equal((await db.query('select role from public.employer_org_members')).rows[0].role,'member');
});

test('deleting a reviewer unlinks approval safely and requires a new independent review',async()=>{
  await seed();await db.query('delete from auth.users where id=$1',[OPERATOR]);
  const source=(await db.query('select status,enabled,approved_by,revision from public.employer_sources')).rows[0];
  assert.deepEqual(source,{status:'pending',enabled:false,approved_by:null,revision:2});
  assert.equal(await loadSource(SOURCE),null);
  assert.equal((await db.query('select status,verified_by from public.employer_orgs')).rows[0].status,'verified');
});

test('batched visibility exposes only existing public listing keys, with immediate revocation',async()=>{
  await seed();
  const publicView=async()=>{
    await db.exec('set role anon');
    try{return {keys:(await db.query('select public.employer_public_listing_keys() k')).rows.map(r=>r.k).sort(),
      titles:(await db.query('select job_title from pre_scraped_jobs order by job_title')).rows.map(r=>r.job_title)};}
    finally{await db.exec('reset role');}
  };
  assert.deepEqual((await publicView()).keys,[],'an approved registry-only source is still private');
  await handler(1)(request());await selectJobs(['job-0']);await publish(['job-0']);
  await db.query("insert into pre_scraped_jobs(category,job_title,apply_url,employer_org_id,expires_at) values('Data Analyst','Direct job','https://synthetic-careers.com/direct',$1,now()+interval '1 day')",[ORG]);
  await db.query("insert into pre_scraped_jobs(category,job_title,apply_url,employer_org_id,employer_source_id,expires_at) values('Data Analyst','Expired job','https://synthetic-careers.com/expired',$1,$2,now()-interval '1 day')",[ORG,SOURCE]);
  assert.deepEqual(await publicView(),{keys:[ORG+':',ORG+':'+SOURCE],titles:['Data Analyst','Direct job']});
  await db.query('update employer_sources set allow_display=false where id=$1',[SOURCE]);
  assert.deepEqual(await publicView(),{keys:[ORG+':'],titles:['Direct job']});
  await db.query("update employer_orgs set status='suspended' where id=$1",[ORG]);
  assert.deepEqual(await publicView(),{keys:[],titles:[]});
});

test('batched RLS never accepts a source belonging to a different organization',async()=>{
  await seed();const other='55555555-5555-5555-5555-555555555555';
  await db.query("insert into employer_orgs(id,name,primary_domain,status,created_by) values($1,'Other Synthetic','other-synthetic.com','verified',$2)",[other,OWNER]);
  await db.query("insert into pre_scraped_jobs(category,job_title,apply_url,employer_org_id,employer_source_id) values('Data Analyst','Cross-org fixture','https://synthetic-careers.com/mismatch',$1,$2)",[other,SOURCE]);
  await db.exec('set role anon');
  try{assert.equal((await db.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n,0);
    assert.equal((await db.query('select public.employer_public_listing_keys() k')).rows.length,0);}
  finally{await db.exec('reset role');}
});

test('deleting a pending duplicate claimant never reserves or blocks the verified company domain',async()=>{
  await seed();const pendingUser='66666666-6666-6666-6666-666666666666',pendingOrg='77777777-7777-7777-7777-777777777777';
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'pending@synthetic-test.com',now())",[pendingUser]);
  await db.query("insert into employer_orgs(id,name,primary_domain,status,created_by) values($1,'Pending claimant','synthetic-careers.com','pending',$2)",[pendingOrg,pendingUser]);
  await db.query("insert into employer_org_members(org_id,user_id,role) values($1,$2,'owner')",[pendingOrg,pendingUser]);
  await db.query('delete from auth.users where id=$1',[pendingUser]);
  assert.equal((await db.query('select status from employer_orgs where id=$1',[pendingOrg])).rows[0].status,'rejected');
  assert.equal((await db.query('select status from employer_orgs where id=$1',[ORG])).rows[0].status,'verified');
});

test('Claude adversarial access SQL passes on the combined migration chain',async()=>{
  const script=read('tests/sql/employer-access.sql').split(/\r?\n/).filter(line=>!/^\s*\\/.test(line)).join('\n');
  try{const results=await db.exec(script);assert.ok(results.some(result=>result.rows?.some(row=>Object.values(row).some(value=>String(value).startsWith('PASS: employer access review')))));}
  catch(e){await db.exec('rollback');throw Error(`Access SQL scenario: ${e.message}; ${e.where||''}`);}
});

test('first-install deployment bundle is atomic, keeps legacy data and leaves billing/reviewers off',async()=>{
  const isolated=await PGlite.create();
  try{
    for(const file of ['tests/sql/supabase-shim.sql','migrations/20261015_ingest_taxonomy.sql','migrations/20261015_ingest_catalogue.sql','migrations/20261015_ingest_feed.sql'])await isolated.exec(read(file));
    await isolated.exec("insert into auth.users(email,email_confirmed_at) values('legacy@synthetic.com',now());insert into pre_scraped_jobs(category,job_title,apply_url) values('Data Analyst','Existing job','https://synthetic.com/legacy');");
    await isolated.exec(buildEmployerBackend());
    assert.equal((await isolated.query('select count(*)::int n from auth.users')).rows[0].n,1);
    assert.equal((await isolated.query('select count(*)::int n from employer_operators')).rows[0].n,0);
    assert.equal((await isolated.query('select paid_publishing_enabled from employer_billing_config')).rows[0].paid_publishing_enabled,false);
    await isolated.exec('set role anon');assert.equal((await isolated.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n,1);await isolated.exec('reset role');
    await assert.rejects(isolated.exec(buildEmployerBackend()),/already present/);await isolated.exec('rollback');
  }finally{await isolated.close();}
});
