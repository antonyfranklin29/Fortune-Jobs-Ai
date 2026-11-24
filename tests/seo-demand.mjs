import {test} from 'node:test';
import assert from 'node:assert/strict';
import {entryEvidence} from '../jobs/levels.mjs';
import {planRemote,isRemote,planEntry,planSalary,salaryStats} from '../jobs/demand.mjs';
import {renderDemand} from '../scripts/build-job-seo.mjs';
const date='2026-11-24',now=Date.parse(date+'T12:00:00Z'),roles=[{id:'software-engineer',name:'Software Engineer'}];
const row=(i,patch={})=>({id:i+1,job_title:'Software Engineer',company:'Example '+i,location:'Austin, TX',state_code:'TX',canonical_role:'software-engineer',country:'us',posted_at:date,apply_url:'https://whatjobs.test/'+i+'?sig=a%2fb+X',source:'whatjobs',is_remote:true,...patch});
test('remote matcher and exact hub/role thresholds use distinct open jobs',()=>{
 assert(isRemote({work_mode:'Remote - US only'}));assert(!isRemote({work_mode:'Hybrid'}));
 assert.equal(planRemote(Array.from({length:9},(_,i)=>row(i)),roles,now,date).length,0);
 const pages=planRemote(Array.from({length:25},(_,i)=>row(i)),roles,now,date);assert.equal(pages.length,2);
 const html=renderDemand(pages[1],date);assert(html.includes('Remote Software Engineer jobs'));assert(html.includes('limited to certain states'));assert(!html.includes('JobPosting'));
 assert(html.includes('https://whatjobs.test/24?sig=a%2fb+X'));
});
export {row,roles,date,now};

test('entry matcher honours explicit evidence and excludes senior associate and associate director',()=>{
 for(const title of ['Entry-level Data Analyst','Junior Engineer','Jr. Data Analyst','New Grad Software Engineer','Graduate Engineer','Associate Analyst','Early Career Developer','Apprentice Developer','Software Engineering Intern','Internship - Analyst'])assert(entryEvidence({job_title:title}).entry,title);
 for(const title of ['Senior Associate','Associate Director','Senior Software Engineer','Graduate Program Director','Principal Analyst','Staff Engineer'])assert(!entryEvidence({job_title:title,job_description:'0–2 years'}).entry,title);
 assert(entryEvidence({job_title:'Engineer',job_description:'Requires 0–2 years of experience.'}).years);
 assert(entryEvidence({job_title:'Engineer',job_description:'No experience required.'}).noExperience);
 assert(!entryEvidence({job_title:'Engineer',job_description:'Requires 5 years; no experience with Rust required.'}).entry);
});
test('entry pages require five non-internships, label internships separately and include role/state slices',()=>{
 const rows=Array.from({length:5},(_,i)=>row(i,{job_title:'Junior Software Engineer'}));
 const intern=row(90,{job_title:'Software Engineering Intern'}),regions=[{code:'TX',name:'Texas'}];
 assert.equal(planEntry([...rows.slice(0,4),intern],roles,regions,now,date).length,0);
 const pages=planEntry([...rows,intern],roles,regions,now,date);assert.equal(pages.length,3);assert.equal(pages[0].count,5);assert.equal(pages[0].internships,1);
 const html=renderDemand(pages[2],date);assert(html.includes('internship-label'));assert(html.includes('5 open entry-level and new-grad'));
 assert(pages.some(page=>page.path==='/jobs/entry-level/software-engineer/texas/'));
});


test('salary pages use eight same-unit listings and report medians without invented ranges',()=>{
 const rows=Array.from({length:8},(_,i)=>row(i,{salary:'$'+(60000+i*10000)+'/year',company:i<2?'Repeated employer':'Employer '+i}));
 assert.equal(planSalary(rows.slice(0,7),roles,[{code:'TX',name:'Texas'}],now,date).length,0);
 const pages=planSalary(rows,roles,[{code:'TX',name:'Texas'}],now,date);assert.equal(pages.length,3);
 const stats=salaryStats(rows,'software-engineer');assert.equal(stats.median,95000);assert.equal(stats.low,77500);assert.equal(stats.high,112500);assert.equal(stats.employers.length,1);
 const html=renderDemand(pages[2],date);assert(html.includes('not a salary survey'));assert(html.includes('Highest listed employer medians'));assert(!html.includes('How does remote pay compare'));
 const narrow=planSalary(rows.map(job=>({...job,salary:'$100,000/year'})),roles,[],now,date)[1];assert(narrow.answer.includes('about $100,000 a year'));assert(!narrow.answer.includes('$100,000–$100,000'));
});
