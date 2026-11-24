import mapping from '../config/h1b-soc-roles.json' with {type:'json'};
import {dateLabel,fmt,advertiserName} from './geo.mjs';
import {stateSlug,publicRows,typicalPay} from './demand.mjs';
// Keep legal entities distinct: suffix spelling is normalised, never removed or fuzzy-matched.
export function employerKey(name) {
 return String(name || '').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim()
  .split(/\s+/).map(token=>({incorporated:'inc',corporation:'corp',limited:'ltd'}[token] || token)).join(' ');
}
export const employerAnchor = key => 'employer-'+key.replace(/[^a-z0-9]+/g,'-');
export function socRole(soc,title) {
 const code=String(soc || '').match(/^\d{2}-\d{4}/)?.[0];
 return mapping.rules.find(rule=>rule.soc_codes.includes(code) && rule.include.some(p=>new RegExp(p,'i').test(title)) && !rule.exclude.some(p=>new RegExp(p,'i').test(title)))?.role_id || null;
}
export const DOL_SOURCE='https://www.dol.gov/agencies/eta/foreign-labor/performance';
export const FILING_CAVEAT="Filing history doesn't guarantee sponsorship for any specific job; confirm with the employer.";
export function planH1b(stats,metadata,roles,regions,date) {
 const full=Number(metadata?.latest_full_fy);if(!Number.isInteger(full))return [];
 const rows=stats.filter(row=>Number(row.fiscal_year)===full && advertiserName(row.employer_name) && row.certified_lcas>0 && employerKey(row.employer_name)===row.employer_key);
 const pages=[];
 const model=(own,role,state)=>{
  const employers=new Set(own.map(row=>row.employer_key));if(employers.size<5)return null;
  const title='Companies that filed H-1B applications'+(role?' for '+role.name+' roles':'')+(state?' in '+state.name:' in the United States');
  const statement=`These employers filed H-1B Labor Condition Applications (LCAs) certified by the U.S. Department of Labor in FY${full}.`;
  const count=own.reduce((sum,row)=>sum+Number(row.certified_lcas),0);
  return {kind:'h1b',path:'/h1b/'+(role?role.id+'/':'')+(state?stateSlug(state.name)+'/':''),h1:title,role:role?.id,title:role?.name,state:state?.code,stateName:state?.name,
   answer:`${fmt(employers.size)} employers in this slice ${statement.slice('These employers '.length)} ${fmt(count)} certified LCAs are represented. Updated ${dateLabel(date)}. ${FILING_CAVEAT}`,rows:[],stats:own,year:full,employerCount:employers.size,
   faq:[{q:'What does this filing history show?',a:statement+' An LCA is a labor-condition filing, not a visa approval. Counts describe certified cases, not the number of workers or open jobs.'},
    {q:'Does a past filing guarantee sponsorship?',a:FILING_CAVEAT},
    {q:'Where does the data come from?',a:'The U.S. Department of Labor Office of Foreign Labor Certification LCA Programs public disclosure files. Only case status Certified and visa class H-1B are included.'},
    {q:'Are current fiscal-year quarters mixed into these totals?',a:'No. The importer keeps published current-year quarters separately. These pages and job badges use the latest complete fiscal year so a partial year is not presented as a full-year total.'},
    {q:'What does the wage column mean?',a:'It is the median offered wage within the employer, worksite state, SOC occupation, role and fiscal-year group. It is not a salary survey or an offer for a currently open job. Full-time nonannual rates use the documented annualisation factors; part-time nonannual rates are excluded from the wage median.'}]};
 };
 const hub=model(rows);if(hub)pages.push(hub);
 for(const role of roles){const own=rows.filter(row=>row.role_id===role.id),national=model(own,role);if(national)pages.push(national);
  for(const state of regions){const slice=model(own.filter(row=>row.state_code===state.code),role,state);if(slice)pages.push(slice);}}
 return pages;
}
export async function readH1b(config,fetchImpl=fetch) {
 const headers={apikey:config.key,Authorization:'Bearer '+config.key};
 const meta=await fetchImpl(config.url+'/rest/v1/h1b_data_state?select=latest_full_fy,current_fy,updated_at&singleton=eq.true',{headers,signal:AbortSignal.timeout(8000)});
 if([404,406].includes(meta.status))return {rows:[],metadata:null};
 if(!meta.ok)throw Error('H-1B metadata unavailable; preserving the previous build.');
 const metadata=(await meta.json())[0];if(!metadata?.latest_full_fy)return {rows:[],metadata:null};
 const rows=[];
 for(let page=0;page<1000;page++){
  const query=new URLSearchParams({select:'employer_key,employer_name,state_code,soc_code,role_id,fiscal_year,certified_lcas,median_wage_annual,updated_at',fiscal_year:'eq.'+metadata.latest_full_fy,updated_at:'eq.'+metadata.updated_at,order:'employer_key.asc,state_code.asc,soc_code.asc,role_id.asc,fiscal_year.asc',limit:'1000',offset:String(page*1000)});
  const response=await fetchImpl(config.url+'/rest/v1/h1b_employer_stats?'+query,{headers,signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('H-1B data unavailable; preserving the previous build.');
  const batch=await response.json();if(!Array.isArray(batch))throw Error('Invalid H-1B data');rows.push(...batch);
  if(batch.length<1000){
   const check=await fetchImpl(config.url+'/rest/v1/h1b_data_state?select=updated_at&singleton=eq.true',{headers,signal:AbortSignal.timeout(8000)});
   if(!check.ok || (await check.json())[0]?.updated_at!==metadata.updated_at)throw Error('H-1B snapshot changed during generation; preserve the previous build.');
   return {rows,metadata};
  }
 }
 throw Error('H-1B pagination limit reached');
}
