// Independent PostgreSQL 17 connections, synthetic records, disposable DB only.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {files}=createRequire(import.meta.url)('../scripts/build-employer-backend.cjs');
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const enabled=process.env.FJ_PG_DISPOSABLE==='1'&&['127.0.0.1','localhost','::1'].includes(process.env.PGHOST);
const OWNER='11111111-1111-1111-1111-111111111111',OP='22222222-2222-2222-2222-222222222222',ORG='33333333-3333-3333-3333-333333333333';
async function connect(database){const c=new pg.Client({database,connectionTimeoutMillis:3000,query_timeout:15000,statement_timeout:12000});await c.connect();return c;}
const rpc=async(c,name,args=[])=>{const r=await c.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args);return r.rows[0].v;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function blocked(c,client){
  for(let i=0;i<160;i++){if((await c.query("select wait_event_type='Lock' b from pg_stat_activity where pid=$1",[client.processID])).rows[0]?.b)return;await delay(25);}
  throw Error('expected independent session lock wait was not observed');
}
async function seed(c){
  await c.query(`insert into auth.users(id,email,email_confirmed_at) values('${OWNER}','owner@synthetic-careers.com',now()),('${OP}','reviewer@synthetic-review.com',now());
    insert into employer_operators(user_id) values('${OP}');
    insert into employer_orgs(id,name,primary_domain,status,domain_verified_at,verified_by,verified_at,created_by)
      values('${ORG}','Synthetic Employer','synthetic-careers.com','verified',now()-interval '1 hour','${OP}',now(),'${OWNER}');
    insert into employer_org_members(org_id,user_id) values('${ORG}','${OWNER}');
    insert into employer_sources(id,org_id,adapter,api_region,board_token,employer_name,status,enabled,rights_basis,permission_ref,approved_by,approved_at,
      authorization_expires_at,allow_display,allow_refresh,allowed_apply_hosts,submitted_by)
      values('fixture-source','${ORG}','lever','global','synthetic','Synthetic Employer','approved',true,'employer_written_permission','fixture-permission',
      '${OP}',now()-interval '1 hour',now()+interval '30 days',true,true,array['jobs.lever.co'],'${OWNER}');
    update employer_refresh_control set enabled=true;`);
}
async function staged(c){
  const claim=await rpc(c,'employer_refresh_claim',[null]);assert.equal(claim.status,'claimed');
  const source=await rpc(c,'employer_source_for_worker',['fixture-source']);
  const run=await rpc(c,'employer_feed_run_begin',['fixture-source',source.revision,source.source]);
  const row={source:'employer_feed',employer_source_id:'fixture-source',source_listing_id:'fixture-source:job-0',
    job_title:'Data Analyst',canonical_role:'data-analyst',country:'us',state_code:'NC',location:'Raleigh, NC',
    apply_url:'https://jobs.lever.co/synthetic/job-0/apply'};
  const result=await rpc(c,'employer_feed_stage_registered_run',[run.run_id,run.lease_token,source.revision,JSON.stringify([row]),
    {source_id:'fixture-source',source_revision:source.revision,accepted:1,received:1,requests_used:1,rejected:{},enumeration_complete:true}]);
  assert.equal(result.status,'staged');
  await c.query("update employer_feed_candidates set selected=true,selected_by=$1,selected_at=clock_timestamp()",[OWNER]);
  return{claim,run};
}
test('refresh finalization interleavings on real PostgreSQL', {skip:!enabled,timeout:120000},async t=>{
  const admin=await connect('postgres');const template='fj_refresh_tpl_'+process.pid;let next=0;
  try{
    await admin.query(`create database ${template}`);const base=await connect(template);
    try{for(const p of ['tests/sql/supabase-shim.sql','migrations/20261015_ingest_taxonomy.sql','migrations/20261015_ingest_catalogue.sql','migrations/20261015_ingest_feed.sql',...files.map(f=>'migrations/pending/'+f)])await base.query(read(p));await seed(base);}finally{await base.end();}
    async function scenario(name,fn){await t.test(name,async()=>{
      const nameDb='fj_refresh_case_'+process.pid+'_'+(++next);await admin.query(`create database ${nameDb} template ${template}`);
      const clients=await Promise.all([connect(nameDb),connect(nameDb),connect(nameDb)]);
      try{await fn(...clients);}finally{await Promise.allSettled(clients.map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));await admin.query(`drop database ${nameDb} with (force)`);}
    });}
    await scenario('two scheduler calls admit exactly one refresh',async(c,a,b)=>{
      const rs=await Promise.all([rpc(a,'employer_refresh_claim',[null]),rpc(b,'employer_refresh_claim',[null])]);
      assert.deepEqual(rs.map(r=>r.status).sort(),['busy','claimed']);
    });
    await scenario('revocation winning the organisation lock blocks pending finalization',async(c,a,b)=>{
      const {claim,run}=await staged(c);await a.query('begin');
      await a.query('select employer_lock_org($1)',[ORG]);await a.query("update employer_sources set enabled=false,revision=revision+1 where id='fixture-source'");
      const finishing=rpc(b,'employer_refresh_finish',[claim.ticket,run.run_id]).then(v=>({v}),e=>({e}));
      await blocked(c,b);await a.query('commit');const result=await finishing;assert.match(result.e?.message||'',/stale_batch/);
      assert.equal((await c.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n,0);
    });
    await scenario('new collection lease winning its lock fences an older finalizer',async(c,a,b)=>{
      const {claim,run}=await staged(c);const source=await rpc(c,'employer_source_for_worker',['fixture-source']);
      await a.query('begin');const newer=await rpc(a,'employer_feed_run_begin',['fixture-source',source.revision,source.source]);assert.equal(newer.status,'claimed');
      const finishing=rpc(b,'employer_refresh_finish',[claim.ticket,run.run_id]).then(v=>({v}),e=>({e}));
      await blocked(c,b);await a.query('commit');assert.match((await finishing).e?.message||'',/stale_batch/);
    });
    await scenario('selection change winning candidate lock is respected by publication',async(c,a,b)=>{
      const {claim,run}=await staged(c);await a.query('begin');await a.query("update employer_feed_candidates set selected=false where source_id='fixture-source'");
      const finishing=rpc(b,'employer_refresh_finish',[claim.ticket,run.run_id]);await blocked(c,b);await a.query('commit');
      assert.equal((await finishing).published,0);assert.equal((await c.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n,0);
    });
    await scenario('wall-clock lease is rechecked after waiting for candidate lock',async(c,a,b)=>{
      const {claim,run}=await staged(c);await c.query("update employer_refresh_attempts set lease_until=clock_timestamp()+interval '1 second' where id=$1",[claim.ticket]);
      await a.query('begin');await a.query('select 1 from employer_feed_candidates for update');
      const finishing=rpc(b,'employer_refresh_finish',[claim.ticket,run.run_id]).then(v=>({v}),e=>({e}));
      await blocked(c,b);await delay(1100);await a.query('commit');assert.match((await finishing).e?.message||'',/stale_ticket/);
    });
    await scenario('simultaneous replays settle once and return the cached outcome',async(c,a,b)=>{
      const {claim,run}=await staged(c);const results=await Promise.all([rpc(a,'employer_refresh_finish',[claim.ticket,run.run_id]),rpc(b,'employer_refresh_finish',[claim.ticket,run.run_id])]);
      assert.deepEqual(results[0],results[1]);assert.equal(results[0].published,1);
      assert.equal((await c.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n,1);
      assert.equal((await c.query("select count(*)::int n from employer_audit where action='feed_refreshed'")).rows[0].n,1);
    });
  }finally{await admin.query(`drop database if exists ${template} with (force)`);await admin.end();}
});
