import {employerKey,employerAnchor} from '../../../jobs/h1b.mjs';
import roles from '../../../config/job-roles.json' with {type:'json'};
export {employerKey};
export const historyRole = job => job.canonical_role || roles.roles.find(role=>role.include.some(p=>new RegExp(p,'i').test(job.job_title || '')) && !role.exclude.some(p=>new RegExp(p,'i').test(job.job_title || '')))?.id;
const unavailable=()=>Object.assign(new Error('H-1B filing history is not available yet. Try another work-authorization option or search without this filter.'),{code:'H1B_UNAVAILABLE'});
export async function historyMatches(jobs,signal,fetchImpl=fetch) {
 const config=window.FJ_CONFIG;if(!config)return [];
 const pairs=[...new Map(jobs.map(job=>({company:job.company,role_id:historyRole(job)})).filter(pair=>pair.company && pair.role_id).map(pair=>[employerKey(pair.company)+'|'+pair.role_id,pair])).values()];
 if(!pairs.length)return [];
 const response=await fetchImpl(config.url+'/rest/v1/rpc/h1b_job_badges',{method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':'application/json'},signal,body:JSON.stringify({p_pairs:pairs.slice(0,100)})});
 if(!response.ok)throw unavailable();const data=await response.json();return Array.isArray(data)?data:[];
}
export async function requireHistoryReady(signal,fetchImpl=fetch){
 const config=window.FJ_CONFIG;if(!config)throw unavailable();
 const response=await fetchImpl(config.url+'/rest/v1/h1b_data_state?select=pages_ready&singleton=eq.true',{signal,headers:{apikey:config.key,Authorization:'Bearer '+config.key}});
 if(!response.ok || !(await response.json())[0]?.pages_ready)throw unavailable();
}
export async function filterHistoryJobs(jobs,signal,fetchImpl=fetch){
 const matches=await historyMatches(jobs,signal,fetchImpl),keys=new Set(matches.map(row=>row.employer_key+'|'+row.role_id));
 return jobs.filter(job=>keys.has(employerKey(job.company)+'|'+historyRole(job))).map(job=>({...job,canonical_role:historyRole(job)}));
}
const cache=new Map(),queue=[];let scheduled=false;
export function badgeFor(job){
 if(!job?.canonical_role || !window.FJ_CONFIG)return Promise.resolve(null);
 const url=window.FJ_CONFIG.url,key=url+'|'+employerKey(job.company)+'|'+job.canonical_role,cached=cache.get(key);
 if(cached?.until>Date.now())return Promise.resolve(cached.value);
 return new Promise(resolve=>{
  queue.push({job,key,resolve});if(scheduled)return;scheduled=true;
  queueMicrotask(async()=>{
   scheduled=false;const work=queue.splice(0);
   for(let i=0;i<work.length;i+=100){const chunk=work.slice(i,i+100);let rows=[];try{rows=await historyMatches(chunk.map(item=>item.job));}catch{/* A missing pending migration must not create a badge. */}
    for(const item of chunk){const row=rows.find(row=>row.employer_key===employerKey(item.job.company) && row.role_id===item.job.canonical_role),value=row && Number.isInteger(row.fiscal_year)?{year:row.fiscal_year,href:'/h1b/#'+employerAnchor(row.employer_key)}:null;cache.set(item.key,{value,until:Date.now()+300000});item.resolve(value);}
   }
  });
 });
}
export function historyReadArgs(params){
 const strip=(name,prefix)=>{const value=params.get(name)||'';return value.startsWith(prefix)?value.slice(prefix.length).replace(/\*$/,''):'';};
 const keywords=(params.get('or')||'').match(/search_text\.ilike\.\*([^*]+)\*/g)||[];
 const rolesValue=params.get('canonical_role') || '';
 return {p_query:keywords.map(value=>value.replace(/^search_text\.ilike\.\*|\*$/g,'')).join(' '),p_limit:Number(params.get('limit')) || 100,p_filters:{
  country:strip('country','eq.'),state:strip('state_code','eq.'),city:strip('location','ilike.*'),company:strip('company','ilike.*'),
  source:strip('source','eq.'),exclude_source:strip('source','neq.'),category:strip('category','eq.'),work_mode:strip('work_mode','eq.'),posted_after:strip('posted_at','gte.'),salary_listed:params.get('salary')==='not.is.null',
  ...(rolesValue.startsWith('in.(')?{roles:rolesValue.slice(4,-1).split(',')}:rolesValue.startsWith('eq.')?{roles:[rolesValue.slice(3)]}:{})}};
}
export {unavailable as historyUnavailable};
