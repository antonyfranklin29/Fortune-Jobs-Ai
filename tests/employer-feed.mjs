import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, REGIONS } from '../supabase/functions/job-ingest/config.mjs';
import { compileRoles, regionIndex } from '../supabase/functions/job-ingest/lib.mjs';
import * as E from '../supabase/functions/employer-feed/lib.mjs';
import { fetchApprovedFeed } from '../supabase/functions/employer-feed/fetch.mjs';
import { collectEmployerFeed } from '../supabase/functions/employer-feed/collect.mjs';

const now = new Date('2026-10-15T20:00:00Z');
const options = { now, roles: compileRoles(ROLES), idx: regionIndex(REGIONS) };
const source = (patch = {}) => ({
  id: 'synthetic-employer', adapter: 'greenhouse', board_token: 'synthetic', api_region: 'global',
  employer_name: 'Synthetic Employer', enabled: true, status: 'approved',
  rights_basis: 'employer_written_permission', permission_ref: 'private-fixture-evidence',
  approved_by: 'synthetic-reviewer', approved_at: '2026-10-14T12:00:00Z',
  domain_verified_at: '2026-10-14T12:00:00Z', authorization_expires_at: '2027-01-01T00:00:00Z',
  allow_display: true, allow_refresh: true, allow_description: false, attribution_text: '',
  allowed_apply_hosts: ['job-boards.greenhouse.io', 'careers.example.com'], ...patch,
});
const greenhouseJob = (patch = {}) => ({
  id: 123, internal_job_id: 456, title: 'Senior Data Analyst', location: { name: 'Raleigh, NC' },
  absolute_url: 'https://job-boards.greenhouse.io/synthetic/jobs/123',
  updated_at: '2026-10-15T18:00:00Z', content: '<p>Build reporting.</p>', ...patch,
});
const leverSource = () => source({ adapter: 'lever', allowed_apply_hosts: ['jobs.lever.co'] });
const leverJob = (patch = {}) => ({
  id: 'job-123', text: 'Data Analyst', country: 'US', categories: { location: 'Edison, NJ', commitment: 'Full-time' },
  applyUrl: 'https://jobs.lever.co/synthetic/job-123/apply', workplaceType: 'hybrid', descriptionPlain: 'Analyze data.', ...patch,
});

test('only reviewed, current permissions enable a source; blocked sources never fetch', async () => {
  let calls = 0;
  for (const patch of [
    {status:'pending'}, {enabled:false}, {rights_basis:'public_api'}, {permission_ref:''}, {approved_by:''},
    {allow_refresh:false}, {allow_display:false}, {authorization_expires_at:now.toISOString()},
    {approved_at:'2027-01-01T00:00:00Z'}, {domain_verified_at:null},
    {allowed_apply_hosts:['127.0.0.1']}, {allowed_apply_hosts:['foo.internal']},
    {attribution_text:'<img onerror=alert(1)>'}, {allow_description:undefined},
  ]) {
    await assert.rejects(fetchApprovedFeed(source(patch), { now, fetchImpl:async()=>{calls++;} }), /source_not_approved/);
  }
  assert.equal(calls, 0);
});

test('tenant-controlled paths cannot change the fixed feed host or inject query parameters', () => {
  assert.equal(E.feedUrl(source(), {now}), 'https://boards-api.greenhouse.io/v1/boards/synthetic/jobs?content=false');
  assert.equal(E.feedUrl(source({adapter:'lever',api_region:'eu'}), {now,offset:100,limit:50}),
    'https://api.eu.lever.co/v0/postings/synthetic?mode=json&skip=100&limit=50');
  for (const board_token of ['../secret', 'synthetic?redirect=evil', 'https://evil.example', 'synthetic/../../', ''])
    assert.throws(()=>E.feedUrl(source({board_token}), {now}), /source_not_approved/);
  assert.throws(()=>E.feedUrl(source(), {now, offset:1}), /invalid_page/);
  assert.throws(()=>E.feedUrl(leverSource(), {now, offset:0.5}), /invalid_page/);
});

