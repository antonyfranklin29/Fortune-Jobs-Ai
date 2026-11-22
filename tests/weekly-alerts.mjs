import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alertQuery,pickJobs,weeklyDue,alertJobKey} from '../supabase/functions/job-alerts/select.ts';
import {renderDigest,liveAlertUrl} from '../supabase/functions/job-alerts/digest.mjs';
const monday=Date.parse('2026-11-23T13:07:00Z');
const jobs=Array.from({length:12},(_,i)=>({job_title:'Data Analyst',company:'Fixture '+i,location:'Atlanta, GA',apply_url:'https://us.whatjobs.com/job?token='+i,posted_at:new Date(monday-3600000).toISOString()}));
test('weekly selects Monday and does not repeat last week’s job keys',()=>{
 assert.equal(weeklyDue('weekly',monday),true);assert.equal(weeklyDue('weekly',monday+86400000),false);
 const q=alertQuery({current_title:'Data Analyst',preferred_locations:['Georgia']},'weekly',monday);
 const selected=pickJobs(jobs,q,monday,[alertJobKey(jobs[0])]);assert.equal(selected.length,10);assert.ok(!selected.some(j=>j.company==='Fixture 0'));
});
test('digest has unsubscribe and tracked live links while partner URLs stay out of email',()=>{
 const unsubscribeUrl='https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/email-preferences?token=fixture';
 const mail=renderDigest({name:'Fixture',jobs,address:'1553 Route 27, Suite 1000, Somerset, NJ 08873',unsubscribeUrl,role:'Data Analyst',location:'Georgia'});
 assert.ok(mail.html.includes(unsubscribeUrl));assert.ok(mail.text.includes(unsubscribeUrl));
 assert.ok(mail.html.includes('See live jobs for Data Analyst'));assert.ok(mail.html.includes('utm_source=email'));
 assert.ok(!mail.html.includes('us.whatjobs.com'));assert.ok(!mail.text.includes('us.whatjobs.com'));
 const link=new URL(liveAlertUrl('Data Analyst','Georgia'));assert.equal(link.searchParams.get('mode'),'live');assert.equal(link.searchParams.get('utm_medium'),'alert');
 assert.equal((mail.html.match(/View opportunity/g)||[]).length,10);
});
