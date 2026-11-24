import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planRemote,isRemote} from '../jobs/demand.mjs';
import {renderDemand} from '../scripts/build-job-seo.mjs';
const date='2026-11-24',now=Date.parse(date+'T12:00:00Z'),roles=[{id:'software-engineer',name:'Software Engineer'}];
const row=(i,patch={})=>({id:i+1,job_title:'Software Engineer',company:'Example '+i,location:'Austin, TX',state_code:'TX',canonical_role:'software-engineer',country:'us',posted_at:date,apply_url:'https://whatjobs.test/'+i+'?sig=a%2fb+X',source:'whatjobs',is_remote:true,...patch});
test('remote matcher and exact hub/role thresholds use distinct open jobs',()=>{
 assert(isRemote({work_mode:'Remote - US only'}));assert(!isRemote({work_mode:'Hybrid'}));
 assert.equal(planRemote(Array.from({length:9},(_,i)=>row(i)),roles,now,date).length,0);
 const pages=planRemote(Array.from({length:25},(_,i)=>row(i)),roles,now,date);assert.equal(pages.length,2);
 const html=renderDemand(pages[1],date);assert(html.includes('Remote Software Engineer jobs'));assert(html.includes('limited to certain states'));assert(!html.includes('JobPosting'));
 assert(html.includes('https://whatjobs.test/0?sig=a%2fb+X'));
});
export {row,roles,date,now};