test('application links require an approved exact host and the correct ATS tenant and posting', () => {
  for (const absolute_url of [
    'javascript:alert(1)', 'http://job-boards.greenhouse.io/synthetic/jobs/123',
    'https://job-boards.greenhouse.io.evil.example/synthetic/jobs/123',
    'https://job-boards.greenhouse.io/other-company/jobs/123',
    'https://job-boards.greenhouse.io/synthetic/jobs/999',
    'https://u:password@careers.example.com/jobs/123', 'https://careers.example.com:8443/jobs/123',
  ]) assert.equal(E.normalizeEmployerJob(greenhouseJob({absolute_url}), source(), options).reject, 'invalid_apply_url');
  assert.ok(E.normalizeEmployerJob(greenhouseJob({absolute_url:'https://careers.example.com/jobs/123'}), source(), options).row);
});

test('normalization preserves employer identity and never replaces update time with posting time', () => {
  const {row} = E.normalizeEmployerJob(greenhouseJob({company:'Impostor Employer'}), source(), options);
  assert.equal(row.company, 'Synthetic Employer'); assert.equal(row.state_code, 'NC');
  assert.equal(row.canonical_role, 'data-analyst'); assert.equal(row.posted_at, null);
  assert.equal(row.source, 'employer_feed'); assert.equal(row.source_listing_id, 'synthetic-employer:123');
  assert.equal(row.employer_source_id, 'synthetic-employer'); assert.equal(row.salary, null);
  assert.equal(row.job_description, null); assert.equal(row.attribution, null);
  assert.equal(E.normalizeEmployerJob(greenhouseJob({first_published:'2026-10-12T12:00:00Z'}), source(), options).row.posted_at,
    '2026-10-12T12:00:00.000Z');
});

test('an authorized source does not invent states, accept expired jobs or treat prospects as vacancies', () => {
  for (const location of ['Remote, United States', 'Vancouver, BC', 'London', 'Raleigh, NC; Austin, TX'])
    assert.ok(E.normalizeEmployerJob(greenhouseJob({location:{name:location}}), source(), options).reject);
  assert.equal(E.normalizeEmployerJob(greenhouseJob({country:'CA'}), source(), options).reject, 'other_country');
  assert.equal(E.normalizeEmployerJob(greenhouseJob({application_deadline:'2026-10-14T00:00:00Z'}), source(), options).reject, 'expired');
  assert.equal(E.normalizeEmployerJob(greenhouseJob({internal_job_id:null}), source(), options).reject, 'not_a_vacancy');
  assert.equal(E.normalizeEmployerJob(greenhouseJob({title:'Data Entry Clerk'}), source(), options).reject, 'no_role');
});

test('Lever uses documented location and workplace evidence, with no invented posting date', () => {
  const {row} = E.normalizeEmployerJob(leverJob({createdAt:now.getTime()}), leverSource(), options);
  assert.equal(row.state_code, 'NJ'); assert.equal(row.work_mode, 'hybrid');
  assert.equal(row.employment_type, 'Full-time'); assert.equal(row.posted_at, null);
  assert.equal(row.source_listing_id, 'synthetic-employer:job-123');
});

test('descriptions are optional plain text and required attribution is preserved', () => {
  const {row} = E.normalizeEmployerJob(greenhouseJob({content:'<script>evil()</script><p>Analyze &amp; report.</p>'}),
    source({allow_description:true, attribution_text:'Courtesy of Synthetic Employer'}), options);
  assert.equal(row.job_description, 'Analyze & report.');
  assert.equal(row.attribution, 'Courtesy of Synthetic Employer');
});

