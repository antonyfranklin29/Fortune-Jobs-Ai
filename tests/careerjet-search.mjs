import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPartnerHandler } from '../supabase/functions/_shared/live-job-partner.mjs';
import { careerjetJobs, searchCareerjet } from '../supabase/functions/careerjet-search/search.mjs';

const origin = 'https://fortunejobsai.com';
const request = (body = { q: 'Data Analyst', location: 'Raleigh, NC' }, options = {}) => new Request('https://edge.example.test', {
  method: 'POST', body: JSON.stringify(body),
  headers: { origin, 'x-forwarded-for': '203.0.113.20, 10.0.0.1', 'user-agent': 'Browser fixture', ...options },
});
const row = { title: ' Analyst ', company: 'Example', locations: 'Raleigh', date: 'Nov 11', salary: '$80,000', description: '<b>Build reports</b>', url: 'https://jobviewtrack.com/v2/listing?a=1&b=2' };

test('maps only valid unique Careerjet click URLs and removes HTML from excerpts', () => {
  const bad = ['javascript:alert(1)', 'https://a:b@example.com', '/not-absolute'];
  const jobs = careerjetJobs({ type: 'JOBS', jobs: [row, row, null, ...bad.map(url => ({ ...row, url }))] });
  assert.deepEqual(jobs, [{ title: 'Analyst', company: 'Example', location: 'Raleigh', date: 'Nov 11', salary: '$80,000', description: 'Build reports', url: row.url }]);
  assert.deepEqual(careerjetJobs({ type: 'LOCATIONS', jobs: [row] }), []);
});

test('uses the publisher v4 endpoint, credentials and visitor context', async () => {
  const handler = createPartnerHandler({ getKey: () => 'fixture', search: searchCareerjet, fetchImpl: async (url, init) => {
    assert.equal(url.origin + url.pathname, 'https://search.api.careerjet.net/v4/query');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      locale_code: 'en_US', keywords: 'Data Analyst', location: 'Raleigh, NC', page: '1', page_size: '20',
      user_ip: '203.0.113.20', user_agent: 'Browser fixture',
    });
    assert.equal(init.headers.Authorization, 'Basic ' + btoa('fixture:'));
    assert.equal(init.headers.Referer, origin + '/results.html');
    assert.ok(init.signal);
    return Response.json({ type: 'JOBS', jobs: [row] });
  } });
  const response = await handler(request());
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await response.json()).jobs[0].url, row.url);
});

test('blocks unsupported origins and malformed requests before upstream calls', async () => {
  let calls = 0;
  const handler = createPartnerHandler({ getKey: () => 'fixture', search: async () => { calls++; return []; } });
  assert.equal((await handler(request(undefined, { origin: 'https://other.test' }))).status, 403);
  assert.equal((await handler(new Request('https://edge.example.test', { method: 'OPTIONS', headers: { origin } }))).status, 204);
  assert.deepEqual(await (await handler(request({ q: 'Analyst', page: 11 }))).json(), { jobs: [] });
  assert.deepEqual(await (await handler(request(undefined, { 'x-forwarded-for': 'invalid' }))).json(), { jobs: [] });
  assert.equal(calls, 0);
});

test('falls back silently for upstream errors, timeouts or missing keys', async () => {
  for (const fetchImpl of [async () => Response.json({ message: 'bad key' }, { status: 401 }), async () => { throw new DOMException('Timeout', 'TimeoutError'); }, async () => new Response('invalid json')]) {
    const handler = createPartnerHandler({ getKey: () => 'fixture', search: searchCareerjet, fetchImpl });
    assert.deepEqual(await (await handler(request())).json(), { jobs: [] });
  }
  const handler = createPartnerHandler({ getKey: () => '', search: () => { assert.fail('unexpected call'); } });
  assert.deepEqual(await (await handler(request())).json(), { jobs: [] });
});

test('limits bursts per isolate and resets the window', async () => {
  let calls = 0;
  let time = 0;
  const handler = createPartnerHandler({ getKey: () => 'fixture', now: () => time, search: async () => { calls++; return []; } });
  for (let i = 0; i < 8; i++) await handler(request());
  assert.equal(calls, 6);
  time += 60_000;
  await handler(request());
  assert.equal(calls, 7);
});
