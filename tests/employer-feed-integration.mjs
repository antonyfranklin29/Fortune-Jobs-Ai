// Integration of Codex worker/staging with Claude's ACTUAL pending SQL.
// An ephemeral in-memory PostgreSQL instance only; no real accounts or network.
import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createEmployerFeedHandler} from '../supabase/functions/employer-feed/handler.mjs';
import {createEmployerRefreshHandler} from '../supabase/functions/employer-refresh/handler.mjs';
import {normalizeEmployerJob} from '../supabase/functions/employer-feed/lib.mjs';
import {compileRoles,regionIndex} from '../supabase/functions/job-ingest/lib.mjs';
import {ROLES,REGIONS} from '../supabase/functions/job-ingest/config.mjs';
import {createRequire} from 'node:module';
const {build:buildEmployerBackend,buildUpgrade,buildFeedUpgrade,buildRefreshUpgrade,buildUrlUpgrade,buildUrlRollback,files:employerMigrations}=createRequire(import.meta.url)('../scripts/build-employer-backend.cjs');
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
    'migrations/pending/20261019_employer_pending_account_cleanup.sql',
    'migrations/pending/20261019_employer_concurrency_hardening.sql',
    'migrations/pending/20261020_employer_post_actions.sql',
    'migrations/pending/20261021_employer_feed_concurrency_hardening.sql',
    'migrations/pending/20261022_employer_paused_post_state.sql',
    'migrations/pending/20261023_employer_refresh_workflow.sql','migrations/pending/20261024_employer_url_conflicts.sql']){
    try{await db.exec(read(path));}catch(e){throw Error(`${path}: ${e.message}`);}
  }
});
after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('reset role; truncate public.employer_feed_staging,public.employer_feed_leases,public.employer_feed_runs,public.pre_scraped_jobs,public.employer_orgs,auth.users cascade; update employer_refresh_control set enabled=false,active_ticket=null,lease_until=null;');});
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

async function directPost(){
  await seed();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
  const post=await call('employer_save_post',['uuid','uuid','jsonb'],[ORG,null,{
    job_title:'Data Analyst',canonical_role:'data-analyst',state_code:'NJ',city:'Edison',
    description:'Build dashboards and reports for operations. '.repeat(3),apply_url:'https://synthetic-careers.com/reviewed-job',
    posting_date:new Date().toISOString().slice(0,10),closing_date:new Date(Date.now()+86400000*20).toISOString().slice(0,10),
  }]);
  await call('employer_submit_post',['uuid'],[post.id]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OPERATOR]);
  const result=await call('operator_review_post',['uuid','integer','text','text'],[post.id,1,'approve','Reviewed synthetic vacancy']);
  assert.equal(result.published,true);return post.id;
}
async function ownerPostState(){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
  await db.exec('set role authenticated');
  try{return(await call('employer_my_state',[],[])).orgs[0].posts[0];}
  finally{await db.exec('reset role');}
}

test('owner close frees the slot and current approval permits reopening',async()=>{
  const id=await directPost();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
  await call('employer_close_post',['uuid'],[id]);
  assert.equal((await ownerPostState()).can_activate,true);
  assert.equal((await db.query('select public.employer_active_count($1) n',[ORG])).rows[0].n,0);
  assert.equal((await call('employer_activate_post',['uuid'],[id])).published,true);
  assert.equal((await db.query('select public.employer_active_count($1) n',[ORG])).rows[0].n,1);
});

test('reviewer takedown withdraws approval and cannot be undone by an employer',async()=>{
  const id=await directPost();
  await call('operator_close_post',['uuid','text'],[id,'Synthetic policy takedown']);
  const state=await ownerPostState();assert.equal(state.status,'closed');assert.equal(state.can_activate,false);
  await db.exec('set role authenticated');
  try{await assert.rejects(call('employer_activate_post',['uuid'],[id]),/review_required/);}
  finally{await db.exec('reset role');}
  assert.equal((await db.query('select count(*)::int n from pre_scraped_jobs where closed_at is null')).rows[0].n,0);
});

