import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jobTags, careRole, matchesJobTags } from '../react/src/shared/jobTags.js';
import { planPages, addSitemapUrls } from '../scripts/build-job-seo.mjs';
import { PGlite } from '@electric-sql/pglite';
const cfg=JSON.parse(readFileSync('config/job-roles.json'));
test('tags use explicit shift, license, salary and specialty evidence',()=>{
 const tags=jobTags({job_title:'RN - Night Shift ICU',job_description:'Registered Nurse. Med-Surg experience.',salary:'$38–45/hr'});
 assert.deepEqual(tags.shift,['Night']);assert.deepEqual(tags.license,['RN']);assert.ok(tags.specialty.includes('ICU'));assert.equal(tags.pay[0],'$38–45/hr');
 assert.deepEqual(jobTags({job_title:'Software Engineer',job_description:'SQL or Python. Flexible schedule.',salary:'$100,000/year'}),{shift:[],license:[],specialty:[],pay:[]});
 assert.deepEqual(jobTags({job_title:'Driver',job_description:'No CDL-A required.'}).license,[]);
 assert.ok(jobTags({job_title:'Local CDL-A driver'}).specialty.includes('Local'));
 assert.equal(careRole('night shift nurse').id,'registered-nurse');assert.equal(careRole('CDL driver').id,'cdl-truck-driver');
 assert.equal(matchesJobTags({job_title:'RN Night Shift'},{shift:'Day'}),false);
});
test('healthcare state pages require five distinct open jobs',()=>{
 const rows=Array.from({length:5},(_,i)=>({id:i+1,job_title:'Registered Nurse',company:'Fixture',location:'Atlanta, GA',state_code:'GA',canonical_role:'registered-nurse',country:'us',closed_at:null,posted_at:new Date().toISOString(),apply_url:'https://example.com/'+i}));
 const regions=[{code:'GA',name:'Georgia'}];
 assert.equal(planPages(rows.slice(0,4),cfg.roles,regions,Date.now()).statePages.length,0);
 const result=planPages(rows,cfg.roles,regions,Date.now());assert.equal(result.statePages.length,1);
 assert.ok(addSitemapUrls('<urlset></urlset>',['/jobs/registered-nurse/georgia/']).includes('/jobs/registered-nurse/georgia/'));
 assert.ok(result.cityPages.filter(page=>page.target.role==='registered-nurse').every(page=>page.rows.length>=5));
});
test('count RPCs expose visible positive groups and actual neighbouring states',async()=>{
 const db=new PGlite();try {
 await db.exec('create role anon;create role authenticated;create table pre_scraped_jobs(canonical_role text,state_code text,job_title text,country text,closed_at timestamptz,expires_at timestamptz);');
 await db.exec(readFileSync('migrations/pending/20261122_catalogue_discovery.sql','utf8'));
 await db.exec("insert into pre_scraped_jobs values ('registered-nurse','SC','RN','us',null,null),('licensed-practical-nurse','GA','LPN','us',null,null),('registered-nurse','CA','RN','us',null,null)");
 const counts=(await db.query('select * from catalogue_category_counts()')).rows;assert.equal(Number(counts[0].open_jobs),3);
 const rows=(await db.query("select * from catalogue_search_alternatives('registered-nurse','GA')")).rows;
 assert.ok(rows.some(r=>r.kind==='state'&&r.state==='SC'));assert.ok(!rows.some(r=>r.state==='CA'));
 assert.ok(rows.some(r=>r.kind==='role'&&r.role_name==='Licensed Practical Nurse'));assert.ok(rows.every(r=>Number(r.open_jobs)>0));
 }finally{await db.close();}
});
