import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { KEY, ping, urlsFor } from '../scripts/indexnow.mjs';

test('the key file served at the site root matches the key', () => {
  assert.equal(readFileSync(new URL('../' + KEY + '.txt', import.meta.url), 'utf8'), KEY);
});

test('only changed, indexable pages are submitted', () => {
  const pages = {
    'jobs/data-analyst/raleigh-nc/index.html': '<html><head></head></html>',
    'jobs/data-analyst/tiny-town-nc/index.html': '<meta name="robots" content="noindex,follow">',
    'sitemap.xml': '<urlset/>',
    'results.html': '<html></html>',
  };
  assert.deepEqual(urlsFor([...Object.keys(pages), 'jobs/gone/index.html'], f => pages[f] ?? null),
    ['https://fortunejobsai.com/jobs/data-analyst/raleigh-nc/']);
});

test('ping posts the key and URLs and accepts 200/202', async () => {
  let sent;
  const out = await ping(['https://fortunejobsai.com/jobs/'], async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { status: 202 }; });
  assert.equal(sent.url, 'https://api.indexnow.org/indexnow');
  assert.equal(sent.body.key, KEY);
  assert.deepEqual(sent.body.urlList, ['https://fortunejobsai.com/jobs/']);
  assert.match(out, /1 URLs submitted/);
  await assert.rejects(ping(['x'], async () => ({ status: 403 })));
});

test('salary and H-1B pages are submitted too', () => {
  const html = '<html><head></head></html>';
  assert.deepEqual(urlsFor(['salaries/data-analyst/texas/index.html', 'h1b/data-analyst/index.html', 'react/dist/index.html'], () => html),
    ['https://fortunejobsai.com/salaries/data-analyst/texas/', 'https://fortunejobsai.com/h1b/data-analyst/']);
});