test('expired, unreviewed and inactive-company posts never offer reopening',async()=>{
  const id=await directPost();
  await db.query("update employer_posts set status='closed',posting_date=current_date-10,closing_date=current_date-1 where id=$1",[id]);
  assert.equal((await ownerPostState()).can_activate,false);
  await db.query("update employer_posts set closing_date=current_date+20,has_unreviewed_changes=true where id=$1",[id]);
  assert.equal((await ownerPostState()).can_activate,false);
  await db.query("update employer_posts set has_unreviewed_changes=false where id=$1",[id]);
  await db.query("update employer_orgs set status='suspended' where id=$1",[ORG]);
  assert.equal((await ownerPostState()).can_activate,false);
});

test('new lock helpers remain private and a banned actor cannot publish',async()=>{
  const id=await directPost();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
  await call('employer_close_post',['uuid'],[id]);
  await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[OWNER]);
  await assert.rejects(call('employer_activate_post',['uuid'],[id]),/account_banned/);
  for(const role of ['anon','authenticated','service_role'])for(const fn of ['employer_lock_actor(uuid)','employer_lock_post_parties(uuid)']){
    assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,'public.'+fn])).rows[0].allowed,false);
  }
  assert.equal((await db.query('select count(*)::int n from pre_scraped_jobs where closed_at is null')).rows[0].n,0);
});