test('invalid/truncated responses and duplicate posting IDs cannot look like a complete feed', () => {
  assert.throws(()=>E.normalizeEmployerFeed({jobs:[greenhouseJob()],meta:{total:3}},source(),options), /incomplete_or_invalid_feed/);
  assert.throws(()=>E.unpackFeed({jobs:[],meta:{total:0}},'unknown'), /incomplete_or_invalid_feed/);
  assert.throws(()=>E.normalizeEmployerFeed({jobs:[greenhouseJob(),greenhouseJob()],meta:{total:2}},source(),options), /duplicate_source_id/);
  const complete = E.normalizeEmployerFeed({jobs:[greenhouseJob()],meta:{total:1}},source(),options);
  assert.equal(complete.rows.length,1); assert.equal(complete.enumeration_complete,true);
  assert.equal(E.unpackFeed([leverJob()],'lever',1).enumeration_complete,false);
  assert.equal(E.unpackFeed([],'lever',1).enumeration_complete,true);
});

test('transport sends only a GET to the pinned host and rejects redirects, HTML and bad JSON', async () => {
  let request;
  const payload = await fetchApprovedFeed(source(), { now, fetchImpl:async(url, init)=>{
    request={url,init}; return Response.json({jobs:[],meta:{total:0}});
  }});
  assert.equal(payload.meta.total,0); assert.equal(request.init.method,'GET');
  assert.equal(request.init.redirect,'error'); assert.equal(request.init.credentials,'omit');
  assert.deepEqual(request.init.headers,{accept:'application/json'}); assert.equal(request.init.body,undefined);
  for (const response of [new Response('',{status:302,headers:{location:'http://127.0.0.1'}}),
    new Response('<html>sign in</html>',{headers:{'content-type':'text/html'}}),
    new Response('{bad',{headers:{'content-type':'application/json'}})])
    await assert.rejects(fetchApprovedFeed(source(), {now,fetchImpl:async()=>response}));
});

test('oversized responses are rejected even when Content-Length is missing', async () => {
  const huge = new Response(' '.repeat(2*1024*1024+1),{headers:{'content-type':'application/json'}});
  await assert.rejects(fetchApprovedFeed(source(),{now,fetchImpl:async()=>huge}),/feed_too_large/);
  const claimedHuge = new Response('{}',{headers:{'content-type':'application/json','content-length':'9999999'}});
  await assert.rejects(fetchApprovedFeed(source(),{now,fetchImpl:async()=>claimedHuge}),/feed_too_large/);
});

const collectorOptions = (patch = {}) => ({
  ...options, now:()=>now, loadSource:async()=>({source:leverSource(),revision:1}), ...patch,
});
const leverPage = (offset, count) => Array.from({length:count},(_,i)=>leverJob({
  id:`job-${offset+i}`,applyUrl:`https://jobs.lever.co/synthetic/job-${offset+i}/apply`,
}));

test('collector enumerates bounded Lever pages and reports exact accepted counts without publishing', async () => {
  const offsets=[];
  const result=await collectEmployerFeed('synthetic-employer',collectorOptions({fetchPage:async(s,p)=>{
    offsets.push(p.offset); return p.offset===0 ? leverPage(0,100) : leverPage(100,1);
  }}));
  assert.deepEqual(offsets,[0,100]); assert.equal(result.status,'complete');
  assert.equal(result.rows.length,101); assert.equal(result.received,101);
  assert.equal(result.requests_used,2); assert.equal(result.enumeration_complete,true);
  assert.equal(result.reconcile_candidate,true); assert.equal(result.next_offset,null);
});

test('collector stops at its request budget and never calls a full page a completed sweep', async () => {
  let calls=0;
  const result=await collectEmployerFeed('synthetic-employer',collectorOptions({maxRequests:1,fetchPage:async()=>{calls++;return leverPage(0,100);}}));
  assert.equal(calls,1); assert.equal(result.status,'partial'); assert.equal(result.reason,'request_budget');
  assert.equal(result.enumeration_complete,false); assert.equal(result.reconcile_candidate,false);
  assert.equal(result.next_offset,100);
});

