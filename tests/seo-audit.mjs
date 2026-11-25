import {test} from 'node:test';import assert from 'node:assert/strict';
import {inspect,graphReport,sitemapEntries,robotsBlocked} from '../scripts/seo-audit.mjs';
import {freshness} from '../scripts/seo-freshness.mjs';
import {addSitemapUrls} from '../scripts/build-job-seo.mjs';
const page=(path,links=[])=>({path,mainText:'Useful unique content',title:path,links,issues:[]});
test('raw HTML detects non-self canonical, mismatched FAQ and JS-only shells',()=>{
 const p=inspect('<html><head><title>Useful sample job search</title><link rel="canonical" href="https://fortunejobsai.com/wrong/"><script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"name":"Missing question","acceptedAnswer":{"text":"Missing answer"}}]}</script></head><body><div id="root"></div></body></html>','https://fortunejobsai.com/jobs/');
 for(const code of ['canonical_not_self','faq_not_in_html','h1_count','little_crawler_content'])assert(p.issues.includes(code));
});
test('graph counts incoming links, home aliases, orphans and depth without counting self links',()=>{
 const rows=graphReport([page('/',['/jobs/']),page('/jobs/',['/role/']),page('/role/',['/state/']),page('/state/',['/city/']),page('/city/'),page('/alone/',['/alone/'])]);
 assert.equal(rows.find(p=>p.path==='/city/').depth,4);assert.equal(rows.at(-1).depth,null);assert.deepEqual(rows.at(-1).inbound,[]);
});
test('sitemap dates and longest matching robots rules are read',()=>{
 assert.deepEqual(sitemapEntries('<url><loc>https://fortunejobsai.com/jobs/</loc><lastmod>2026-11-24</lastmod></url>'),[{url:'https://fortunejobsai.com/jobs/',lastmod:'2026-11-24'}]);
 const robots='User-agent: *\nDisallow: /private/\nAllow: /private/public/';assert(robotsBlocked('/private/a',robots));assert(!robotsBlocked('/private/public/a',robots));
});
test('freshness ignores clock-only rebuilds, catches hidden job replacement and salary/template edits',()=>{
 const html='<h1>Data Analyst</h1><p>Updated November 24, 2026</p>';const rows=[{id:1,company:'A',posted_at:'2026-11-01',salary:'$100,000'}];
 const first=freshness(null,html,'2026-11-24',rows);
 assert.equal(freshness(first,html.replace('24,','25,'),'2026-11-25',rows).lastmod,'2026-11-24');
 const withRecent=freshness(null,html+'<p>1 posted in the last 7 days · 2 employers hiring</p>','2026-11-24',rows);
 assert.equal(freshness(withRecent,html+'<p>2 employers hiring</p>','2026-11-25',rows).lastmod,'2026-11-24');
 assert.equal(freshness(first,html,'2026-11-25',[{...rows[0],id:2}]).lastmod,'2026-11-25');
 assert.equal(freshness(first,html,'2026-11-25',[{...rows[0],salary:'$110,000'}]).lastmod,'2026-11-25');
 assert.equal(freshness(first,html+'<p>Changed useful explanation</p>','2026-11-25',rows).lastmod,'2026-11-25');
 assert.equal(freshness(first,html,'2026-11-25',[{...rows[0],updated_at:'2026-11-25'}]).lastmod,'2026-11-24');
});

test('static tool sitemap dates use their content record instead of the daily build date',()=>{const xml=addSitemapUrls('<urlset></urlset>',['/application-tracker.html'],'2026-11-25',{'/application-tracker.html':{lastmod:'2026-11-24'}});assert(xml.includes('<lastmod>2026-11-24</lastmod>'));assert(!xml.includes('2026-11-25'));});
