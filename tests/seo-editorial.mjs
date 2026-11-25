import {test} from 'node:test';import assert from 'node:assert/strict';
import {editorialSection,editorialLinks,PRIORITY_PAGES} from '../jobs/editorial.mjs';
import {renderArea,renderDemand} from '../scripts/build-job-seo.mjs';
test('fifteen selected pages use observed facts without padding unrelated pages',()=>{
 assert.equal(PRIORITY_PAGES.size,15);
 const rows=[{company:'Real A',job_title:'Data Analyst SQL',state_code:'NC'},{company:'Real B',job_title:'Data Analyst SQL',state_code:'NC'},{company:'Jobg8',job_title:'Python',state_code:'TX'}];
 const html=editorialSection('/jobs/data-analyst/raleigh-nc/',rows,'data-analyst',new Set());
 assert(html.includes('2 listings from 2'));assert(html.includes('SQL (2)'));assert(!html.includes('Python'));assert(!html.includes('Jobg8'));
 assert.equal(editorialSection('/jobs/unselected/',rows,'data-analyst',new Set()),'');
});
test('related/nearby links require a real eligible destination and do not invent a city page',()=>{
 const existing=new Set(['/jobs/business-analyst/raleigh-nc/','/jobs/data-analyst/charlotte-nc/']);
 const links=editorialLinks('/jobs/data-analyst/raleigh-nc/','data-analyst',existing);
 assert.equal(links.length,2);for(const [path] of links)assert(existing.has(path));assert(!links.some(([p])=>p.includes('data-scientist')));
});
test('demand breadcrumb schema matches the visible trail and never emits JobPosting',()=>{
 const html=renderDemand({path:'/salaries/',h1:'Listed salaries',answer:'Listed pay from current jobs.',rows:[],kind:'salary',faq:[]},'2026-11-24');
 const schema=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);assert.equal(schema['@type'],'BreadcrumbList');
 assert.deepEqual(schema.itemListElement.map(i=>i.position),[1,2,3]);for(const item of schema.itemListElement)assert(html.includes(item.name));assert(!html.includes('JobPosting'));
});
