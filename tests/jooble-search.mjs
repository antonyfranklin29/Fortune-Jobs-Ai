import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPartnerHandler } from '../supabase/functions/_shared/live-job-partner.mjs';
import { joobleJobs, searchJooble } from '../supabase/functions/jooble-search/search.mjs';

const row = { title: 'Analyst', company: 'Example', location: 'Raleigh', snippet: '<b>Reporting</b>', salary: '$80,000', updated: '2026-11-11T00:00:00Z', link: 'https://jooble.org/jdp/123?tracking=fixture' };
const request = (body = { q: 'Data Analyst' }) => new Request('https://edge.example.test', {
  method: 'POST', body: JSON.stringify(body),
  headers: { origin: 'https://fortunejobsai.com', 'x-forwarded-for': '203.0.113.20', 'user-agent': 'Fixture browser' },
});

test('maps the Jooble fields and preserves the click-through link', () => {
  assert.deepEqual(joobleJobs({ jobs: [row, { ...row, link: 'javascript:alert(1)' }, row] }), [{
    title: row.title, company: row.company, location: row.location, description: 'Reporting',
    salary: row.salary, date: row.updated, url: row.link,
  }]);
  assert.deepEqual(joobleJobs({ jobs: null }), []);
});

test('calls the US endpoint without forwarding visitor IP, browser or account fields', async () => {
  const handler = createPartnerHandler({
    getKey: () => 'fixture', search: searchJooble,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://jooble.org/api/fixture');
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { keywords: 'Data Analyst', location: 'United States', page: 1, ResultOnPage: 20 });
      assert.deepEqual(Object.keys(init.headers).sort(), ['Accept', 'Content-Type']);
      assert.equal(init.redirect, 'error');
      return Response.json({ totalCount: 1, jobs: [row] });
    },
  });
  assert.equal((await (await handler(request({ q: 'Data Analyst', account_id: 'private-fixture' }))).json()).jobs[0].url, row.link);
});

test('keeps searches usable when Jooble quota is exhausted or the provider fails', async () => {
  for (const fetchImpl of [async () => new Response(null, { status: 429 }), async () => { throw new Error('fixture'); }]) {
    const handler = createPartnerHandler({ getKey: () => 'fixture', search: searchJooble, fetchImpl });
    assert.deepEqual(await (await handler(request())).json(), { jobs: [] });
  }
});
