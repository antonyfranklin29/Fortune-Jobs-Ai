import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {areaFacts,answerBlock,areaFaq,faqSchema,parsedPay,percentile,hubAnswer,hubFaq,licenseAnswer} from '../jobs/geo.mjs';
import {renderArea,renderHub,planHubs,planPages,hubDirectory,addSitemapUrls} from '../scripts/build-job-seo.mjs';
import {openListing} from '../jobs/catalogue.mjs';
const date='2026-11-23',now=Date.parse(date+'T15:00:00Z');
const {roles}=JSON.parse(readFileSync('config/job-roles.json','utf8'));
const {regions}=JSON.parse(readFileSync('config/us-regions.json','utf8'));
const target={role:'registered-nurse',title:'Registered Nurse',state:'AZ',stateName:'Arizona'};
const row=(i,patch={})=>({id:i+1,job_title:'Registered Nurse',canonical_role:'registered-nurse',company:i%2?'Care & Health':'A <Hospital>',location:'Phoenix, AZ',state_code:'AZ',country:'us',closed_at:null,posted_at:date,apply_url:'https://fixture.test/'+i,source:'whatjobs',...patch});
const unescape=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const textBlock=html=>unescape(html.match(/<p class="geo-answer">(.*?)<\/p>/s)[1]);
const schemas=html=>[...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(match=>JSON.parse(match[1]));
const visibleFaq=html=>[...html.match(/<section class="faq"[\s\S]*?<\/section>/)[0].matchAll(/<h3>(.*?)<\/h3><p>(.*?)<\/p>/gs)].map(([,q,a])=>({q:unescape(q),a:unescape(a)}));
const wordCount=text=>text.trim().split(/\s+/).length;

test('salary parsing keeps units separate, ignores foreign/unknown pay and computes linear quartiles',()=>{
 assert.deepEqual(parsedPay('$38–$52/hr'),{unit:'hour',midpoint:45});
 assert.deepEqual(parsedPay('USD 80k - 100k per year'),{unit:'year',midpoint:90000});
 assert.deepEqual(parsedPay('$80-100k / year'),{unit:'year',midpoint:90000});
 assert.deepEqual(parsedPay('$80,000 base + $20,000 bonus'),{unit:'year',midpoint:80000});
 for(const salary of ['CAD $90,000','€80,000','$4,000 per month','not listed','45/hr'])assert.equal(parsedPay(salary),null);
 assert.equal(percentile([50,10,40,20,30],.25),20);assert.equal(percentile([50,10,40,20,30],.75),40);
 assert.equal(percentile([10,20,30,40],.25),17.5);assert.equal(percentile([], .25),null);
});

test('answer and FAQ use five usable hourly salaries and never mix yearly amounts into quartiles',()=>{
 const rows=Array.from({length:6},(_,i)=>row(i,{salary:i===5?'$150,000 / year':'$'+(30+i*5)+'/hr',job_title:i===0?'Junior Registered Nurse':'Registered Nurse',sponsorship:i===1?'opt_friendly':null}));
 const facts=areaFacts(rows,target.role);assert.deepEqual(facts.pay,{unit:'hour',low:35,high:45,count:5});
 assert.equal(facts.entry,1);assert.equal(facts.visa,1);assert.equal(facts.remote,0);
 const answer=answerBlock(target,facts,date,'Arizona');assert.match(answer,/6 open Registered Nurse jobs in Arizona/);assert.match(answer,/\$35–\$45 an hour/);assert.match(answer,/1 listing mentions visa/);
 assert(wordCount(answer)>=40 && wordCount(answer)<=80);
 const faq=areaFaq(target,facts,date,'Arizona',rows);assert(faq.length>=3 && faq.length<=5);assert(faq.some(item=>item.q==='Do I need a license?'));
 assert(faq.some(item=>item.a.includes('confirm with the employer')));
});

test('sparse pay is omitted and supported entry-level questions appear without invented zero claims',()=>{
 const rows=Array.from({length:5},(_,i)=>row(i,{salary:i<4?'$40/hr':null,job_description:i===0?'New grad welcome.':null}));
 const facts=areaFacts(rows,target.role);assert.equal(facts.pay,null);
 const answer=answerBlock(target,facts,date,'Arizona');assert.doesNotMatch(answer,/Listed pay|visa sponsorship|marked remote/);assert(wordCount(answer)>=40 && wordCount(answer)<=80);
 const faq=areaFaq(target,facts,date,'Arizona',rows);assert(!faq.some(item=>item.q.startsWith('How much')));assert(faq.some(item=>item.q.startsWith('Are there entry-level')));
 const tech=areaFacts(rows.map(job=>({...job,canonical_role:'software-engineer',is_remote:true})),'software-engineer');assert.equal(tech.remote,5);
 assert.match(answerBlock({title:'Software Engineer'},tech,date,'Arizona'),/5 tech listings are marked remote/);
});

test('indexed area HTML contains directly adjacent answer, dated line, exact visible FAQ JSON-LD and no JobPosting',()=>{
 const rows=Array.from({length:5},(_,i)=>row(i,{salary:'$40/hr'}));
 const html=renderArea(target,rows,new Set(),date),faq=visibleFaq(html);
 assert.match(html,/<\/h1><p class="geo-answer">/);assert.match(html,/Updated <time datetime="2026-11-23">November 23, 2026/);
 assert(wordCount(textBlock(html))>=40 && wordCount(textBlock(html))<=80);
 const schema=schemas(html).find(item=>item['@type']==='FAQPage');assert.deepEqual(schema,faqSchema(faq));
 assert.doesNotMatch(html,/JobPosting|<Hospital>/);assert.match(html,/A &lt;Hospital&gt;/);assert.equal(faq.length,4);
 assert(html.includes('href="https://fixture.test/0"')); // partner URL untouched
});

test('FAQ data escapes closing scripts without changing visible text and thin city pages stay noindex without FAQ',()=>{
 const rows=Array.from({length:5},(_,i)=>row(i,{company:'Safe </script><script>alert(1)</script>'}));
 const html=renderArea(target,rows,new Set(),date);assert.deepEqual(schemas(html).find(s=>s['@type']==='FAQPage'),faqSchema(visibleFaq(html)));
 assert.doesNotMatch(html,/<script>alert/);
 const sparse=renderArea({...target,city:'Phoenix'},rows.slice(0,4),new Set(),date);
 assert.match(sparse,/noindex,follow/);assert(!schemas(sparse).some(s=>s['@type']==='FAQPage'));
});

test('provider names never become advertisers; licence advice is generic and only supported transport classes are mentioned',()=>{
 assert.equal(openListing(row(1,{company:'Jobg8'}),now),false);
 const facts=areaFacts([row(0),row(1,{company:'Jobg8'})],target.role);assert.equal(facts.count,1);assert(!JSON.stringify(facts).includes('Jobg8'));
 assert.match(licenseAnswer('registered-nurse',[]),/participating states/);
 assert.match(licenseAnswer('licensed-practical-nurse',[]),/LPN\/LVN/);assert.match(licenseAnswer('certified-nursing-assistant',[]),/registry/);
 assert.equal(licenseAnswer('delivery-driver',[row(1,{job_title:'Delivery Driver'})]),null);
 assert.match(licenseAnswer('cdl-truck-driver',[row(1,{job_title:'CDL-A Truck Driver'})]),/CDL-A or CDL-B/);
});

test('category hubs require 25 distinct open jobs and exclude expired, closed and duplicate rows',()=>{
 const rows=Array.from({length:25},(_,i)=>row(i));
 const rejected=[{...rows[0],id:200},{...row(201),closed_at:date},{...row(202),expires_at:'2026-11-22'},{...row(203),company:'Jobg8'}];
 assert.equal(planHubs([...rows.slice(0,24),...rejected],roles,regions,now).length,0);
 const hubs=planHubs([...rows,...rejected],roles,regions,now);assert.equal(hubs.length,1);assert.equal(hubs[0].id,'healthcare');assert.equal(hubs[0].rows.length,25);
 assert.match(hubDirectory(hubs),/href="\/jobs\/healthcare\/"/);assert.doesNotMatch(hubDirectory(hubs),/transport/);
});

test('hub answer length, real counts, indexed state links and FAQ mirror match exactly',()=>{
 const rows=Array.from({length:25},(_,i)=>row(i));const hubs=planHubs(rows,roles,regions,now);
 const pages=planPages(rows,roles,regions,now);const html=renderHub(hubs[0],pages.statePages,date);
 assert(wordCount(textBlock(html))>=60 && wordCount(textBlock(html))<=100);
 assert.match(html,/25 open healthcare jobs/);assert.match(html,/href="\/jobs\/registered-nurse\/arizona\/"/);
 assert.deepEqual(schemas(html).find(s=>s['@type']==='FAQPage'),faqSchema(visibleFaq(html)));assert.equal(visibleFaq(html).length,5);
 assert.doesNotMatch(html,/JobPosting|Jobg8/);
 const techRows=Array.from({length:25},(_,i)=>row(i,{canonical_role:'software-engineer',job_title:'Software Engineer'}));
 const techHub=planHubs(techRows,roles,regions,now)[0];assert.equal(techHub.id,'tech');
 assert.doesNotMatch(renderHub(techHub,[],date),/href="\/jobs\/software-engineer\/arizona\/"/);
});

test('generated sitemap entries all use generation lastmod, preserve static entries and exclude thin pages',()=>{
 const rows=Array.from({length:25},(_,i)=>row(i));const pages=planPages(rows,roles,regions,now);
 const paths=['/jobs/','/jobs/healthcare/',...pages.statePages.map(({target})=>'/jobs/'+target.role+'/arizona/')];
 const xml=addSitemapUrls('<urlset><url><loc>https://fortunejobsai.com/</loc><lastmod>2026-01-01</lastmod></url></urlset>',paths,date);
 assert.equal((xml.match(/<lastmod>2026-11-23<\/lastmod>/g)||[]).length,paths.length);
 assert.match(xml,/<lastmod>2026-01-01<\/lastmod>/);assert(!paths.some(path=>path.includes('transport')));
 assert.equal(addSitemapUrls(xml,paths,date),xml);assert.throws(()=>addSitemapUrls(xml,paths,'not-a-date'));
 const thin=planPages(rows.slice(0,4),roles,regions,now);assert.equal(thin.statePages.length,0);assert.equal(thin.cityPages.filter(page=>page.rows.length>=5).length,0);
});

test('near-identical salaries read as one typical figure, and large counts get thousands separators',async()=>{
 const geo=await import('../jobs/geo.mjs');
 assert.equal(geo.payRange({unit:'year',low:122975.2,high:122976.4}),'about $122,975 a year');
 assert.equal(geo.payRange({unit:'hour',low:38,high:52}),'$38–$52 an hour');
 assert.equal(geo.fmt(1048),'1,048');
 const hub={id:'healthcare',label:'Healthcare',rows:Array.from({length:1048},()=>({})),roleCounts:[{name:'Registered Nurse',count:1048}],stateCounts:[{name:'Pennsylvania',count:200}]};
 const text=geo.hubAnswer(hub,'2026-11-23');
 assert.match(text,/lists 1,048 open healthcare jobs in the United States/);
 assert.doesNotMatch(text,/across 1 role/);
});
