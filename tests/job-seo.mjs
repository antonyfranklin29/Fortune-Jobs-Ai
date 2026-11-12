import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applicationUrl, cityListings, jobPosting } from '../jobs/catalogue.mjs';
import { addSitemapUrls, renderCity } from '../scripts/build-job-seo.mjs';

const now = Date.parse('2026-11-11T16:00:00Z');
const target = { city: 'Raleigh', state: 'NC', role: 'data-analyst', title: 'Data Analyst' };
const job = {
  id: 100, country: 'us', canonical_role: 'data-analyst', state_code: 'NC',
  company: 'Sample Employer', job_title: 'Data Analyst', location: 'Raleigh, NC',
  posted_at: '2026-11-10T16:00:00Z', expires_at: '2026-12-01T16:00:00Z',
  closed_at: null, source: 'employer_direct', is_remote: false,
  apply_url: 'https://example.com/jobs/100?a=1&b=2',
  job_description: 'Maintain reporting dashboards and analyze data with the operations team.',
};

test('city results require a current distinct listing in the requested city, state and role', () => {
  const rows = [
    job, { ...job, id: 101 }, { ...job, id: 102, location: 'Raleigh Hills, OR', state_code: 'OR' },
    { ...job, id: 103, closed_at: '2026-11-11T10:00:00Z' },
    { ...job, id: 104, expires_at: '2026-11-11T10:00:00Z' },
    { ...job, id: 105, job_title: 'TEST Data Analyst, please ignore' },
    { ...job, id: 106, location: 'Raleigh Hills, NC' },
  ];
  assert.deepEqual(cityListings(rows, target, now).map(row => row.id), [100]);
  assert.equal(applicationUrl('javascript:alert(1)'), '');
  assert.equal(applicationUrl('https://user:pass@example.com/jobs'), '');
  assert.equal(applicationUrl(job.apply_url), job.apply_url);
  assert.equal(applicationUrl('https://www.adzuna.com/land/ad/1234'), 'https://www.adzuna.com/details/1234');
  assert.equal(applicationUrl('https://www.adzuna.com/land/ad/1234?se=one&v=two'), 'https://www.adzuna.com/land/ad/1234?se=one&v=two');
});

test('city HTML noindexes fewer than five listings and never emits JobPosting', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    ...job, id: job.id + i, job_title: 'Data Analyst <example>', apply_url: job.apply_url + '&id=' + i,
  }));
  const detailIds = new Set(['100']);
  const sparse = renderCity(target, rows.slice(0, 4), detailIds, '2026-11-11');
  const indexable = renderCity(target, rows, detailIds, '2026-11-11');
  assert.match(sparse, /name="robots" content="noindex,follow"/);
  assert.doesNotMatch(indexable, /noindex|JobPosting|<example>/);
  assert.match(indexable, /Data Analyst &lt;example&gt;/);
  assert.match(indexable, /href="\/jobs\/posting\/100\/"/);
  for (const page of [sparse, indexable]) {
    assert.equal(page.match(/static\.cloudflareinsights\.com\/beacon\.min\.js/g)?.length, 1);
    assert.match(page, /data-cf-beacon=/);
  }
});

test('Google markup is built only from a complete, eligible, open employer listing', () => {
  const schema = jobPosting(job, now);
  assert.equal(schema['@type'], 'JobPosting');
  assert.equal(schema.description, job.job_description);
  assert.equal(schema.hiringOrganization.name, job.company);
  assert.equal(schema.jobLocation.address.addressLocality, 'Raleigh');
  assert.equal(schema.datePosted, '2026-11-10T16:00:00.000Z');
  assert.equal(schema.validThrough, '2026-12-01T16:00:00.000Z');
  assert.equal(schema.url, 'https://fortunejobsai.com/jobs/posting/100/');
  for (const changed of [
    { source: 'adzuna' }, { source: 'employer_feed' }, { expires_at: null },
    { expires_at: '2026-11-11T12:00:00Z' }, { closed_at: '2026-11-11T12:00:00Z' },
    { job_description: 'See link' }, { apply_url: 'https://fortunejobsai.com/contact.html' },
    { job_title: 'Test listing - do not apply' }, { work_mode: 'Remote' },
  ]) assert.equal(jobPosting({ ...job, ...changed }, now), null);
  assert.equal(jobPosting(undefined, now), null);
});

test('sitemap regeneration preserves existing pages and removes stale generated paths', () => {
  const initial = '<urlset><url><loc>https://fortunejobsai.com/</loc></url>\n</urlset>';
  const first = addSitemapUrls(initial, ['/jobs/', '/jobs/posting/100/']);
  const refreshed = addSitemapUrls(first, ['/jobs/']);
  assert.match(refreshed, /<loc>https:\/\/fortunejobsai\.com\/<\/loc>/);
  assert.match(refreshed, /<loc>https:\/\/fortunejobsai\.com\/jobs\/<\/loc>/);
  assert.doesNotMatch(refreshed, /posting\/100/);
  assert.equal(addSitemapUrls(refreshed, ['/jobs/']), refreshed);
});
