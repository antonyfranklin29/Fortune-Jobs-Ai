import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createPartnerHandler} from '../supabase/functions/_shared/live-job-partner.mjs';
import {createPartnerAdmission,isObviousBot} from '../supabase/functions/_shared/partner-protection.mjs';
const req=(ua='Mozilla/5.0 Chrome/130.0')=>new Request('https://fixture.test',{method:'POST',headers:{origin:'https://fortunejobsai.com','x-forwarded-for':'203.0.113.9','user-agent':ua},body:JSON.stringify({q:'Nurse'})});
test('bots get empty success responses before provider calls',async()=>{
 let called=0;const handler=createPartnerHandler({getKey:()=> 'fixture',search:async()=>{called++;return[]}});
 for(const ua of ['curl/8','python-requests','HeadlessChrome','Googlebot','Playwright']){assert(isObviousBot(ua));const r=await handler(req(ua));assert.equal(r.status,200);assert.deepEqual(await r.json(),{jobs:[]});}assert.equal(called,0);
});
test('thirty searches are admitted per ten-minute burst window',async()=>{
 let clock=0,called=0;const handler=createPartnerHandler({getKey:()=> 'fixture',now:()=>clock,search:async()=>{called++;return[]}});
 for(let i=0;i<31;i++)await handler(req());assert.equal(called,30);clock=600000;await handler(req());assert.equal(called,31);
});
test('persistent admission transmits a keyed hash and fails closed',async()=>{
 const env={SUPABASE_URL:'https://fixture.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-private-key'};
 let body;const admit=createPartnerAdmission({getEnv:k=>env[k],fetchImpl:async(_u,init)=>{body=JSON.parse(init.body);return Response.json(true)}});
 assert.equal(await admit('203.0.113.9'),true);assert.match(body.p_hash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(body).includes('203.0.113.9'));
 assert.equal(await createPartnerAdmission({getEnv:k=>env[k],fetchImpl:async()=>{throw Error('offline')}})('203.0.113.9'),false);
});
test('persistent SQL limit rolls over atomically and hides counters from visitors',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role;create table saved_jobs(id int);');
 await db.exec(readFileSync('migrations/20261122_partner_clicks.sql','utf8'));
 await db.exec(readFileSync('migrations/20261122_partner_search_limits.sql','utf8'));
 const hash='a'.repeat(64),admit=()=>db.query('select partner_search_admit($1) as allowed',[hash]);
 await db.exec('set role anon');await assert.rejects(admit(),/permission denied/);await db.exec('reset role;set role service_role');
 for(let i=0;i<30;i++)assert.equal((await admit()).rows[0].allowed,true);assert.equal((await admit()).rows[0].allowed,false);
 await db.exec("reset role;update partner_search_limits set started_at=now()-interval '11 minutes';set role service_role");assert.equal((await admit()).rows[0].allowed,true);
 await db.exec("reset role;set request.headers='{\"user-agent\":\"curl/8\"}';set role anon");
 const click=await db.query("select log_partner_click('jobg8','organic','search','',$1,'us') as ok",[hash]);assert.equal(click.rows[0].ok,false);
 }finally{await db.close()}
});
test('robots excludes live query permutations and keeps public job pages available',()=>{
 const text=readFileSync('robots.txt','utf8');assert.ok(text.includes('Disallow: /results.html?mode=live'));assert.ok(text.includes('Disallow: /results.html?*mode=live'));assert.ok(text.includes('Allow: /jobs/'));assert.ok(!text.includes('Disallow: /jobs/'));
});
