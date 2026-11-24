import {entryEvidence} from './levels.mjs';
import {openListing,applicationUrl,newestFirst} from './catalogue.mjs';
import {areaFacts,areaFaq,answerBlock,dateLabel,fmt,parsedPay,percentile,payRange,narrowPay} from './geo.mjs';
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

export function salaryStats(rows,role,min=8,unit) {
 const parsed=rows.map(job=>({job,pay:parsedPay(job.salary)})).filter(item=>item.pay);
 if(!unit){const preferred=areaFacts(rows,role).pay?.unit;unit=preferred || 'year';if(parsed.filter(item=>item.pay.unit===unit).length<min)unit=unit==='hour'?'year':'hour';}
 const own=parsed.filter(item=>item.pay.unit===unit);if(own.length<min)return null;
 const amounts=own.map(item=>item.pay.midpoint),low=percentile(amounts,.25),high=percentile(amounts,.75),median=percentile(amounts,.5);
 const groups=new Map();for(const item of own){const key=item.job.company.trim().toLowerCase();if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
 const employers=[...groups.values()].filter(items=>items.length>=2).map(items=>({name:items[0].job.company,count:items.length,median:percentile(items.map(item=>item.pay.midpoint),.5)}))
  .sort((a,b)=>b.median-a.median || a.name.localeCompare(b.name)).slice(0,5);
 return {unit,low,high,median,count:own.length,rows:own.map(item=>item.job),employers};
}
export const typicalPay = (median,unit)=>payRange({low:median,high:median,unit});
function salaryModel(rows,role,state,date) {
 const stats=salaryStats(rows,role.id);if(!stats)return null;
 const place=state?.name || 'the United States',h1=role.name+' salary in '+place;
 const answer=`Based on ${fmt(stats.count)} current job listings that show pay on Fortune Jobs AI (updated ${dateLabel(date)}), listed pay for ${role.name} jobs in ${place} is ${payRange(stats)}${narrowPay(stats)?'':' (middle 50% of listed salary midpoints)'}. The median listed midpoint is ${typicalPay(stats.median,stats.unit)}. These figures describe listed pay in current postings, not a salary survey. Hourly and yearly figures are not mixed or extrapolated.`;
 const faq=[{q:'What is typical listed pay?',a:`The median listed salary midpoint is ${typicalPay(stats.median,stats.unit)} across ${fmt(stats.count)} current postings. ${narrowPay(stats)?'Most listed midpoints are close together.':'The middle 50% is '+payRange(stats)+'.'}`}];
 if(stats.employers.length)faq.push({q:'Which employers list the highest pay?',a:stats.employers.map(company=>company.name+': '+typicalPay(company.median,stats.unit)+' (median of '+company.count+' listings)').join('; ')+'. Only employers with at least two usable listings of the same pay unit are compared.'});
 const remote=salaryStats(stats.rows.filter(isRemote),role.id,5,stats.unit),onsite=salaryStats(stats.rows.filter(job=>/^(on[ -]?site)$/i.test(job.work_mode || '') && !isRemote(job)),role.id,5,stats.unit);
 if(remote && onsite)faq.push({q:'How does remote pay compare with on-site pay?',a:`The listed midpoint median is ${typicalPay(remote.median,stats.unit)} for ${remote.count} remote listings and ${typicalPay(onsite.median,stats.unit)} for ${onsite.count} explicitly on-site listings. These are different postings, not controlled estimates of a remote-work premium.`});
 const entry=salaryStats(stats.rows.filter(job=>entryEvidence(job).entry && !entryEvidence(job).internship),role.id,5,stats.unit);
 if(entry)faq.push({q:'What pay is listed for entry-level and new-grad jobs?',a:`The median listed midpoint is ${typicalPay(entry.median,stats.unit)} from ${entry.count} entry-level and new-grad postings with usable pay. Internship listings are excluded from this comparison.`});
 if(faq.length<4)faq.push({q:'Is this a salary survey?',a:'No. The figures are listed pay in current job postings on Fortune Jobs AI, not a salary survey or a prediction of an offer. Listings without usable pay are excluded.'});
 if(faq.length<3)faq.push({q:'How is the range calculated?',a:'We parse each listed pay range to its midpoint and compute the 25th and 75th percentiles. At least eight current postings with the same pay unit are required. Near-identical ranges are shown as one approximate figure.'});
 return {kind:'salary',path:'/salaries/'+role.id+'/'+(state?stateSlug(state.name)+'/':''),role:role.id,title:role.name,state:state?.code,stateName:state?.name,h1,answer,rows:stats.rows,stats,faq:faq.slice(0,5)};
}
export function planSalary(catalogue,roles,regions,now,date) {
 const rows=publicRows(catalogue,now),pages=[];
 for(const role of roles){const own=rows.filter(job=>job.canonical_role===role.id),national=salaryModel(own,role,null,date);if(national)pages.push(national);
  for(const state of regions){const slice=salaryModel(own.filter(job=>job.state_code===state.code),role,state,date);if(slice)pages.push(slice);}}
 if(pages.length)pages.unshift({kind:'salary',path:'/salaries/',h1:'Listed salaries in current U.S. job postings',answer:'Compare listed pay by role and state using current job postings on Fortune Jobs AI. Each salary page requires at least eight open listings with usable pay in the same unit. Figures describe listed salary midpoints and the middle half of the postings, not a salary survey. Hourly and yearly rates are kept separate. Check the original listing for the full pay range and conditions.',rows:[],faq:[
  {q:'Where do these pay figures come from?',a:'Only current open job postings in the Fortune Jobs AI catalogue are used; no external salary survey is combined with them.'},
  {q:'Why are some roles or states missing?',a:'A salary page requires at least eight current listings with usable pay in the same unit. We omit a page when that threshold is not met.'},
  {q:'Are these guaranteed offers?',a:'No. Listed pay can change and an offer may depend on the employer and candidate. Confirm the full range and terms in the original posting.'}]});
 return pages;
}
