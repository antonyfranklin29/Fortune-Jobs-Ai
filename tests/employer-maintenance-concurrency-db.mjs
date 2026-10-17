// Disposable local PostgreSQL only. Independent sessions prove worker/cleanup lock ordering.
import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';
import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const {files}=createRequire(import.meta.url)('../scripts/build-employer-backend.cjs');
const enabled=process.env.FJ_PG_DISPOSABLE==='1'&&['127.0.0.1','localhost','::1'].includes(process.env.PGHOST);
async function connect(database){const c=new pg.Client({database,connectionTimeoutMillis:3000,query_timeout:15000,statement_timeout:12000});await c.connect();return c;}
const rpc=async(c,fn,args=[]) => (await c.query(`select ${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args)).rows[0].v;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitLock(c,session){for(let i=0;i<160;i++){
  if((await c.query("select wait_event_type='Lock' b from pg_stat_activity where pid=$1",[session.processID])).rows[0]?.b)return;await delay(25);
}throw Error('required lock interleaving was not observed');}
const snapshot=()=>({id:'synthetic',status:'approved',enabled:true,authorization_expires_at:new Date(Date.now()+86400000).toISOString()});
test('bounded maintenance and worker races on native PostgreSQL',{skip:!enabled,timeout:90000},async t=>{
  const admin=await connect('postgres'),template='fj_maint_tpl_'+process.pid;let seq=0;
  try{
    await admin.query(`create database ${template}`);const base=await connect(template);
    try{
      for(const p of ['tests/sql/supabase-shim.sql','migrations/20261015_ingest_taxonomy.sql','migrations/20261015_ingest_catalogue.sql','migrations/20261015_ingest_feed.sql',...files.map(f=>'migrations/pending/'+f)])
        await base.query(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
      await base.query('update employer_maintenance_control set cleanup_enabled=true');
    }finally{await base.end();}
    async function scenario(name,fn){await t.test(name,async()=>{
      const db='fj_maint_case_'+process.pid+'_'+(++seq);await admin.query(`create database ${db} template ${template}`);
      const cs=await Promise.all([connect(db),connect(db),connect(db),connect(db)]);const id=randomUUID();
      try{
        await cs[0].query(`insert into employer_feed_runs(id,source_id,source_revision,source_snapshot,status,started_at,lease_expires_at,finished_at,accepted)
          values($1,'synthetic',1,'{"permission_ref":"fixture-only"}','staged',now()-interval '31 days',now()-interval '31 days',now()-interval '31 days',1);
          `,[id]);
        await cs[0].query("insert into employer_feed_leases(source_id,run_id,token,expires_at) values('synthetic',$1,$2,now()-interval '31 days')",[id,randomUUID()]);
        await cs[0].query("insert into employer_feed_staging(run_id,source_listing_id,payload) values($1,'synthetic:old','{}')",[id]);
        await fn(...cs,id);
      }finally{await Promise.allSettled(cs.map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));await admin.query(`drop database ${db} with (force)`);}
    });}
    await scenario('a worker holding the source lease prevents cleanup of its older run',async(c,worker,cleanup,unused,id)=>{
      await worker.query('begin');const lease=await rpc(worker,'employer_feed_run_begin',['synthetic',1,snapshot()]);assert.equal(lease.status,'claimed');
      const result=await rpc(cleanup,'employer_maintenance_run',[true,25]);assert.equal(result.payloads_removed,0);assert.equal(result.runs_removed,0);
      await worker.query('commit');assert.equal((await c.query('select count(*)::int n from employer_feed_runs where id=$1',[id])).rows[0].n,1);
    });
    await scenario('a locked old run is skipped without waiting or deleting its payload',async(c,worker,cleanup,unused,id)=>{
      await worker.query('begin');await worker.query('select 1 from employer_feed_runs where id=$1 for update',[id]);
      const result=await rpc(cleanup,'employer_maintenance_run',[true,25]);assert.equal(result.payloads_removed,0);assert.equal(result.runs_removed,0);
      await worker.query('commit');assert.equal((await c.query('select count(*)::int n from employer_feed_staging')).rows[0].n,1);
    });
    await scenario('cleanup finishes before a waiting worker; the new lease and run survive, and another cleanup is busy',async(c,worker,cleanup,park,id)=>{
      await c.query(`create function fixture_maintenance_pause() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(424311);return old;end$$;
        create trigger fixture_maintenance_pause before delete on employer_feed_staging for each row execute function fixture_maintenance_pause();`);
      await park.query('select pg_advisory_lock(424311)');
      const pruning=rpc(cleanup,'employer_maintenance_run',[true,25]);await waitLock(c,cleanup);
      assert.equal((await rpc(c,'employer_maintenance_run',[true,25])).status,'busy');
      const starting=rpc(worker,'employer_feed_run_begin',['synthetic',1,snapshot()]);await waitLock(c,worker);
      await park.query('select pg_advisory_unlock(424311)');const [pruned,started]=await Promise.all([pruning,starting]);
      assert.equal(pruned.runs_removed,1);assert.equal(started.status,'claimed');
      assert.equal((await c.query('select run_id from employer_feed_leases')).rows[0].run_id,started.run_id);
      assert.equal((await c.query('select status from employer_feed_runs where id=$1',[started.run_id])).rows[0].status,'collecting');
    });
  }finally{await admin.query(`drop database if exists ${template} with (force)`);await admin.end();}
});
