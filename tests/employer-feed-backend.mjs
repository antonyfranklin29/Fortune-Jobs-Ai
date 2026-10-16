import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createEmployerFeedHandler} from '../supabase/functions/employer-feed/handler.mjs';
import {compileRoles,regionIndex} from '../supabase/functions/job-ingest/lib.mjs';
import {ROLES,REGIONS} from '../supabase/functions/job-ingest/config.mjs';

const source={id:'fixture-source',adapter:'lever',api_region:'global',board_token:'synthetic',
  employer_name:'Synthetic Employer',status:'approved',enabled:true,rights_basis:'employer_written_permission',
  permission_ref:'private-fixture-reference',approved_by:'fixture-reviewer',
  approved_at:new Date(Date.now()-3600000).toISOString(),domain_verified_at:new Date(Date.now()-3600000).toISOString(),
  authorization_expires_at:new Date(Date.now()+86400000).toISOString(),allow_display:true,allow_refresh:true,
  allow_description:false,allowed_apply_hosts:['jobs.lever.co'],attribution_text:''};
const job={id:'fixture-job',text:'Data Analyst',country:'US',categories:{location:'Raleigh, NC'},
  applyUrl:'https://jobs.lever.co/synthetic/fixture-job/apply'};
let db;
before(async()=>{
  db=await PGlite.create();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(readFileSync(new URL('../migrations/pending/20261016_employer_feed_runs.sql',import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('truncate public.employer_feed_staging,public.employer_feed_leases,public.employer_feed_runs;');});
async function call(fn,types,args){
  const values=args.map((v,i)=>types[i]==='jsonb'?JSON.stringify(v):v);
  return (await db.query(`select public.${fn}(${types.map((t,i)=>`$${i+1}::${t}`).join(',')}) as result`,values)).rows[0].result;
}
const store={
  begin:(id,revision,snapshot)=>call('employer_feed_run_begin',['text','bigint','jsonb'],[id,revision,snapshot]),
  stage:(id,token,revision,rows,summary)=>call('employer_feed_run_stage',['uuid','uuid','bigint','jsonb','jsonb'],[id,token,revision,rows,summary]),
  fail:(id,token,reason)=>call('employer_feed_run_fail',['uuid','uuid','text'],[id,token,reason]),
};
const row={source:'employer_feed',employer_source_id:source.id,source_listing_id:`${source.id}:fixture-job`,job_title:'Data Analyst'};
const summary={enumeration_complete:true,requests_used:1,received:1,accepted:1,source_id:source.id,source_revision:1,rejected:{}};
const begin=()=>store.begin(source.id,1,source);
const request=(body={},secret='fixture-secret')=>new Request('https://worker.example/employer-feed',{
  method:'POST',headers:{'content-type':'application/json','x-ingest-secret':secret},body:JSON.stringify({source_id:source.id,...body})});
const handler=patch=>createEmployerFeedHandler({enabled:true,secret:'fixture-secret',loadSource:async()=>({source,revision:1}),
  store,roles:compileRoles(ROLES),idx:regionIndex(REGIONS),fetchPage:async()=>[job],...patch});

test('migration restricts effective function/table privileges, including inherited PUBLIC execute',async()=>{
  for(const role of ['anon','authenticated','service_role']){
    const expected=role==='service_role';
    for(const fn of ['employer_feed_run_begin(text,bigint,jsonb)','employer_feed_run_stage(uuid,uuid,bigint,jsonb,jsonb)','employer_feed_run_fail(uuid,uuid,text)','employer_feed_run_prune()']){
      const q=await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed',[role,`public.${fn}`]);
      assert.equal(q.rows[0].allowed,expected);
    }
    for(const table of ['employer_feed_runs','employer_feed_leases','employer_feed_staging']){
      const q=await db.query('select has_table_privilege($1,$2,\'SELECT\') as allowed',[role,`public.${table}`]);
      assert.equal(q.rows[0].allowed,expected);
    }
  }
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    try{
      await assert.rejects(begin(),e=>e.code==='42501');
      await assert.rejects(db.query('select * from public.employer_feed_staging'),e=>e.code==='42501');
    }finally{await db.exec('reset role');}
  }
});

test('one source lease admits one claimant and leaves independent sources available',async()=>{
  const [a,b]=await Promise.all([begin(),begin()]);
  assert.deepEqual([a.status,b.status].sort(),['busy','claimed']);
  const other=await store.begin('other-source',1,{...source,id:'other-source'});
  assert.equal(other.status,'claimed');
  assert.equal((await db.query('select count(*)::int as n from public.employer_feed_runs')).rows[0].n,2);
});

test('private staging is idempotent and releases the source lease without publishing',async()=>{
  const run=await begin();
  assert.equal((await store.stage(run.run_id,run.lease_token,1,[row],summary)).status,'staged');
  const second=await store.stage(run.run_id,run.lease_token,1,[{...row,job_title:'Altered'}],summary);
  assert.equal(second.status,'already_staged');
  const saved=(await db.query('select payload from public.employer_feed_staging')).rows;
  assert.equal(saved.length,1);assert.equal(saved[0].payload.job_title,'Data Analyst');
  assert.equal((await begin()).status,'claimed');
});

test('staging rejects other-source rows, duplicate IDs, changed revision and forged lease tokens',async()=>{
  const run=await begin();
  for(const rows of [[{...row,employer_source_id:'other-source'}],[{...row,source:'adzuna'}],[row,row]])
    assert.equal((await store.stage(run.run_id,run.lease_token,1,rows,summary)).reason,'invalid_batch');
  for(const patch of [{source_id:'other-source'},{source_revision:2},{accepted:99},{requests_used:7},{received:0},{rejected:'fake'}])
    assert.equal((await store.stage(run.run_id,run.lease_token,1,[row],{...summary,...patch})).reason,'invalid_batch');
  assert.equal((await store.stage(run.run_id,run.lease_token,2,[row],summary)).reason,'stale_lease');
  assert.equal((await store.stage(run.run_id,'00000000-0000-0000-0000-000000000000',1,[row],summary)).reason,'stale_lease');
  assert.equal((await db.query('select count(*)::int as n from public.employer_feed_staging')).rows[0].n,0);
});

test('an expired worker cannot stage or release a replacement worker lease',async()=>{
  const old=await begin();
  await db.exec("update public.employer_feed_leases set expires_at=clock_timestamp()-interval '1 second'; update public.employer_feed_runs set lease_expires_at=clock_timestamp()-interval '1 second';");
  const replacement=await begin();assert.equal(replacement.status,'claimed');
  assert.equal((await store.stage(old.run_id,old.lease_token,1,[row],summary)).reason,'stale_lease');
  assert.equal((await store.fail(old.run_id,old.lease_token,'collection_failed')).reason,'stale_lease');
  assert.equal((await begin()).status,'busy');
  assert.equal((await db.query('select status from public.employer_feed_runs where id=$1',[old.run_id])).rows[0].status,'expired');
});

test('incomplete collection stages a partial batch and never grants reconciliation or publication',async()=>{
  const run=await begin();
  const r=await store.stage(run.run_id,run.lease_token,1,[row],{...summary,enumeration_complete:false});
  assert.equal(r.status,'partial');
  assert.equal((await db.query('select status from public.employer_feed_runs')).rows[0].status,'partial');
});

test('HTTP authentication and disabled gate perform no registry or provider requests',async()=>{
  let calls=0;
  const fn=handler({loadSource:async()=>{calls++;}});
  assert.equal((await fn(request({},'wrong'))).status,401);
  const anonJwt=new Request('https://worker.example',{method:'POST',headers:{Authorization:'Bearer publishable-anon-jwt'},body:'{}'});
  assert.equal((await fn(anonJwt)).status,401);
  assert.equal((await handler({enabled:false})(request())).status,503);
  assert.equal((await handler({secret:''})(request())).status,503);
  assert.equal(calls,0);
});

test('snapshot expiry bounds lease lifetime and missing/invalid approval cannot reserve capacity',async()=>{
  for(const patch of [{status:'pending'},{enabled:false},{authorization_expires_at:null},
    {authorization_expires_at:'not-a-date'},{authorization_expires_at:'2020-01-01T00:00:00Z'}])
    assert.equal((await store.begin(source.id,1,{...source,...patch})).status,'rejected');
  assert.equal((await db.query('select count(*)::int as n from public.employer_feed_leases')).rows[0].n,0);
  const expires=new Date(Date.now()+10000).toISOString();
  const run=await store.begin(source.id,1,{...source,authorization_expires_at:expires});
  assert.equal(Date.parse(run.expires_at),Date.parse(expires));
});

test('HTTP rejects injected source/paid fields and oversized or invalid JSON',async()=>{
  const fn=handler({loadSource:async()=>{throw Error('must not load');}});
  for(const body of [{paid:true},{source},{max_requests:7},{dry_run:'false'},{source_id:'http://127.0.0.1'}])
    assert.equal((await fn(request(body))).status,400);
  for(const body of ['not-json',' '.repeat(4097)]){
    const r=new Request('https://worker.example',{method:'POST',headers:{'x-ingest-secret':'fixture-secret'},body});
    assert.equal((await fn(r)).status,400);
  }
});

test('HTTP dry run is the default and never creates a private run or returns approval evidence',async()=>{
  const response=await handler()(request());const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.status,'complete');assert.equal(body.dry_run,true);
  assert.equal(body.accepted,1);assert.equal(body.published,0);
  assert.equal((await db.query('select count(*)::int as n from public.employer_feed_runs')).rows[0].n,0);
  assert.ok(!JSON.stringify(body).includes(source.permission_ref));assert.ok(!('rows' in body));
});

test('HTTP live collection integrates actual staging SQL, retaining no public authority',async()=>{
  const response=await handler()(request({dry_run:false}));const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.status,'staged');assert.equal(body.accepted,1);assert.equal(body.published,0);
  assert.ok(body.run_id);assert.ok(!('lease_token' in body));
  const batch=(await db.query('select payload from public.employer_feed_staging')).rows;
  assert.equal(batch.length,1);assert.equal(batch[0].payload.company,source.employer_name);
});

