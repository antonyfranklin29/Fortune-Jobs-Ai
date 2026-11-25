import {createSign} from 'node:crypto';
export const SITE='https://fortunejobsai.com',PROPERTY='sc-domain:fortunejobsai.com';
const OAUTH='https://oauth2.googleapis.com/token';
const b64=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
export function jwtAssertion(account,now=Date.now()){
 if(account.type!=='service_account'||!/@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(account.client_email||'')||account.token_uri!==OAUTH||typeof account.private_key!=='string')throw Error('Invalid GSC service-account configuration');
 const iat=Math.floor(now/1000),header=b64({alg:'RS256',typ:'JWT'}),body=b64({iss:account.client_email,scope:'https://www.googleapis.com/auth/webmasters.readonly',aud:OAUTH,iat,exp:iat+3600});
 const unsigned=header+'.'+body;const signature=createSign('RSA-SHA256').update(unsigned).end().sign(account.private_key).toString('base64url');return unsigned+'.'+signature;
}
export async function googleClient(account,{fetchImpl=fetch,now=Date.now()}={}){
 const assertion=jwtAssertion(account,now);
 const token=await fetchImpl(OAUTH,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
 if(!token.ok)throw Error('Google authentication failed (HTTP '+token.status+'); verify the service account and property access.');
 const value=await token.json();if(!value.access_token)throw Error('Google returned no access token');
 return async (kind,body)=>{
  const url=kind==='analytics'?'https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(PROPERTY)+'/searchAnalytics/query':kind==='inspection'?'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect':null;
  if(!url)throw Error('Unsupported Google operation');
  const r=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+value.access_token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  // Never include credential-bearing requests or raw provider bodies in logs.
  if(!r.ok)throw Object.assign(Error('Search Console '+kind+' failed (HTTP '+r.status+')'),{status:r.status});
  return r.json();
 };
}
export function publicUrl(value){try{const u=new URL(value);if(u.origin!==SITE||u.search||u.hash||u.username||u.password||u.href.length>500||!/^\/(?:$|index\.html$|find-jobs\.html$|resume-(?:search|builder)\.html$|application-tracker\.html$|about\.html$|contact\.html$|privacy\.html$|terms\.html$|(?:jobs|salaries|h1b)\/(?:[a-z0-9-]+\/)*)$/.test(u.pathname))return null;return u.href;}catch{return null;}}
export function safeQuery(value){const q=String(value||'').trim();return q && q.length<=200 && !/[\x00-\x1f@]|https?:\/\/|\b\d{9,}\b/i.test(q)?q:null;}
export function normalizeRows(rows,day){
 const out=new Map();for(const row of rows){const [date,query,page]=row.keys||[],q=safeQuery(query),url=publicUrl(page);if(date!==day||!q||!url)continue;
  const {clicks,impressions,position}=row;if(!Number.isInteger(clicks)||!Number.isInteger(impressions)||clicks<0||impressions<=0||clicks>impressions||!Number.isFinite(position)||position<1)continue;
  const value={date,query:q,page:url,clicks,impressions,position};out.set(q+'\0'+url,value);
 }return [...out.values()];
}
export async function analyticsDay(google,day){
 const collected=[];let bounded=false;
 for(let offset=0;offset<50000;offset+=25000){const result=await google('analytics',{startDate:day,endDate:day,dimensions:['date','query','page'],type:'web',dataState:'final',rowLimit:25000,startRow:offset});
  if(result.rows!==undefined && !Array.isArray(result.rows))throw Error('Invalid GSC analytics response');const rows=result.rows||[];if(rows.length>25000)throw Error('GSC row limit exceeded');collected.push(...rows);if(rows.length<25000)break;if(offset===25000)bounded=true;
 }return {rows:normalizeRows(collected,day),provider_rows:collected.length,bounded};
}
const short=value=>typeof value==='string'?value.slice(0,200):null;
const iso=value=>value&&!Number.isNaN(Date.parse(value))?new Date(value).toISOString():null;
export function inspectionRow(url,result,previous,now=new Date()){
 const r=result?.inspectionResult?.indexStatusResult;if(!r || typeof r!=='object')throw Error('GSC inspection missing index status');
 const discovered=/discovered.*not.*index/i.test(r.coverageState||'');
 const canonical=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?(u.origin+u.pathname).slice(0,500):null;}catch{return null;}};
 return {url,inspected_at:now.toISOString(),verdict:short(r.verdict),coverage_state:short(r.coverageState),robots_txt_state:short(r.robotsTxtState),indexing_state:short(r.indexingState),page_fetch_state:short(r.pageFetchState),last_crawl_time:iso(r.lastCrawlTime),google_canonical:canonical(r.googleCanonical),user_canonical:canonical(r.userCanonical),discovered_since:discovered?(previous?.discovered_since||now.toISOString()):null};
}
const dayAt=(now,offset)=>new Date(now.getTime()-offset*86400000).toISOString().slice(0,10);
export async function collect({google,db,urls,now=new Date(),days=7,pause=()=>new Promise(r=>setTimeout(r,120))}){
 if(!Number.isInteger(days)||days<1||days>7)throw Error('Collect 1–7 finalized days at a time');
 let stored=0;
 for(let offset=3;offset<3+days;offset++){const day=dayAt(now,offset),data=await analyticsDay(google,day);await db('rpc/seo_replace_gsc_day',{method:'POST',body:{p_day:day,p_rows:data.rows,p_provider_rows:data.provider_rows,p_bounded:data.bounded}});stored+=data.rows.length;}
 const candidates=[...new Set(urls.map(publicUrl).filter(Boolean))];
 const claimed=await db('rpc/seo_claim_inspections',{method:'POST',body:{p_urls:candidates,p_limit:300}});
 if(!Array.isArray(claimed)||claimed.length>300)throw Error('Invalid inspection reservation');
 let inspected=0,failed=0;
 for(const item of claimed){const url=publicUrl(item.url);if(!url||!candidates.includes(url))throw Error('Inspection claim outside sitemap');
  try{
   const previous=(await db('seo_index_status?url=eq.'+encodeURIComponent(url)+'&select=discovered_since'))[0];
   const result=await google('inspection',{inspectionUrl:url,siteUrl:PROPERTY,languageCode:'en-US'});
   await db('seo_index_status?on_conflict=url',{method:'POST',body:inspectionRow(url,result,previous,now),upsert:true});inspected++;
  }catch(error){failed++;if([401,403,429].includes(error.status))break;}
  await pause();
 }
 return {days,stored,claimed:claimed.length,inspected,failed};
}
