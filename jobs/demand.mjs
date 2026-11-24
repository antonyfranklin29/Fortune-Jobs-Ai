import {openListing,applicationUrl} from './catalogue.mjs';
import {areaFacts,areaFaq,answerBlock,dateLabel,fmt} from './geo.mjs';
export const stateSlug = name => name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-$/,'');
export const isRemote = job => job.is_remote === true || /remote/i.test(job.work_mode || '');
export function publicRows(catalogue,now) {
 const seen=new Set();return catalogue.filter(job=>{
  if(!openListing(job,now))return false;const key=applicationUrl(job.apply_url);if(seen.has(key))return false;seen.add(key);return true;
 });
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