test('HTTP busy sources do not call providers; failed providers fail the run and release capacity',async()=>{
  await begin();let calls=0;
  const busy=await handler({fetchPage:async()=>{calls++;}})(request({dry_run:false}));
  assert.equal(busy.status,409);assert.equal(calls,0);
  await db.exec('truncate public.employer_feed_staging,public.employer_feed_leases,public.employer_feed_runs;');
  const failed=await handler({fetchPage:async()=>{throw Error('private-key=never-show-this');}})(request({dry_run:false}));
  const text=await failed.text();assert.equal(failed.status,503);assert.ok(!text.includes('private-key'));
  assert.equal((await db.query('select status from public.employer_feed_runs')).rows[0].status,'failed');
  assert.equal((await begin()).status,'claimed');
});

test('registry revocation during collection prevents staging every row',async()=>{
  let revoked=false;
  const fn=handler({loadSource:async()=>({source:{...source,status:revoked?'revoked':'approved'},revision:revoked?2:1}),
    fetchPage:async()=>{revoked=true;return[job];}});
  const response=await fn(request({dry_run:false}));assert.equal(response.status,503);
  assert.equal((await db.query('select count(*)::int as n from public.employer_feed_staging')).rows[0].n,0);
  assert.equal((await db.query('select status from public.employer_feed_runs')).rows[0].status,'failed');
});

test('retention removes old private payloads/snapshots and preserves an active run',async()=>{
  const old=await begin();await store.stage(old.run_id,old.lease_token,1,[row],summary);
  await db.query("update public.employer_feed_runs set finished_at=clock_timestamp()-interval '8 days' where id=$1",[old.run_id]);
  const active=await begin();
  const pruned=await call('employer_feed_run_prune',[],[]);
  assert.equal(pruned.payloads_removed,1);assert.equal(pruned.runs_removed,0);
  const oldRow=(await db.query('select source_snapshot from public.employer_feed_runs where id=$1',[old.run_id])).rows[0];
  assert.deepEqual(oldRow.source_snapshot,{});
  assert.equal((await db.query('select status from public.employer_feed_runs where id=$1',[active.run_id])).rows[0].status,'collecting');
  await db.query("update public.employer_feed_runs set finished_at=clock_timestamp()-interval '31 days' where id=$1",[old.run_id]);
  assert.equal((await call('employer_feed_run_prune',[],[])).runs_removed,1);
});
