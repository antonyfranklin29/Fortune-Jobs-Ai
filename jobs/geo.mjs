import sectors from '../config/care-sectors.json' with { type: 'json' };
export const HUBS = Object.entries(sectors).map(([id, roles]) => ({ id, roles,
  label: {healthcare:'Healthcare',tech:'Tech',transport:'Transport & Logistics'}[id] }));
export const MIN_HUB_JOBS = 25;
const tech = new Set(sectors.tech);
const hourly = new Set([...sectors.healthcare,...sectors.transport]);
export const advertiserName = value => !!String(value || '').trim() && !/^jobg8(?:\b|$)/i.test(String(value).trim());
export const dateLabel = date => new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});
const list = values => new Intl.ListFormat('en-US',{style:'long',type:'conjunction'}).format(values);
const words = value => value.trim().split(/\s+/).length;
export function percentile(values, q) {
 if (!values.length || !Number.isFinite(q) || q<0 || q>1) return null;
 const sorted=[...values].sort((a,b)=>a-b), at=(sorted.length-1)*q, lo=Math.floor(at);
 return sorted[lo]+(sorted[Math.min(lo+1,sorted.length-1)]-sorted[lo])*(at-lo);
}
// Only explicit USD pay; no currency or hourly/yearly conversion, bonus or equity assumptions.
export function parsedPay(value) {
 let text=String(value || '').replaceAll(',','');
 if (/CAD|AUD|NZD|SGD|GBP|EUR|INR|[€£₹]|[CANZS]\s*\$/i.test(text) || /month|week|daily|per day|\/day/i.test(text)) return null;
 const unit=/hour|hourly|\bhrs?\b|\/h\b/i.test(text) ? 'hour' : 'year';
 text=text.split(/bonus|equity|stock|commission|\bote\b/i)[0];
 const hit=text.match(/(?:\$|USD\s*)\s*(\d+(?:\.\d+)?)\s*(k\b)?(?:\s*(?:-|–|—|to)\s*(?:\$|USD\s*)?\s*(\d+(?:\.\d+)?)\s*(k\b)?)?/i);
 if (!hit) return null;
 const low=Number(hit[1])*(hit[2] || hit[4] ? 1000:1), high=hit[3] ? Number(hit[3])*(hit[4] || hit[2] ? 1000:1):low;
 const min=Math.min(low,high),max=Math.max(low,high);
 if (!Number.isFinite(min+max) || min<(unit==='hour'?1:10000) || max>(unit==='hour'?1000:1000000)) return null;
 return {unit,midpoint:(min+max)/2};
}
const money = (value,unit) => '$'+(unit==='hour' ? Math.floor((value+Number.EPSILON)*100)/100 : Math.floor(value)).toLocaleString('en-US',{maximumFractionDigits:unit==='hour'?2:0});
export const payRange = pay => money(pay.low,pay.unit)+'–'+money(pay.high,pay.unit)+(pay.unit==='hour'?' an hour':' a year');
export function areaFacts(rows, role) {
 const valid=rows.filter(job=>advertiserName(job.company));
 const companies=new Map();
 for(const job of valid) { const key=job.company.trim().toLowerCase(), old=companies.get(key); companies.set(key,{name:old?.name || job.company.trim(),count:(old?.count || 0)+1}); }
 const employers=[...companies.values()].sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name));
 const salaries=valid.map(job=>parsedPay(job.salary)).filter(Boolean), preferred=hourly.has(role)?'hour':'year';
 const amounts=unit=>salaries.filter(pay=>pay.unit===unit).map(pay=>pay.midpoint);
 let unit=preferred, pay=amounts(unit);
 if (pay.length<5) {unit=preferred==='hour'?'year':'hour';pay=amounts(unit);}
 return {count:valid.length,employers,
  pay:pay.length>=5?{unit,low:percentile(pay,.25),high:percentile(pay,.75),count:pay.length}:null,
  entry:valid.filter(job=>/\b(?:entry[ -]level|new[ -]grad(?:uate)?|junior|graduate|no experience)\b/i.test([job.job_title,job.job_description].join(' '))).length,
  remote:tech.has(role)?valid.filter(job=>job.is_remote===true || /^remote$/i.test(job.work_mode || '')).length:0,
  visa:valid.filter(job=>['sponsors','opt_friendly'].includes(job.sponsorship)).length};
}
export function answerBlock(target, facts, date, place) {
 const lead=`Fortune Jobs AI lists ${facts.count} open ${target.title} jobs in ${place}, updated ${dateLabel(date)}.`;
 const pay=facts.pay?`Listed pay: ${payRange(facts.pay)} (25th–75th percentile of ${facts.pay.count} listed salary midpoints).`:'';
 const entry=facts.entry?`${facts.entry} ${facts.entry===1?'listing mentions':'listings mention'} entry-level, new-grad, junior or graduate roles.`:'';
 const remote=facts.remote?`${facts.remote} tech ${facts.remote===1?'listing is':'listings are'} marked remote.`:'';
 const visa=facts.visa?`${facts.visa} ${facts.visa===1?'listing mentions':'listings mention'} visa sponsorship or OPT; confirm with the employer.`:'';
 const close='Check each original posting for current requirements and application instructions.';
 let names=facts.employers.slice(0,3).map(item=>item.name);
 const combine=()=>[lead,pay,names.length?'Top hiring employers: '+list(names)+'.':'',entry,remote,visa,close].filter(Boolean).join(' ');
 while(names.length && words(combine())>80) names.pop();
 let answer=combine();
 if(words(answer)<40) answer+=' This job portal groups current openings from its catalogue so you can compare roles and locations.';
 return answer;
}
export function licenseAnswer(role, rows) {
 if(role==='registered-nurse') return 'RN roles require an active RN license valid in the state of practice. An NLC multistate license may apply in participating states. Confirm the listing and licensing board requirements.';
 if(role==='licensed-practical-nurse') return 'LPN/LVN roles require the applicable state LPN/LVN license or an authorised multistate license where recognised. Confirm the listing and licensing board requirements.';
 if(role==='certified-nursing-assistant') return 'Check the listing for the applicable state CNA certification or registry requirements. Confirm your certification and registry status with the employer and the state authority.';
 if(sectors.transport.includes(role) && rows.some(job=>/\bCDL[ -]?[AB]\b/i.test([job.job_title,job.job_description].join(' ')))) return 'Check the listing for the required CDL-A or CDL-B license, vehicle class and endorsements. Requirements depend on the vehicle and role; confirm them with the employer.';
 return null;
}
export function areaFaq(target,facts,date,place,rows) {
 const noun=target.title+' jobs',faq=[{q:`How many ${noun} are open in ${place}?`,a:`Fortune Jobs AI lists ${facts.count} open ${noun} in ${place} as of ${dateLabel(date)}.`}];
 if(facts.pay) faq.push({q:`How much do ${noun} in ${place} pay?`,a:`The 25th–75th percentile of listed salary midpoints is ${payRange(facts.pay)}, based on ${facts.pay.count} listings where employers list pay. Listings without usable pay data are excluded; hourly and yearly pay are not mixed.`});
 if(facts.employers.length) faq.push({q:`Which employers are hiring for ${noun} in ${place}?`,a:'Employers in this catalogue include '+list(facts.employers.slice(0,5).map(item=>item.name+' ('+item.count+' '+(item.count===1?'listing':'listings')+')'))+'.'});
 const license=licenseAnswer(target.role,rows);if(license)faq.push({q:'Do I need a license?',a:license});
 if(facts.visa)faq.push({q:`Do any ${noun} in ${place} mention visa sponsorship or OPT?`,a:`${facts.visa} ${facts.visa===1?'listing mentions':'listings mention'} visa sponsorship or OPT/CPT. A mention does not guarantee sponsorship or eligibility; confirm with the employer.`});
 if(facts.entry)faq.push({q:`Are there entry-level ${noun} in ${place}?`,a:`${facts.entry} ${facts.entry===1?'listing mentions':'listings mention'} entry-level, new-grad, junior or graduate roles in the title or description. Review the original posting for its experience requirements.`});
 if(faq.length<3)faq.push({q:'What should I check before applying?',a:'Review the original posting for current requirements, pay and application instructions. Fortune Jobs AI is a job portal; availability can change after this catalogue update.'});
 return faq.slice(0,5);
}
export const faqSchema = faq => ({'@context':'https://schema.org','@type':'FAQPage',mainEntity:faq.map(({q,a})=>({'@type':'Question',name:q,acceptedAnswer:{'@type':'Answer',text:a}}))});

