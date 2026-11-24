import React from 'react';import {afterEach,expect,it,vi} from 'vitest';import {cleanup,render,screen} from '@testing-library/react';
import {H1bBadge} from '../shared/H1bBadge.jsx';import {historyReadArgs,filterHistoryJobs} from '../shared/h1b.js';import {quickMatches} from './catalogue.js';import {liveSearch} from './liveSearch.js';import {workAuthorizationFilter} from './workAuthorization.js';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const config=()=>{window.FJ_CONFIG={url:'https://fixture-h1b.test',key:'public'};};
const job={company:'Example Incorporated',canonical_role:'data-analyst',job_title:'Data Analyst',country:'us',location:'Edison, NJ',posted_at:new Date().toISOString(),apply_url:'https://whatjobs.test/exact?sig=a%2fb+X',source:'whatjobs',closed_at:null};
it('badges use role-specific past filings and an employer row link, without a sponsorship promise',async()=>{
 config();vi.stubGlobal('fetch',vi.fn(async()=>Response.json([{employer_key:'example inc',role_id:'data-analyst',fiscal_year:2026}])));
 render(<H1bBadge job={job}/>);const badge=await screen.findByRole('link',{name:'Filed H-1B LCAs (FY2026)'});expect(badge.getAttribute('href')).toBe('/h1b/#employer-example-inc');expect(badge.title).toContain('does not guarantee');
});
it('history filter is applied in the database before the candidate limit, preserving state and source',async()=>{
 config();const requests=[];const fetchImpl=async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return Response.json([job]);};
 const rows=await quickMatches('Data Analyst',{sponsorship:'recent_h1b',location:'New Jersey',country:'us'},undefined,10,fetchImpl);
 expect(workAuthorizationFilter('recent_h1b')).toBe('recent_h1b');expect(rows).toHaveLength(1);expect(requests.every(call=>call.url.endsWith('/rpc/h1b_search_jobs'))).toBe(true);expect(requests[0].body.p_filters.state).toBe('NJ');expect(requests[0].body.p_limit).toBe(100);
 expect(requests.at(-1).body.p_filters.source).toBe('jobg8');
});
it('unavailable history does not silently return unfiltered jobs or call live providers',async()=>{
 config();const fetchImpl=vi.fn(async()=>new Response('{}',{status:404}));
 await expect(quickMatches('Analyst',{sponsorship:'recent_h1b'},undefined,10,fetchImpl)).rejects.toMatchObject({code:'H1B_UNAVAILABLE'});
 fetchImpl.mockClear();await expect(liveSearch({q:'Analyst',sponsorship:'recent_h1b'},null,undefined,fetchImpl)).rejects.toMatchObject({code:'H1B_UNAVAILABLE'});expect(fetchImpl).toHaveBeenCalledTimes(1);expect(fetchImpl.mock.calls[0][0]).toContain('/h1b_data_state?');
});
it('live history filter only keeps role/company matches and leaves partner URLs untouched',async()=>{
 config();const rows=await filterHistoryJobs([job,{...job,company:'Other LLC'}],undefined,async()=>Response.json([{employer_key:'example inc',role_id:'data-analyst',fiscal_year:2026}]));
 expect(rows).toHaveLength(1);expect(rows[0].apply_url).toBe(job.apply_url);
 const args=historyReadArgs(new URLSearchParams({canonical_role:'eq.data-analyst',source:'eq.jobg8',country:'eq.us'}));expect(args.p_filters.roles).toEqual(['data-analyst']);
});
