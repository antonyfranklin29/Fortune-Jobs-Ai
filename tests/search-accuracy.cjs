const assert=require('node:assert/strict');
const {test}=require('node:test');
const a=require('../search-accuracy.js');
const now=Date.parse('2026-10-10T12:00:00Z');
const job={job_title:'Software Engineer',company:'Acme',location:'New York, NY 10017',apply_url:'https://employer.example/jobs/123',country:'us'};
const meta={id:'123',location:{city:'New York',country:'US',stateName:'New York State'},dates:{posted:'2026-10-09T12:00:00Z'},classification:{jobType:['Full-time']},workArrangement:{isRemote:false},requirements:{experienceLevel:'Entry level'}};
const sourced={...job,source_metadata:JSON.stringify(meta)};
test('a New York search rejects Yorkville, Edmeston and state-only listings',()=>{
  for(const location of ['Yorkville, NY','Edmeston, NY','New York State','Remote']) assert.equal(a.matches({...job,location},'software engineer',{location:'New York'}),false);
  assert.equal(a.matches(sourced,'software engineer',{city:'New York',region:'New York',country:'us'}),true);
});
test('city aliases match, but nearby or similarly named cities do not',()=>{
  assert.equal(a.locationMatches({...job,location:'Bengaluru, Karnataka'},{location:'Bangalore'},{}),true);
  assert.equal(a.locationMatches({...job,location:'New York Mills, NY'},{location:'New York'},{}),false);
  assert.equal(a.locationMatches(job,{city:'New York City'},{}),true);
});
test('country filters reject another country and unknown eligibility for remote work',()=>{
  assert.equal(a.matches({...job,country:'ca'},'software engineer',{country:'us'}),false);
  assert.equal(a.matches({...job,country:'',location:'Remote',is_remote:true},'software engineer',{country:'us'}),false);
  assert.equal(a.matches(sourced,'software engineer',{country:'US'}),true);
});
test('title relevance uses whole words and does not match a keyword in company text',()=>{
  assert.equal(a.titleMatches('Financial Analyst','AI'),false);
  assert.equal(a.matches({...job,job_title:'Accountant',company:'Software Engineer Inc'},'software engineer'),false);
  assert.equal(a.titleMatches('Mechanical Engineer','software engineer'),false);
  assert.equal(a.titleMatches('Full Time Mechanical Engineer','software engineer'),false);
  assert.equal(a.titleMatches('Backend Engineer','software engineer'),true);
  assert.equal(a.titleMatches('Senior Software Engineer','junior software engineer'),false);
  assert.equal(a.titleMatches('PowerBI Developer','Power BI Developer'),true);
});
test('company, job type and experience must all match original listing evidence',()=>{
  assert.equal(a.matches(sourced,'software engineer',{company:'Acme',job_type:'fulltime',experience:'entry'},now),true);
  for(const filters of [{company:'Other'},{job_type:'contract'},{experience:'director'}]) assert.equal(a.matches(sourced,'software engineer',filters,now),false);
  assert.equal(a.matches(job,'software engineer',{job_type:'fulltime'},now),false);
});
test('unknown work setting is not automatically treated as onsite',()=>{
  assert.equal(a.matches(sourced,'software engineer',{work_mode:'onsite'},now),false);
  const hybrid={...job,source_metadata:{...meta,meta:{workSetting:['Hybrid work']},workArrangement:{isRemote:true}}};
  assert.equal(a.matches(hybrid,'software engineer',{work_mode:'remote'},now),false);
  assert.equal(a.matches(hybrid,'software engineer',{work_mode:'hybrid'},now),true);
});
test('date filter uses posting time, rejects stale or unknown dates and expired jobs',()=>{
  assert.equal(a.matches(sourced,'software engineer',{date_posted:'3'},now),true);
  assert.equal(a.matches({...job,created_at:'2026-10-10',posted_at:'2026-09-01'},'software engineer',{date_posted:'7'},now),false);
  assert.equal(a.matches(job,'software engineer',{date_posted:'7'},now),false);
  assert.equal(a.matches({...job,posted_at:'2030-01-01'},'software engineer',{date_posted:'7'},now),false);
  assert.equal(a.matches({...job,source_metadata:{...meta,dates:{validThrough:'2026-10-09'}}},'software engineer',{},now),false);
});
test('tracking-only URL differences and source listing IDs are deduplicated',()=>{
  const rows=[sourced,{...sourced,apply_url:job.apply_url+'?utm_source=another'}, {...sourced,apply_url:'https://another.example/job/123'}];
  assert.equal(a.filterJobs(rows,'software engineer',{},now).length,1);
  assert.equal(a.canonicalUrl('https://www.indeed.com/viewjob?jk=abc&from=x'),a.canonicalUrl('https://uk.indeed.com/viewjob?jk=abc'));
  assert.equal(a.filterJobs([job,{...job,apply_url:'https://employer.example/jobs/456'}],'software engineer').length,2);
  assert.notEqual(a.canonicalUrl('https://employer.example/careers#/job/123'),a.canonicalUrl('https://employer.example/careers#/job/456'));
});
test('invalid URLs and malformed metadata cannot bypass filters',()=>{
  for(const apply_url of ['javascript:alert(1)','not-a-url','https://user:pass@example.com/job']) assert.equal(a.matches({...job,apply_url},'software engineer'),false);
  assert.equal(a.matches({...job,country:'',source_metadata:'{broken'},'software engineer',{country:'us'}),false);
});
