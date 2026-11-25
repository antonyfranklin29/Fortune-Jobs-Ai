import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
const load=()=>{const box={module:{exports:{}},URL,URLSearchParams};runInNewContext(readFileSync('source-tracking.js','utf8'),box);return box.module.exports;};
const sid='11111111-1111-4111-8111-111111111111',uid='22222222-2222-4222-8222-222222222222';
const context={id:sid,path:'/jobs/data-analyst/raleigh-nc/',referrer:'google.com',source:'organic',medium:'',campaign:''};
test('first landing wins within a tab, strips private URL material and honors privacy signals',()=>{
 const api=load(),data=new Map(),store={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 const env={crypto:{randomUUID:()=>sid},location:{pathname:context.path,search:'?email=secret@example.com'},document:{referrer:'https://www.google.com/search?q=private'},navigator:{}};
 const first=api.captureLanding(store,env);assert.equal(first.path,context.path);assert.equal(first.referrer,'google.com');
 env.location.pathname='/find-jobs.html';assert.equal(api.captureLanding(store,env).path,context.path);
 assert(!JSON.stringify([...data.values()]).includes('secret@example.com'));assert(!JSON.stringify(first).includes('private'));
 env.navigator.globalPrivacyControl=true;assert.equal(api.captureLanding(store,env),null);
 assert.equal(api.safePath('/jobs/jane-smith/email@example.com/'),'/other');assert.equal(api.safePath('/profile.html'),'/other');assert.equal(api.referrerBucket('https://private-client.example.com/user/secret'),'other');assert.equal(api.referrerBucket('https://chatgpt.com/c/abc'),'chatgpt.com');assert.equal(api.referrerBucket('https://gemini.google.com/app'),'gemini.google.com');assert.equal(api.referrerBucket('https://www.google.com/'),'google.com');
});
test('private funnel counts deduplicate and only real live Pro conversions count',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite();
 try{
  await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,created_at timestamptz default now(),raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table subscriptions(user_id uuid primary key references auth.users(id) on delete cascade,status text,livemode boolean,stripe_subscription_id text,current_period_end timestamptz);");
  await db.exec(readFileSync('migrations/pending/20261124_seo_funnel.sql','utf8'));
  await db.exec('set role anon');
  const landing=()=>db.query("select seo_log_funnel($1::jsonb,'landing',null) as ok",[JSON.stringify(context)]);
  assert.equal((await landing()).rows[0].ok,true);assert.equal((await landing()).rows[0].ok,true);
  await assert.rejects(db.query('select * from seo_funnel_weekly'),/permission denied/);await assert.rejects(db.query('select * from seo_funnel_sessions'),/permission denied/);
  assert.equal((await db.query("select seo_log_funnel($1::jsonb,'landing',null) as ok",[JSON.stringify({...context,path:'/jobs/private-person/'})])).rows[0].ok,false);
  const search=()=>db.query("select seo_log_funnel($1::jsonb,'search','33333333-3333-4333-8333-333333333333')",[JSON.stringify(context)]);await search();await search();
  await assert.rejects(db.query("select seo_attach_signup($1,$2::jsonb)",[uid,JSON.stringify(context)]),/permission denied/);await db.exec('reset role');
  await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)',[uid,JSON.stringify({seo_first_touch:context})]);
  assert.equal((await db.query('select count(*)::int n from seo_signup_attribution')).rows[0].n,1);
  await db.query("insert into subscriptions values($1,'active',false,'test_sub',now()+interval '1 month')",[uid]);
  assert.equal((await db.query('select count(*)::int n from seo_pro_conversions')).rows[0].n,0);
  await db.query("update subscriptions set livemode=true,stripe_subscription_id='live_sub' where user_id=$1",[uid]);await db.query("update subscriptions set status='canceled' where user_id=$1",[uid]);
  const row=(await db.query('select * from seo_funnel_weekly')).rows[0];assert.equal(Number(row.landing_sessions),1);assert.equal(Number(row.searches),1);assert.equal(Number(row.signups),1);assert.equal(Number(row.pro),1);
  await db.query('delete from auth.users where id=$1',[uid]);assert.equal((await db.query('select count(*)::int n from seo_signup_attribution')).rows[0].n,0);
 }finally{await db.close();}
});