test('incremental deployment preserves existing records and grants; refuses a repeated upgrade',async()=>{
  const isolated=await PGlite.create();
  try{
    for(const file of ['tests/sql/supabase-shim.sql','migrations/20261015_ingest_taxonomy.sql','migrations/20261015_ingest_catalogue.sql','migrations/20261015_ingest_feed.sql',
      ...employerMigrations.slice(0,employerMigrations.indexOf('20261019_employer_concurrency_hardening.sql')).map(name=>'migrations/pending/'+name)])await isolated.exec(read(file));
    await isolated.exec(`insert into auth.users(id,email,email_confirmed_at) values('${OWNER}','synthetic@synthetic-careers.com',now());
      insert into employer_orgs(id,name,primary_domain,status,created_by) values('${ORG}','Existing synthetic company','synthetic-careers.com','pending','${OWNER}');
      insert into pre_scraped_jobs(category,job_title,apply_url) values('Data Analyst','Existing job','https://synthetic.com/legacy');`);
    await isolated.exec(buildUpgrade());
    assert.equal((await isolated.query('select count(*)::int n from auth.users')).rows[0].n,1);
    assert.equal((await isolated.query('select count(*)::int n from employer_orgs')).rows[0].n,1);
    assert.equal((await isolated.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n,1);
    assert.equal((await isolated.query("select has_function_privilege('anon','public.employer_my_state()','EXECUTE') allowed")).rows[0].allowed,false);
    assert.equal((await isolated.query("select has_function_privilege('authenticated','public.employer_my_state()','EXECUTE') allowed")).rows[0].allowed,true);
    await isolated.exec(buildFeedUpgrade());
    assert.equal((await isolated.query('select count(*)::int n from employer_orgs')).rows[0].n,1);
    assert.equal((await isolated.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n,1);
    assert.equal((await isolated.query("select has_function_privilege('anon','public.employer_set_keep_on_downgrade(uuid,boolean)','EXECUTE') allowed")).rows[0].allowed,false);
    assert.equal((await isolated.query("select has_function_privilege('authenticated','public.employer_set_keep_on_downgrade(uuid,boolean)','EXECUTE') allowed")).rows[0].allowed,true);
    await isolated.exec(buildRefreshUpgrade());
    assert.equal((await isolated.query('select enabled from employer_refresh_control')).rows[0].enabled,false);
    assert.equal((await isolated.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n,1);
    assert.equal((await isolated.query('select count(*)::int n from employer_orgs')).rows[0].n,1);
    await assert.rejects(isolated.exec(buildRefreshUpgrade()),/refresh upgrade already present/);await isolated.exec('rollback');
    await assert.rejects(isolated.exec(buildFeedUpgrade()),/feed upgrade already present/);await isolated.exec('rollback');
    await assert.rejects(isolated.exec(buildUpgrade()),/upgrade already present/);await isolated.exec('rollback');
  }finally{await isolated.close();}
});

test('company suspension shows paused listings; re-verification needs a deliberate reactivation',async()=>{
  const id=await directPost();
  await call('operator_set_org_status',['uuid','text','text'],[ORG,'suspended','Synthetic company review']);
  let state=await ownerPostState();assert.equal(state.status,'paused');assert.equal(state.can_activate,false);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OPERATOR]);
  await call('operator_set_org_status',['uuid','text','text'],[ORG,'verified','Synthetic company identity rechecked']);
  state=await ownerPostState();assert.equal(state.status,'paused');assert.equal(state.can_activate,true);
  assert.equal((await db.query('select count(*)::int n from pre_scraped_jobs where closed_at is null')).rows[0].n,0);
  assert.equal((await call('employer_activate_post',['uuid'],[id])).published,true);
  assert.equal((await ownerPostState()).status,'published');
});

test('deleted source approver frees allowance; re-approval cannot publish old candidates',async()=>{
  await seed();await handler(1)(request());await selectJobs(['job-0']);await publish(['job-0']);
  await db.query('delete from auth.users where id=$1',[OPERATOR]);
  assert.equal((await db.query('select public.employer_active_count($1) n',[ORG])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from pre_scraped_jobs where closed_at is null')).rows[0].n,0);
  const reviewer='88888888-8888-8888-8888-888888888888';
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'new-reviewer@synthetic-review.com',now())",[reviewer]);
  await db.query('insert into employer_operators(user_id) values($1)',[reviewer]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[reviewer]);
  const approved=await call('operator_review_source',['text','integer','text','text[]','text','boolean','timestamptz','text','text'],
    [SOURCE,2,'approve',['jobs.lever.co'],'Synthetic Employer',false,new Date(Date.now()+86400000*30).toISOString(),'fixture-new-permission','Synthetic permission rechecked']);
  assert.equal(approved.revision,3);
  const stale=await publish(['job-0'],3);assert.equal(stale.published,0);assert.equal(stale.skipped[0].reason,'stale_candidate_revision');
  await handler(1)(request());await selectJobs(['job-0']);
  assert.equal((await publish(['job-0'],3)).published,1);
});


const refreshClaim=source=>call('employer_refresh_claim',['text'],[source]);
const refreshFinish=(ticket,run)=>call('employer_refresh_finish',['uuid','uuid'],[ticket,run]);
const refreshFail=(ticket,reason)=>call('employer_refresh_fail',['uuid','text'],[ticket,reason]);
const refreshHealth=()=>call('employer_refresh_health',[],[]);
const coordinator=(n,patch={})=>createEmployerRefreshHandler({secret:'fixture-secret',stage:handler(n),
  claim:refreshClaim,finish:refreshFinish,fail:refreshFail,health:refreshHealth,...patch});
const refreshRequest=(body={action:'refresh'})=>new Request('https://refresh.example',{
  method:'POST',headers:{'x-ingest-secret':'fixture-secret'},body:JSON.stringify(body)});
async function due(){await db.exec("update employer_refresh_schedule set next_due_at=now()-interval '1 minute'");}
async function enable(){await db.exec('update employer_refresh_control set enabled=true');}
async function executeRefresh(n,patch={}){const res=await coordinator(n,patch)(refreshRequest());return{http:res.status,...await res.json()};}
async function stageClaim(n,patch={}){
  await due();const claim=await refreshClaim(SOURCE);assert.equal(claim.status,'claimed');
  const response=await handler(n,patch)(request());const run=await response.json();assert.equal(response.status,200);
  return{ticket:claim.ticket,run:run.run_id};
}

test('refresh is disabled by default and auth/strict input gates run before provider or SQL access',async()=>{
  await seed();let calls=0;
  const fn=coordinator(1,{claim:async()=>{calls++;throw Error('unexpected');}});
  assert.equal((await fn(new Request('https://refresh.example',{method:'POST',body:'{}'}))).status,401);
  for(const body of [{action:'refresh',url:'https://evil.test'}, {action:'refresh',source_id:'../evil'},
    {action:'health',source_id:SOURCE},{action:'publish'},Array(5000).fill('x')])assert.equal((await fn(refreshRequest(body))).status,400);
  assert.equal(calls,0);assert.equal((await executeRefresh(1)).status,'disabled');
  assert.equal((await db.query('select count(*)::int n from employer_feed_runs')).rows[0].n,0);
});

test('coordinator collects, queues choices, enforces 15 slots and provides private health counts',async()=>{
  await seed();await enable();
  const first=await executeRefresh(16);assert.equal(first.status,'complete');assert.equal(first.published,0);assert.equal(first.accepted,16);
  await selectJobs(jobs(16).map(j=>j.id));await due();
  const second=await executeRefresh(16);assert.equal(second.status,'complete');assert.equal(second.published,15);assert.equal(second.blocked_quota,1);
  assert.equal((await db.query('select employer_active_count($1) n',[ORG])).rows[0].n,15);
  const health=await refreshHealth();assert.equal(health.eligible_sources,1);assert.equal(health.failed_24h,0);assert.equal(health.busy,false);
  assert(!JSON.stringify(health).includes('fixture-private-reference'));
  const idle=await executeRefresh(16);assert.equal(idle.status,'idle');
});

test('clean sweep closes only missing/deselected jobs, then fills freed allowance in the same transaction',async()=>{
  await seed();await enable();await executeRefresh(16);await selectJobs(jobs(16).map(j=>j.id));await due();await executeRefresh(16);
  await due();const current=jobs(16).slice(1);
  const res=await executeRefresh(0,{stage:handler(0,{fetchPage:async()=>current})});
  assert.equal(res.closed,1);assert.equal(res.published,1);assert.equal(res.updated,14);assert.equal(res.reconciled,true);
  assert.equal((await db.query("select closed_at is not null closed from pre_scraped_jobs where source_listing_id=$1",[SOURCE+':job-0'])).rows[0].closed,true);
  await call('employer_select_feed_jobs',['text','text[]','boolean'],[SOURCE,['job-1'],false]);await due();
  assert.equal((await executeRefresh(0,{stage:handler(0,{fetchPage:async()=>current})})).closed,1);
  const visible=await call('employer_list_feed_candidates',['text'],[SOURCE]);assert.equal(visible.length,15);assert(!visible.some(c=>c.provider_post_id==='job-0'));
});

test('partial and rejected enumerations never close existing vacancies',async()=>{
  await seed();await enable();await handler(1)(request());await selectJobs(['job-0']);await publish(['job-0']);
  const page=Array.from({length:100},(_,i)=>({...jobs(1)[0],id:'other-'+i,applyUrl:'https://jobs.lever.co/synthetic/other-'+i+'/apply'}));
  await db.exec('update employer_refresh_control set max_requests=1');
  let res=await executeRefresh(0,{stage:handler(0,{fetchPage:async()=>page})});assert.equal(res.status,'partial');assert.equal(res.closed,0);
  await due();res=await executeRefresh(0,{stage:handler(0,{fetchPage:async()=>[{...jobs(1)[0],country:'GB'}]})});
  assert.equal(res.status,'degraded');assert.equal(res.closed,0);
  assert.equal((await db.query('select count(*)::int n from pre_scraped_jobs where closed_at is null')).rows[0].n,1);
});

test('provider failure keeps catalogue intact and records retryable, sanitised operational failure',async()=>{
  await seed();await enable();await handler(1)(request());await selectJobs(['job-0']);await publish(['job-0']);
  const res=await executeRefresh(0,{stage:handler(0,{fetchPage:async()=>{throw Error('private provider message');}})});
  assert.equal(res.http,503);assert.equal(res.closed,0);assert(!JSON.stringify(res).includes('private provider message'));
  assert.equal((await refreshHealth()).failed_24h,1);
  assert.equal((await db.query('select count(*)::int n from pre_scraped_jobs where closed_at is null')).rows[0].n,1);
  assert.equal((await refreshClaim(SOURCE)).status,'idle');
});

test('empty feed needs two clean runs separated by five minutes under unchanged approval',async()=>{
  await seed();await enable();await handler(1)(request());await selectJobs(['job-0']);await publish(['job-0']);
  let res=await executeRefresh(0);assert.equal(res.reason,'empty_confirmation_required');assert.equal(res.closed,0);
  await due();res=await executeRefresh(0);assert.equal(res.closed,0);
  await db.exec("update employer_refresh_schedule set next_due_at=now(),empty_seen_at=now()-interval '6 minutes'");
  res=await executeRefresh(0);assert.equal(res.closed,1);assert.equal(res.reconciled,true);assert.equal(res.status,'complete');
});

test('failed run interrupts the empty-feed confirmation sequence',async()=>{
  await seed();await enable();await executeRefresh(0);await due();
  await executeRefresh(0,{stage:handler(0,{fetchPage:async()=>{throw Error();}})});await due();
  assert.equal((await executeRefresh(0)).reason,'empty_confirmation_required');
});

test('global claim, ticket expiry and newest-run fences block stale workers',async()=>{
  await seed();await enable();const claimed=await stageClaim(1);
  assert.equal((await refreshClaim(SOURCE)).status,'busy');
  await handler(1)(request()); // a newer independently staged run invalidates the old finalizer
  await assert.rejects(refreshFinish(claimed.ticket,claimed.run),/stale_batch/);
  await refreshFail(claimed.ticket,'fixture_failure');await due();const expired=await stageClaim(1);
  await db.query("update employer_refresh_attempts set lease_until=now()-interval '1 second' where id=$1",[expired.ticket]);
  await assert.rejects(refreshFinish(expired.ticket,expired.run),/stale_ticket/);
  assert.equal((await db.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n,0);
});

test('finalization is idempotent; mismatched candidates and revoked permissions cannot publish',async()=>{
  await seed();await enable();const a=await stageClaim(1);await selectJobs(['job-0']);
  const first=await refreshFinish(a.ticket,a.run);assert.equal(first.published,1);
  assert.deepEqual(await refreshFinish(a.ticket,a.run),first);
  const b=await stageClaim(1);await db.exec("update employer_feed_candidates set payload=jsonb_set(payload,'{job_title}','\"Changed job\"'::jsonb)");
  await assert.rejects(refreshFinish(b.ticket,b.run),/candidate_batch_changed/);await refreshFail(b.ticket,'fixture_failure');
  const c=await stageClaim(1);await db.query('update employer_sources set revision=revision+1,enabled=false where id=$1',[SOURCE]);
  await assert.rejects(refreshFinish(c.ticket,c.run),/stale_batch/);
});

test('publisher exception rolls back closure and is recorded separately',async()=>{
  await seed();await enable();await handler(1)(request());await selectJobs(['job-0']);await publish(['job-0']);
  const original=(await db.query("select pg_get_functiondef('employer_publish_feed_jobs(text,integer,text[])'::regprocedure) definition")).rows[0].definition;
  await db.exec(`create or replace function employer_publish_feed_jobs(p_source text,p_revision integer,p_provider_ids text[]) returns jsonb language plpgsql as $$ begin raise exception 'fixture publisher failure'; end $$;`);
  try{
    const res=await executeRefresh(0,{stage:handler(0,{fetchPage:async()=>[{...jobs(1)[0],id:'job-new',applyUrl:'https://jobs.lever.co/synthetic/job-new/apply'}]})});
    assert.equal(res.reason,'settlement_failed');assert.equal((await refreshHealth()).failed_24h,1);
    assert.equal((await db.query('select count(*)::int n from pre_scraped_jobs where closed_at is null')).rows[0].n,1);
  }finally{await db.exec(original);}
});

test('refresh RPCs/tables are service-only by effective privileges; trigger helper stays private',async()=>{
  for(const role of ['anon','authenticated']){
    for(const fn of ['employer_refresh_claim(text)','employer_refresh_fail(uuid,text)','employer_refresh_finish(uuid,uuid)','employer_refresh_health()'])
      assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,'public.'+fn])).rows[0].ok,false);
    for(const table of ['employer_refresh_control','employer_refresh_schedule','employer_refresh_attempts'])
      assert.equal((await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') ok",[role,table])).rows[0].ok,false);
  }
  assert.equal((await db.query("select has_function_privilege('service_role','employer_refresh_selection_changed()','EXECUTE') ok")).rows[0].ok,false);
});

test('atomic employer choices replace the whole selection; stale lists and other users change nothing',async()=>{
  await seed();await handler(3)(request());await selectJobs(['job-0','job-1']);
  await db.exec('set role authenticated');
  try{
    assert.equal(await call('employer_replace_feed_selection',['text','text[]'],[SOURCE,['job-2']]),1);
    await assert.rejects(call('employer_replace_feed_selection',['text','text[]'],[SOURCE,['missing-job']]),/candidate_list_changed/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OPERATOR]);
    await assert.rejects(call('employer_replace_feed_selection',['text','text[]'],[SOURCE,[]]),/source_not_found/);
  }finally{await db.exec('reset role');}
  assert.deepEqual((await db.query('select provider_post_id from employer_feed_candidates where selected')).rows,[{provider_post_id:'job-2'}]);
  await db.exec('set role anon');
  try{await assert.rejects(call('employer_replace_feed_selection',['text','text[]'],[SOURCE,[]]),e=>e.code==='42501');}
  finally{await db.exec('reset role');}
});

