import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {PGlite} from '@electric-sql/pglite';
import {employerKey,socRole,planH1b} from '../jobs/h1b.mjs';import {renderDemand} from '../scripts/build-job-seo.mjs';
const roles=[{id:'data-analyst',name:'Data Analyst'}],regions=[{code:'NJ',name:'New Jersey'}],date='2026-11-24';
export const fixture=Array.from({length:6},(_,i)=>({employer_key:'example '+i+' inc',employer_name:'Example '+i+' Inc.',state_code:'NJ',soc_code:'15-2051',role_id:'data-analyst',fiscal_year:2026,certified_lcas:i+1,median_wage_annual:80000+i*1000,updated_at:date}));
test('joint SOC/title mapping is conservative and employer normalisation preserves legal entities',()=>{
 assert.equal(employerKey('A&B, Incorporated'),'a and b inc');assert.notEqual(employerKey('Example Inc'),employerKey('Example LLC'));assert.equal(socRole('15-2051.00','Data Analyst'),'data-analyst');assert.equal(socRole('15-2051','Analyst'),null);assert.equal(socRole('15-1252','Data Engineer'),'data-engineer');
});
test('H-1B pages need five employers and every page includes historical wording and the caveat',()=>{
 assert.equal(planH1b(fixture.slice(0,4),{latest_full_fy:2026},roles,regions,date).length,0);
 const pages=planH1b(fixture,{latest_full_fy:2026},roles,regions,date);assert.equal(pages.length,3);
 for(const model of pages){const html=renderDemand(model,date);assert(html.includes('filed H-1B Labor Condition Applications (LCAs) certified by the U.S. Department of Labor in FY2026'));assert(html.includes('guarantee sponsorship'));assert(html.includes('https://www.dol.gov/agencies/eta/foreign-labor/performance'));assert(!html.includes('JobPosting'));}
});
test('Python XLSX reader, quarterly dedup, data-minimisation and mapping tests pass',()=>{
 execFileSync(process.platform==='win32'?'python':'python3',['-m','unittest','discover','-s','tests/h1b','-p','test_*.py'],{stdio:'pipe'});
});
test('H-1B upload is atomic, visitor writes are refused, and history filtering runs before its result limit',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create table ingest_regions(code text primary key);insert into ingest_regions values('NJ');create table ingest_roles(id text primary key);insert into ingest_roles values('data-analyst');create table pre_scraped_jobs(id int,company text,canonical_role text,closed_at timestamptz,country text,search_text text,state_code text,location text,category text,source text,work_mode text,posted_at timestamptz,salary text);grant select on pre_scraped_jobs to anon;`);
 await db.exec(readFileSync('migrations/pending/20261124_h1b_employer_stats.sql','utf8'));
 const rpc=async(name,args)=>{const keys=Object.keys(args);return(await db.query('select '+name+'('+keys.map((k,i)=>k+'=>$'+(i+1)).join(',')+') as result',keys.map(k=>args[k]&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]))).rows[0].result;};
 const metadata={latest_full_fy:2026,current_fy:2027,source:'https://www.dol.gov/agencies/eta/foreign-labor/performance',source_files:[{url:'https://www.dol.gov/fixture.xlsx'}]};
 const token=await rpc('h1b_import_start',{p_metadata:metadata,p_count:6});await rpc('h1b_stage',{p_token:token,p_rows:fixture.slice(0,3)});await assert.rejects(rpc('h1b_import_finish',{p_token:token}),/incomplete_upload/);assert.equal((await db.query('select count(*)::int as n from h1b_employer_stats')).rows[0].n,0);
 await rpc('h1b_stage',{p_token:token,p_rows:fixture.slice(3)});assert.equal(await rpc('h1b_import_finish',{p_token:token}),6);await assert.rejects(rpc('h1b_import_finish',{p_token:null}),/lease_lost/);
 await rpc('h1b_pages_ready',{p_ready:true});
 await db.exec("insert into pre_scraped_jobs values(1,'Unmatched','data-analyst',null,'us','data analyst','NJ','Edison, NJ',null,'adzuna',null,now(),null),(2,'Example 0 Incorporated','data-analyst',null,'us','data analyst','NJ','Edison, NJ',null,'adzuna',null,now()-interval '1 day',null)");
 await db.exec('set role anon');await assert.rejects(rpc('h1b_import_start',{p_metadata:metadata,p_count:6}),/permission denied/);await assert.rejects(db.query('select token from h1b_data_state'),/permission denied/);
 const found=await db.query("select * from h1b_search_jobs('data analyst','{}',1)");assert.equal(found.rows.length,1);assert.equal(found.rows[0].id,2);
 const badges=await rpc('h1b_job_badges',{p_pairs:[{company:'Example 0 Incorporated',role_id:'data-analyst'}]});assert.equal(badges[0].fiscal_year,2026);
 }finally{await db.close()}
});