export function hubAnswer(hub,date) {
 const {label,rows,roleCounts,stateCounts}=hub;
 let names=roleCounts.slice(0,3).map(item=>item.name),states=stateCounts.slice(0,3).map(item=>item.name+' ('+item.count+')');
 const combine=()=>`Fortune Jobs AI lists ${rows.length} open ${label.toLowerCase()} jobs across ${roleCounts.length} ${roleCounts.length===1?'role':'roles'} in the United States, updated ${dateLabel(date)}. `+
  (names.length?'Roles in this catalogue include '+list(names)+'. ':'')+(states.length?'The states with the most listings are '+list(states)+'. ':'')+
  'This job portal groups openings by role and location so you can compare listings and check original postings for requirements and application instructions. The table links to indexed state pages when enough listings are available. Counts reflect this catalogue snapshot, not every vacancy in the market.';
 while(words(combine())>100 && names.length>1)names.pop();while(words(combine())>100 && states.length>1)states.pop();
 return combine();
}
export function hubFaq(hub,date) {
 const label=hub.label.toLowerCase();
 return [{q:`How many ${label} jobs are listed?`,a:`Fortune Jobs AI lists ${hub.rows.length} open ${label} jobs in the United States as of ${dateLabel(date)}.`},
  {q:'Which roles are covered?',a:'This catalogue includes '+list(hub.roleCounts.map(item=>item.name+' ('+item.count+')'))+'.'},
  {q:'Which states have the most listings?',a:'The leading states in this snapshot are '+list(hub.stateCounts.slice(0,5).map(item=>item.name+' ('+item.count+')'))+'.'},
  {q:'Why do some counts have no state-page link?',a:`Links point to existing indexed role/state pages. ${hub.id==='tech'?'Tech role/state pages require at least 40':'Healthcare and transport role/state pages require at least 5'} open jobs; other counts still contribute to the category total.`},
  {q:'What should I check before applying?',a:'Use the original posting to confirm availability, requirements, pay and application instructions. Fortune Jobs AI is a job portal and does not guarantee a response or hiring outcome.'}];
}
