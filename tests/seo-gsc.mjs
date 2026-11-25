import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {generateKeyPairSync,verify} from 'node:crypto';
import {jwtAssertion,analyticsDay,normalizeRows,publicUrl,inspectionRow,collect,PROPERTY} from '../scripts/seo/gsc.mjs';
import {weeklyReport} from '../scripts/seo/weekly.mjs';import {run} from '../scripts/seo-gsc.mjs';
const url='https://fortunejobsai.com/jobs/data-analyst/raleigh-nc/';
test('JWT is locally signed, read-only and has the exact Google token audience',()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const value=jwtAssertion({type:'service_account',client_email:'seo@test-project.iam.gserviceaccount.com',token_uri:'https://oauth2.googleapis.com/token',private_key:privateKey.export({type:'pkcs8',format:'pem'})},1000000);
 const [h,b,s]=value.split('.'),payload=JSON.parse(Buffer.from(b,'base64url'));assert(payload.scope.endsWith('/webmasters.readonly'));assert.equal(payload.aud,'https://oauth2.googleapis.com/token');assert.equal(payload.exp-payload.iat,3600);assert(verify('RSA-SHA256',Buffer.from(h+'.'+b),publicKey,Buffer.from(s,'base64url')));
 assert.throws(()=>jwtAssertion({token_uri:'https://attacker.test'}));
});
test('public URL/query validation rejects private paths and query-string personal material',()=>{
 assert.equal(publicUrl(url),url);assert.equal(publicUrl(url+'?email=x'),null);assert.equal(publicUrl('https://fortunejobsai.com/profile.html'),null);assert.equal(publicUrl('https://evil.test/jobs/'),null);
 const rows=[{keys:['2026-11-20','data analyst',url],clicks:0,impressions:10,position:8},{keys:['2026-11-20','secret@example.com',url],clicks:0,impressions:1,position:1}];assert.equal(normalizeRows(rows,'2026-11-20').length,1);
});
test('analytics paginates 25k rows without changing positions or inventing missing rows',async()=>{
 const row={keys:['2026-11-20','data analyst',url],clicks:1,impressions:10,position:6.2};let calls=0;
 const data=await analyticsDay(async(kind,body)=>{assert.equal(kind,'analytics');assert.equal(body.dataState,'final');assert.equal(body.startRow,calls++*25000);return {rows:calls===1?Array(25000).fill(row):[]};},'2026-11-20');
 assert.equal(calls,2);assert.equal(data.rows.length,1);assert.equal(data.rows[0].position,6.2);assert.equal(data.bounded,false);
});
test('collector uses persisted reservations and breaks on permissions/quota errors',async()=>{
 const calls=[];const google=async(kind,body)=>{calls.push(kind);if(kind==='analytics')return {};assert.equal(body.siteUrl,PROPERTY);throw Object.assign(Error('permission'),{status:403});};
 const db=async(path,options)=>{if(path==='rpc/seo_replace_gsc_day'){assert.equal(options.body.p_rows.length,0);return 0;}if(path==='rpc/seo_claim_inspections')return [{url},{url:'https://fortunejobsai.com/jobs/'}];return [];};
 const result=await collect({google,db,urls:[url,'https://fortunejobsai.com/jobs/'],now:new Date('2026-11-24'),days:1,pause:async()=>{}});assert.equal(result.inspected,0);assert.equal(result.failed,1);assert.deepEqual(calls,['analytics','inspection']);
});
test('inspection history preserves first observed discovered date and resets after indexing',()=>{
 const initial={inspectionResult:{indexStatusResult:{coverageState:'Discovered - currently not indexed',googleCanonical:url+'?token=private'}}};
 const row=inspectionRow(url,initial,{discovered_since:'2026-11-01T00:00:00Z'},new Date('2026-11-24'));assert.equal(row.discovered_since,'2026-11-01T00:00:00Z');assert(!row.google_canonical.includes('?'));
 assert.equal(inspectionRow(url,{inspectionResult:{indexStatusResult:{coverageState:'Submitted and indexed'}}},row).discovered_since,null);
});
test('weekly reports use weighted positions and withhold incomplete new/lost comparisons',()=>{
 const rows=[{date:'2026-11-20',query:'data analyst',page:url,impressions:10,clicks:0,position:10},{date:'2026-11-21',query:'data analyst',page:url,impressions:30,clicks:1,position:6}];
 const report=weeklyReport(rows,[],[{date:'2026-11-20'},{date:'2026-11-21'}],new Date('2026-11-24'));assert(report.includes('| 7.0 |'));assert(report.includes('Withheld'));assert(!report.includes('lost ranking for'));
});
test('missing credentials skip before any network request and write an honest setup report',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fja-gsc-test-'));try{const result=await run({env:{},root,fetchImpl:()=>{throw Error('Network forbidden');}});assert.equal(result.status,'skipped');assert((await readFile(join(root,'docs/ops/seo-weekly.md'),'utf8')).includes('No external requests'));}finally{await rm(join(root,'docs/ops/seo-weekly.md'));}
});
test('SQL isolates GSC data, atomically replaces dates and caps repeated inspection claims at 300',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');await db.exec(readFileSync('migrations/pending/20261124_seo_gsc.sql','utf8'));
  await db.exec('set role anon');await assert.rejects(db.query('select * from seo_gsc_daily'),/permission denied/);await assert.rejects(db.query("select * from seo_claim_inspections('[]'::jsonb,300)"),/permission denied/);await db.exec('reset role');
  const day=(await db.query('select current_date::text date')).rows[0].date,row={date:day,query:'data analyst',page:url,clicks:1,impressions:10,position:8};
  await db.exec('set role service_role');await db.query('select seo_replace_gsc_day($1,$2::jsonb,1,false)',[day,JSON.stringify([row])]);
  await assert.rejects(db.query('select seo_replace_gsc_day($1,$2::jsonb,1,false)',[day,JSON.stringify([{...row,position:-1}])]));assert.equal((await db.query('select position from seo_gsc_daily')).rows[0].position,8);
  const urls=Array.from({length:500},(_,i)=>'https://fortunejobsai.com/jobs/role-'+i+'/');
  assert.equal((await db.query('select * from seo_claim_inspections($1::jsonb,300)',[JSON.stringify(urls)])).rows.length,300);assert.equal((await db.query('select * from seo_claim_inspections($1::jsonb,300)',[JSON.stringify(urls)])).rows.length,0);
  assert.equal((await db.query('select count(*)::int n from seo_inspection_requests')).rows[0].n,300);
 }finally{await db.close();}
});