test('URL conflict recovery never masks an unrelated uniqueness failure',async()=>{
  await seed();await handler(2)(request());await selectJobs(['job-0','job-1']);await publish(['job-0']);
  await db.exec('create unique index fixture_other_unique on pre_scraped_jobs(job_title)');
  try{
    await assert.rejects(publish(['job-1']),e=>e.code==='23505'&&e.constraint==='fixture_other_unique');
    assert.equal((await db.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n,1);
  }finally{await db.exec('drop index fixture_other_unique');}
});

test('URL upgrade and rollback preserve a populated 736-job catalogue, audit rows and coordinator definitions',async()=>{
  const isolated=await PGlite.create();
  try{
    for(const p of ['tests/sql/supabase-shim.sql','migrations/20261015_ingest_taxonomy.sql','migrations/20261015_ingest_catalogue.sql','migrations/20261015_ingest_feed.sql',
      ...employerMigrations.filter(n=>n!=='20261024_employer_url_conflicts.sql').map(n=>'migrations/pending/'+n)])await isolated.exec(read(p));
    await isolated.exec(`insert into auth.users(id,email,email_confirmed_at) values('${OWNER}','synthetic@synthetic-careers.com',now());
      insert into employer_orgs(id,name,primary_domain,status,created_by) values('${ORG}','Existing synthetic company','synthetic-careers.com','pending','${OWNER}');
      insert into pre_scraped_jobs(category,job_title,apply_url) select 'Data Analyst','Synthetic listing '||i,'https://synthetic.com/job-'||i from generate_series(1,736) i;
      select employer_audit_log(null,'service','${ORG}','org','${ORG}','upgrade_probe','{}');`);
    const snapshot=async()=> (await isolated.query(`select jsonb_build_object(
      'jobs',(select md5(jsonb_agg(to_jsonb(j) order by id)::text) from pre_scraped_jobs j),
      'orgs',(select jsonb_agg(to_jsonb(o) order by id) from employer_orgs o),
      'users',(select jsonb_agg(to_jsonb(u) order by id) from auth.users u),
      'audit',(select jsonb_agg(to_jsonb(a) order by id) from employer_audit a),
      'closure',pg_get_functiondef('employer_refresh_finish(uuid,uuid)'::regprocedure),
      'staging',pg_get_functiondef('employer_feed_stage_registered_run(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure),
      'control',(select to_jsonb(c) from employer_refresh_control c)) state`)).rows[0].state;
    const before=await snapshot();await isolated.exec(buildUrlUpgrade());assert.deepEqual(await snapshot(),before);
    await assert.rejects(isolated.exec(buildUrlUpgrade()),/URL upgrade already present/);await isolated.exec('rollback');
    await isolated.exec(buildUrlRollback());assert.deepEqual(await snapshot(),before);
    await assert.rejects(isolated.exec(buildUrlRollback()),/URL upgrade not present/);await isolated.exec('rollback');
    await isolated.exec(buildUrlUpgrade());assert.deepEqual(await snapshot(),before);
    assert.equal((await isolated.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n,736);
  }finally{await isolated.close();}
});
