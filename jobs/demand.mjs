import {entryEvidence} from './levels.mjs';
import {openListing,applicationUrl,newestFirst} from './catalogue.mjs';
import {areaFacts,areaFaq,answerBlock,dateLabel,fmt} from './geo.mjs';
export const stateSlug = name => name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-$/,'');
export const isRemote = job => job.is_remote === true || /remote/i.test(job.work_mode || '');
export function publicRows(catalogue,now) {
 const seen=new Set();return catalogue.filter(job=>{
  if(!openListing(job,now))return false;const key=applicationUrl(job.apply_url);if(seen.has(key))return false;seen.add(key);return true;
 }).sort(newestFirst);
}
function remoteModel(rows,role,date) {
 const label=role?.name || 'U.S.',target={role:role?.id || '',title:role?.name || 'remote'},facts=areaFacts(rows,target.role);
 const faq=areaFaq(target,facts,date,'the United States',rows).filter(item=>!item.q.includes('license'));
 const restriction={q:'Is every listing fully remote from any state?',a:'Check each listing; some remote jobs are limited to certain states or include location and worksite requirements. A remote label does not mean work from anywhere.'};
 const answer=`Fortune Jobs AI lists ${fmt(rows.length)} open remote ${role?role.name+' ':''}jobs, updated ${dateLabel(date)}. `+answerBlock(target,facts,date,'the United States').replace(/^Fortune Jobs AI lists[^.]+\. /,'');
 return {kind:'remote',path:'/jobs/remote/'+(role?role.id+'/':''),role:role?.id,title:role?.name,h1:role?'Remote '+label+' jobs':'Remote jobs in the United States',answer,rows,faq:[...faq.slice(0,4),restriction]};
}
export function planRemote(catalogue,roles,now,date) {
 const rows=publicRows(catalogue,now).filter(isRemote),pages=[];
 for(const role of roles){const own=rows.filter(job=>job.canonical_role===role.id);if(own.length>=10)pages.push(remoteModel(own,role,date));}
 if(rows.length>=25)pages.unshift(remoteModel(rows,null,date));return pages;
}

function entryModel(rows,role,region,date) {
 const jobs=rows.filter(job=>!entryEvidence(job).internship),internships=rows.length-jobs.length;
 const label=role?.name || 'U.S.',place=region?.name || 'the United States',facts=areaFacts(jobs,role?.id || '');
 const years=jobs.filter(job=>entryEvidence(job).years).length,noExperience=jobs.filter(job=>entryEvidence(job).noExperience).length;
 const target={role:role?.id || '',title:role?.name || 'entry-level and new-grad'};
 const faq=areaFaq(target,facts,date,place,jobs).filter(item=>!item.q.includes('entry-level') && !item.q.includes('license')).slice(0,4);
 faq.push({q:'Do I need experience?',a:`${fmt(years)} listings mention 0–2 years and ${fmt(noExperience)} say no experience required. Other requirements vary; review the original posting. A title match alone does not confirm eligibility.`});
 const answer=`Fortune Jobs AI lists ${fmt(jobs.length)} open entry-level and new-grad ${role?role.name+' ':''}jobs in ${place}, updated ${dateLabel(date)}. `+
  (internships?`${fmt(internships)} internship listings are shown separately and are not included in that job count. `:'')+
  'Matches use explicit junior, graduate and early-career titles or descriptions mentioning 0–2 years or no experience required. Check each original posting for requirements. This job portal is for every job seeker; all experience levels remain available.';
 return {kind:'entry-level',path:'/jobs/entry-level/'+(role?role.id+'/':'')+(region?stateSlug(region.name)+'/':''),role:role?.id,title:role?.name,state:region?.code,stateName:region?.name,
  h1:'Entry-level and new-grad '+(role?role.name+' ':'')+'jobs'+(region?' in '+region.name:''),answer,rows,faq,count:jobs.length,internships};
}
export function planEntry(catalogue,roles,regions,now,date) {
 const rows=publicRows(catalogue,now).filter(job=>entryEvidence(job).entry),pages=[];
 const eligible=items=>items.filter(job=>!entryEvidence(job).internship).length>=5;
 for(const role of roles){const own=rows.filter(job=>job.canonical_role===role.id);if(eligible(own))pages.push(entryModel(own,role,null,date));
  for(const state of regions){const ownState=own.filter(job=>job.state_code===state.code);if(eligible(ownState))pages.push(entryModel(ownState,role,state,date));}}
 if(eligible(rows))pages.unshift(entryModel(rows,null,null,date));return pages;
}
