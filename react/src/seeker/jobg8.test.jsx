import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {quickMatches,promoteJobg8,safeApplyUrl} from './catalogue.js';
import {liveSearch} from './liveSearch.js';
import {JobDescription,JobList} from './JobViews.jsx';
import {savedJobRow} from './ResultsPage.jsx';
import {PartnerApply} from '../shared/PartnerApply.jsx';
const original='https://CLICK.example.test/apply?id=a%2fb+X&sig=One%20Two';
const make=(i,source='jobg8',score=90)=>({source,job_title:'Software Engineer',company:'Company '+i,location:'Edison, NJ',country:'us',posted_at:new Date().toISOString(),closed_at:null,apply_url:original+'&n='+i,job_description:'Build and test software.',search_score:score});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});

it('shows the full stored description without a second outbound description link or Jobg8 credit',()=>{
 const job={...make(1),job_description:'Complete responsibilities. '.repeat(100)};
 const {container}=render(<JobDescription job={job} description={job.job_description} url={original}/>);
 expect(container.textContent).toContain(job.job_description);expect(screen.queryByRole('button')).toBeNull();expect(screen.queryByRole('link')).toBeNull();
 render(<JobList jobs={[job]} selected={0} onSelect={()=>{}} profile={null}/>);
 expect(screen.getByText('Advertiser listing')).toBeTruthy();expect(screen.queryByText(/Jobs by Jobg8|Job source: Jobg8/)).toBeNull();
});

it('paid destinations appear only on a user click; WhatJobs bytes remain unchanged',()=>{
 const navigate=vi.spyOn(window.FJSourceTracking,'navigate').mockImplementation(()=>{});
 const {container}=render(<PartnerApply job={make(1)}>Apply now</PartnerApply>);
 expect(container.querySelector('a')).toBeNull();expect(navigate).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button'));expect(navigate.mock.calls[0][0].apply_url).toBe(original+'&n=1');
 expect(safeApplyUrl(original)).toBe(original);
});

it('promotes one comparable Jobg8 job into each four-result group without outranking a clearer match',()=>{
 const ordinary=Array.from({length:8},(_,i)=>make(i,'greenhouse',100));
 const ranked=[...ordinary,make(90,'jobg8',98),make(91,'jobg8',98)];
 const promoted=promoteJobg8(ranked);expect(promoted[3].source).toBe('jobg8');expect(promoted[7].source).toBe('jobg8');expect(promoted[0]).toBe(ordinary[0]);
 expect(promoteJobg8([...ordinary,make(92,'jobg8',40)])[3].source).toBe('greenhouse');
});

it('live blends stored Jobg8 first with WhatJobs, caps both plans and never requests an application URL',async()=>{
 window.FJ_CONFIG={url:'https://db.example.test',key:'fixture'};
 const providerUrl='https://whatjobs.example.test/go?sig=a%2fb+X';
 const calls=[];const fetchImpl=vi.fn(async url=>{
  calls.push(url);
  if(url.includes('/functions/v1/whatjobs-search'))return Response.json({jobs:[{title:'Software Engineer',company:'WhatJobs fixture company',location:'Edison, NJ',url:providerUrl}]});
  expect(url).toContain('/rest/v1/pre_scraped_jobs?');expect(new URL(url).searchParams.get('source')).toBe('eq.jobg8');
  return Response.json(Array.from({length:22},(_,i)=>make(i)));
 });
 const free=await liveSearch({q:'Software Engineer',location:'New Jersey'},null,undefined,fetchImpl,10);
 expect(free).toHaveLength(10);expect(free[0].source).toBe('jobg8');expect(free[1].apply_url).toBe(providerUrl);
 expect(await liveSearch({q:'Software Engineer'},null,undefined,fetchImpl,18)).toHaveLength(18);
 expect(calls.every(url=>url.startsWith(window.FJ_CONFIG.url))).toBe(true);
});

it('Quick Match considers older still-open feed jobs but respects title and city relevance',async()=>{
 window.FJ_CONFIG={url:'https://db.example.test',key:'fixture'};
 const jobs=[...Array.from({length:5},(_,i)=>make(i,'greenhouse')), {...make(100),posted_at:'2020-01-01T00:00:00Z'}];
 const fetchImpl=async url=>Response.json(new URL(url).searchParams.get('source')==='eq.jobg8' ? [jobs.at(-1)] : jobs.slice(0,10));
 const result=await quickMatches('Software Engineer',{location:'New Jersey'},undefined,10,fetchImpl);
 expect(result).toHaveLength(6);expect(result.filter(j=>j.source==='jobg8')).toHaveLength(1);
});

it('saving a long signed Jobg8 URL never truncates it',()=>{
 const url='https://click.example.test/?signature='+'x'.repeat(3000);
 expect(savedJobRow({...make(2),apply_url:url},'key').apply_url).toBe(url);
});