test('collector rejects pending sources before network access and checks approval again after fetch', async () => {
  let calls=0, revoked=false;
  const loader=async()=>({source:source({status:revoked?'revoked':'approved'}),revision:1});
  const result=await collectEmployerFeed('synthetic-employer',collectorOptions({loadSource:loader,fetchPage:async()=>{
    calls++; revoked=true; return {jobs:[greenhouseJob()],meta:{total:1}};
  }}));
  assert.equal(calls,1); assert.equal(result.status,'failed'); assert.equal(result.reason,'source_not_approved');
  assert.deepEqual(result.rows,[]); assert.equal(result.reconcile_candidate,false);
  calls=0;
  const pending=await collectEmployerFeed('synthetic-employer',collectorOptions({
    loadSource:async()=>({source:source({status:'pending'}),revision:1}),fetchPage:async()=>{calls++;},
  }));
  assert.equal(calls,0); assert.equal(pending.requests_used,0);
});

test('a registry change or expired permission during a fetch invalidates its response', async () => {
  let changed=false;
  const result=await collectEmployerFeed('synthetic-employer',collectorOptions({
    loadSource:async()=>({source:source({employer_name:changed?'Different Employer':'Synthetic Employer'}),revision:1}),
    fetchPage:async()=>{changed=true;return{jobs:[greenhouseJob()],meta:{total:1}};},
  }));
  assert.equal(result.reason,'source_changed'); assert.deepEqual(result.rows,[]);
  let clock=now;
  const expired=await collectEmployerFeed('synthetic-employer',collectorOptions({
    now:()=>clock,fetchPage:async()=>{clock=new Date('2027-01-01T00:00:00Z');return[];},
  }));
  assert.equal(expired.reason,'source_not_approved'); assert.equal(expired.enumeration_complete,false);
});

test('a duplicate ID across pages fails the whole run rather than publishing inconsistent data', async () => {
  const result=await collectEmployerFeed('synthetic-employer',collectorOptions({fetchPage:async(s,p)=>
    p.offset===0 ? leverPage(0,100) : leverPage(99,1)}));
  assert.equal(result.reason,'duplicate_source_id'); assert.equal(result.status,'failed');
  assert.deepEqual(result.rows,[]); assert.equal(result.reconcile_candidate,false);
});

test('exactly 500 records require an empty terminal page; additional records exceed the cap', async () => {
  for (const extra of [0,1]) {
    const result=await collectEmployerFeed('synthetic-employer',collectorOptions({maxRequests:6,
      fetchPage:async(s,p)=>leverPage(p.offset,p.offset===500?extra:100),
    }));
    assert.equal(result.requests_used,6);
    if(extra){assert.equal(result.reason,'job_limit');assert.deepEqual(result.rows,[]);}
    else {assert.equal(result.status,'complete');assert.equal(result.rows.length,500);}
  }
});

test('collector distinguishes filtered rows from a clean reconciliation and sanitizes failures', async () => {
  const filtered=await collectEmployerFeed('synthetic-employer',collectorOptions({fetchPage:async()=>[
    leverJob(),leverJob({id:'unrelated',text:'Data Entry Clerk'}),
  ]}));
  assert.equal(filtered.status,'complete'); assert.equal(filtered.enumeration_complete,true);
  assert.equal(filtered.rows.length,1); assert.equal(filtered.rejected.no_role,1);
  assert.equal(filtered.reconcile_candidate,false);
  const failed=await collectEmployerFeed('synthetic-employer',collectorOptions({fetchPage:async()=>{throw Error('private-internal-key=fixture');}}));
  assert.equal(failed.reason,'feed_request_failed'); assert.ok(!JSON.stringify(failed).includes('private-internal-key'));
  assert.deepEqual(failed.rows,[]);
});

test('collector rejects an invalid registry identity and caller budgets before making requests', async () => {
  let calls=0;
  const invalid=await collectEmployerFeed('synthetic-employer',collectorOptions({
    loadSource:async()=>({source:source({id:'another-employer'}),revision:1}),fetchPage:async()=>{calls++;},
  }));
  assert.equal(calls,0); assert.equal(invalid.reason,'invalid_registry_record');
  for(const maxRequests of [0,7,1.5])
    await assert.rejects(collectEmployerFeed('synthetic-employer',collectorOptions({maxRequests})),/invalid_collection_options/);
});
