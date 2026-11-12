import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPartnerHandler } from '../supabase/functions/_shared/live-job-partner.mjs';
import { searchWhatJobs, whatJobsListings } from '../supabase/functions/whatjobs-search/search.mjs';

const row = { title: 'Analyst', company: 'Example', location: 'Raleigh', age: '2 days ago', salary: '$80,000', snippet: '<span class="highlighted">Reports</span> and SQL', url: 'https://www.whatjobs.com/track?a=one%2Btwo&b=three' };
const request = location => new Request('https://edge.example.test', {
  method: 'POST',
  headers: { origin: 'https://fortunejobsai.com', 'x-forwarded-for': '203.0.113.10, 10.0.0.1', 'user-agent': 'Fixture browser' },
  body: JSON.stringify({ q: 'Data Analyst', location, page: 2, user_ip: '192.0.2.10' }),
});

test('cleans highlights and keeps the exact tracking URL', () => {
  assert.deepEqual(whatJobsListings({ data: [row, row, { ...row, url: 'javascript:alert(1)' }] }), [{
    title: row.title, company: row.company, location: row.location, date: row.age,
    salary: row.salary, description: 'Reports and SQL', url: row.url,
  }]);
  assert.deepEqual(whatJobsListings({ data: null }), []);
});

test('builds a publisher request from the search and edge headers', async () => {
  const handler = createPartnerHandler({ getKey: () => '7594', search: searchWhatJobs, fetchImpl: async (url, init) => {
    assert.equal(url.origin + url.pathname, 'https://api.whatjobs.com/api/v1/jobs.json');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      publisher: '7594', user_ip: '203.0.113.10', user_agent: 'Fixture browser', keyword: 'Data Analyst',
      location: 'Raleigh', limit: '20', page: '2', radius: '25',
    });
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    return Response.json({ data: [row] });
  } });
  const response = await handler(request('Raleigh'));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await response.json()).jobs[0].url, row.url);
});

test('falls back on validation errors, maintenance and timeout', async () => {
  for (const fetchImpl of [async () => new Response(null, { status: 422 }), async () => new Response(null, { status: 503 }), async () => { throw new DOMException('Timeout', 'TimeoutError'); }]) {
    const handler = createPartnerHandler({ getKey: () => '7594', search: searchWhatJobs, fetchImpl });
    assert.deepEqual(await (await handler(request(''))).json(), { jobs: [] });
  }
});
