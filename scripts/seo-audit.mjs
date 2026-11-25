import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const SITE='https://fortunejobsai.com';
export const decode=s=>String(s||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
export const text=s=>decode(s.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m=>[m[1].toLowerCase(),decode(m[2]??m[3]??m[4])]));
export function pathKey(url){const u=new URL(url,SITE);return u.pathname==='/index.html'?'/':u.pathname.replace(/\/index\.html$/,'/');}
export function sitemapEntries(xml){return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([,v])=>({url:decode(v.match(/<loc>([^<]+)<\/loc>/)?.[1]),lastmod:v.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]||null})).filter(x=>x.url);}
export function inspect(html,url){
 const tags=[...html.matchAll(/<(?:meta|link)\b[^>]*>/gi)].map(m=>attrs(m[0]));
 const title=decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').trim();
 const description=tags.find(a=>a.name?.toLowerCase()==='description')?.content||'';
 const canonical=tags.filter(a=>a.rel?.toLowerCase().split(/\s+/).includes('canonical')).map(a=>a.href);
 const visible=text(html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]||'');
 const links=[...html.matchAll(/<a\b[^>]*>/gi)].map(m=>attrs(m[0]).href).filter(Boolean).flatMap(href=>{try{const u=new URL(href,url);return u.origin===SITE && !u.search?[pathKey(u.href)]:[];}catch{return [];}});
 const schemas=[],issues=[];
 for(const [,raw] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{const item=JSON.parse(raw);schemas.push(item);walkSchema(item,node=>{
   if(node['@type']==='JobPosting')issues.push('forbidden_jobposting');
   if(node['@type']==='FAQPage'){
    if(!Array.isArray(node.mainEntity)||!node.mainEntity.length)issues.push('invalid_faq');
    for(const q of node.mainEntity||[])if(!visible.includes(text(q.name||''))||!visible.includes(text(q.acceptedAnswer?.text||'')))issues.push('faq_not_in_html');
   }
  });}catch{issues.push('invalid_jsonld');}
 }
 const h1=[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>text(m[1]));
 if(!title)issues.push('missing_title');else if(title.length>65||title.length<15)issues.push('title_length');
 if(description.length<50||description.length>170)issues.push('description_length');
 if(canonical.length!==1)issues.push('canonical_count');else{try{if(new URL(canonical[0],url).href!==new URL(pathKey(url),SITE).href)issues.push('canonical_not_self');}catch{issues.push('invalid_canonical');}}
 if(h1.length!==1)issues.push('h1_count');
 if(visible.split(/\s+/).filter(Boolean).length<80)issues.push('little_crawler_content');
 const noindex=tags.some(a=>/^(robots|googlebot)$/i.test(a.name||'') && /\bnoindex\b/i.test(a.content||''));
 return {url,path:pathKey(url),title,description,canonical,h1,noindex,words:visible?visible.split(' ').length:0,mainText:visible,links:[...new Set(links)],schemaTypes:schemas.flatMap(s=>s['@graph']||s).map(s=>s['@type']),issues:[...new Set(issues)]};
}
function walkSchema(v,fn){if(!v||typeof v!=='object')return;if(Array.isArray(v))return v.forEach(x=>walkSchema(x,fn));fn(v);Object.values(v).forEach(x=>walkSchema(x,fn));}
export function robotsBlocked(path,robots){let relevant=false, rules=[];for(const line of robots.split(/\r?\n/)){const [key,...parts]=line.split(':');const value=parts.join(':').split('#')[0].trim();if(/^user-agent$/i.test(key.trim()))relevant=/^(\*|Googlebot)$/i.test(value);if(relevant && /^(disallow|allow)$/i.test(key.trim())&&value){const pattern='^'+value.split('*').map(p=>p.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('.*');try{if(new RegExp(pattern).test(path))rules.push({allow:/^allow$/i.test(key.trim()),length:value.length});}catch{}}}rules.sort((a,b)=>b.length-a.length||Number(b.allow)-Number(a.allow));return rules.length?!rules[0].allow:false;}
export function graphReport(pages){
 const byPath=new Map(pages.map(p=>[p.path,p]));const inbound=new Map(pages.map(p=>[p.path,new Set()]));
 for(const p of pages)for(const to of p.links)if(to!==p.path&&byPath.has(to))inbound.get(to).add(p.path);
 const depth=new Map([['/',0]]),queue=['/'];for(let i=0;i<queue.length;i++){const p=byPath.get(queue[i]);for(const to of p?.links||[])if(byPath.has(to)&&!depth.has(to)){depth.set(to,depth.get(p.path)+1);queue.push(to);}}
 const frequency=new Map();for(const p of pages)for(const word of new Set(p.mainText.toLowerCase().match(/[a-z0-9'-]+/g)||[]))frequency.set(word,(frequency.get(word)||0)+1);
 return pages.map(p=>({...p,inbound:[...inbound.get(p.path)],outboundInternal:p.links.length,depth:depth.get(p.path)??null,uniqueWords:[...new Set(p.mainText.toLowerCase().match(/[a-z0-9'-]+/g)||[])].filter(w=>frequency.get(w)<=Math.max(1,Math.ceil(pages.length*.1))).length,mainText:undefined}));
}
const samples=['/','/jobs/','/jobs/software-engineer/','/jobs/software-engineer/texas/','/jobs/data-analyst/raleigh-nc/','/jobs/remote/','/jobs/remote/software-engineer/','/jobs/entry-level/','/jobs/entry-level/data-analyst/','/salaries/','/salaries/data-analyst/','/application-tracker.html','/resume-search.html'];
export async function audit({root=null,output='docs/ops/seo-audit',fetchImpl=fetch,maxPages=1500}={}){
 const read=async path=>{
  if(root){const clean=decodeURIComponent(new URL(path,SITE).pathname);const file=resolve(root,'.'+(clean.endsWith('/')?clean+'index.html':clean));if(!file.startsWith(resolve(root)+sep))return {status:400,body:'',headers:{}};try{return {status:200,body:await readFile(file,'utf8'),headers:{}};}catch(e){if(e.code==='ENOENT')return {status:404,body:'',headers:{}};throw e;}}
  try{const r=await fetchImpl(SITE+path,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'FortuneJobsAI-SEO-Audit/1.0'}});return {status:r.status,body:await r.text(),headers:Object.fromEntries(r.headers)};}catch{return {status:0,body:'',headers:{}};}
 };
 const sm=await read('/sitemap.xml');if(sm.status!==200)throw Error('Sitemap unavailable');const entries=sitemapEntries(sm.body);
 const robots=await read('/robots.txt');const queue=[...new Set([...entries.map(e=>pathKey(e.url)),...samples])],seen=new Set(),pages=[],statuses={};
 // Sequential requests avoid load spikes; no external/apply URLs or query URLs are fetched.
 for(let i=0;i<queue.length && seen.size<maxPages;i++){
  const path=queue[i];if(seen.has(path))continue;seen.add(path);const r=await read(path);statuses[path]={status:r.status,location:r.headers.location||null};
  if(r.status!==200 || !/<html\b/i.test(r.body)){pages.push({url:SITE+path,path,status:r.status,title:'',description:'',links:[],mainText:'',issues:['http_status'],noindex:false});continue;}
  const p=inspect(r.body,SITE+path);p.status=r.status;
  if(/\bnoindex\b/i.test(r.headers['x-robots-tag']||''))p.noindex=true;
  if(robots.status===200 && robotsBlocked(path,robots.body))p.issues.push('robots_disallow');
  if(entries.some(e=>pathKey(e.url)===path) && p.noindex)p.issues.push('sitemap_noindex');
  pages.push(p);
  for(const to of p.links)if(!seen.has(to)&& !/\.(?:jpg|jpeg|png|svg|pdf|docx|zip|mp4|css|js)$/i.test(to) && !/^\/(?:login|profile|employer-login|employers|email-preferences|results)\.html$/.test(to))queue.push(to);
 }
 const result=graphReport(pages);
 for(const field of ['title','description']){const groups=new Map();for(const p of result)if(p[field]){if(!groups.has(p[field]))groups.set(p[field],[]);groups.get(p[field]).push(p);}for(const group of groups.values())if(group.length>1)group.forEach(p=>p.issues.push('duplicate_'+field));}
 for(const p of result){p.brokenLinks=p.links.filter(to=>statuses[to] && ![200,301,302,307,308].includes(statuses[to].status));if(p.brokenLinks.length)p.issues.push('broken_internal_link');if(p.path!=='/'&&!p.inbound.length)p.issues.push('orphan');if(p.depth===null||p.depth>3)p.issues.push('more_than_3_clicks');}
 let freshnessStatus='Not checked: live audit cannot prove successive-build stability.';
 if(root){try{const state=JSON.parse(await readFile(join(root,'jobs/seo-freshness.json'),'utf8'));const mismatches=entries.filter(e=>state[pathKey(e.url)] && state[pathKey(e.url)].lastmod!==e.lastmod);freshnessStatus=`${Object.keys(state).length} content fingerprints; ${mismatches.length} sitemap/manifest mismatches. Successive-build stability is covered by tests.`;}catch{freshnessStatus='No content fingerprint manifest yet: first build must seed it.';}}
 const report={generatedAt:new Date().toISOString(),mode:root?'local artifact':'public HTTP GET',sitemapUrls:entries.length,pagesChecked:result.length,truncated:queue.some(p=>!seen.has(p)),robotsStatus:robots.status,samples:samples.map(path=>({path,status:statuses[path]?.status??null})),freshness:freshnessStatus,limitations:['Raw response HTML, not JavaScript hydration; crawler-readable content is checked directly.','Unique word count is a within-site vocabulary heuristic, not a quality score.','Only same-origin HTML links without query strings are fetched; application URLs are never requested.','Existing Organization, WebSite, BreadcrumbList and SoftwareApplication schemas are inventoried; JobPosting is forbidden. FAQPage must match visible raw HTML.','Depth covers the scanned public graph, not private/account or query-driven navigation.'],pages:result};
 await mkdir(dirname(output),{recursive:true});await writeFile(output+'.json',JSON.stringify(report)+'\n');
 const counts={};for(const p of result)for(const issue of p.issues)counts[issue]=(counts[issue]||0)+1;
 const md=`# Technical SEO audit\n\nGenerated ${report.generatedAt}. Mode: ${report.mode}.\n\n${entries.length} sitemap URLs; ${result.length} HTML responses checked; truncated: ${report.truncated}.\n\n## Scope and limits\n\n${report.limitations.map(s=>'- '+s).join('\n')}\n\n## Freshness\n\n${freshnessStatus}\n\n## Findings\n\n| Finding | Pages |\n|---|---:|\n${Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`| ${k} | ${n} |`).join('\n')}\n\nLength and word-count findings are review warnings, not indexing diagnoses. No pages are removed or noindexed by this audit. See JSON for every URL, title, description, status, links, inbound links, depth, word counts and schema types.\n\n## Template samples\n\n${report.samples.map(s=>'- '+s.path+': '+s.status).join('\n')}\n`;
 await writeFile(output+'.md',md);return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const arg=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];};
 const report=await audit({root:arg('--root'),output:arg('--output')||'docs/ops/seo-audit'});console.log(JSON.stringify({pagesChecked:report.pagesChecked,sitemapUrls:report.sitemapUrls,truncated:report.truncated}));
}
