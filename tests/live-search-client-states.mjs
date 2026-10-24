// Live Search result states in a real browser, with every network call stubbed.
// Nothing reaches Make, Apify, Adzuna or Supabase. It proves that:
//   - a failure signal is shown as a failure, never as "no jobs found";
//   - an unsigned completion marker is shown as unconfirmed, never as success;
//   - an explicit success with zero rows is the only "no jobs" state;
//   - on the gateway path, refusals are reported and results are read by search id.
// Run: node tests/live-search-client-states.mjs
// Needs Playwright and a Chromium build (PLAYWRIGHT_MODULE and CHROMIUM_PATH override the defaults).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const SB = 'https://hqgakkcxcyspqhnlnscv.supabase.co';
const GATEWAY = `${SB}/functions/v1/live-search`;
const MAKE = 'https://hook.us2.make.com/**';

const server = http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(root, path === '/' ? 'index.html' : path);
  try {
    const body = readFileSync(file);
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const RESULT_ROW = (over = {}) => ({
  job_title: 'Data Analyst', company: 'Acme Analytics', location: 'Trenton, NJ', salary: '$90,000',
  apply_url: 'https://example.com/apply/1', match_reason: 'Data analyst role', match_score: 90,
  created_at: new Date().toISOString(), source_metadata: null, ...over,
});
const MARKER = (signal) => RESULT_ROW({
  job_title: 'No matching jobs found', company: 'N/A', location: 'N/A', salary: null, apply_url: null,
  match_reason: 'Search complete', match_score: 0, source_metadata: signal ? { signal } : null,
});

let failures = 0;
// The page is settled once it shows any outcome, or result cards.
const OUTCOME = /did not finish|could not confirm|No live results|Search unavailable/i;
async function scenario(name, { hashRoute, rows, gateway, statusState = 'pending', expect }) {
  const browser = globalThis.__browser;
  const page = await browser.newPage();
  const seen = { jobMatchesUrls: [], gatewayBodies: [], statusUrls: [], makeCalls: 0 };
  await page.route('**/results.html**', (route) => {
    let html = readFileSync(join(root, 'results.html'), 'utf8');
    if (hashRoute === 'gateway') html = html.replace('const LIVE_SEARCH_VIA_GATEWAY = false;', 'const LIVE_SEARCH_VIA_GATEWAY = true;');
    route.fulfill({ status: 200, contentType: 'text/html', body: html });
  });
  await page.route(MAKE, (route) => { seen.makeCalls++; route.fulfill({ status: 200, headers: CORS, body: 'Accepted' }); });
  await page.route(`${GATEWAY}**`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (route.request().method() === 'GET') {
      seen.statusUrls.push(route.request().url());
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ state: statusState, results: 0 }) });
    }
    seen.gatewayBodies.push(route.request().postData() || '');
    const g = gateway || { status: 202, body: { status: 'accepted', search_id: 's_test_1' } };
    route.fulfill({ status: g.status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(g.body) });
  });
  await page.route(`${SB}/rest/v1/job_matches**`, (route) => {
    const url = route.request().url();
    seen.jobMatchesUrls.push(url);
    // PostgREST filter values look like "eq.<id>"; the mock matches on the bare id.
    const id = (new URL(url).searchParams.get('search_id') || '').replace(/^eq\./, '');
    const pick = typeof rows === 'function' ? rows(id) : rows;
    route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(pick || []) });
  });
  await page.route(`${SB}/rest/v1/**`, (route) => {
    if (route.request().url().includes('/job_matches')) return route.fallback();
    route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: '[]' });
  });
  await page.route(`${SB}/functions/v1/**`, (route) => {
    if (route.request().url().startsWith(GATEWAY)) return route.fallback();
    route.fulfill({ status: 200, headers: CORS, body: '{}' });
  });

  // The results page runs the search from its own URL, exactly as production does.
  await page.goto(`${base}/results.html?q=data+analyst&mode=live&v=20261010-accuracy`, { waitUntil: 'domcontentloaded' });
  const titleOf = () => page.evaluate(() => document.getElementById('resultsTitle').textContent);
  const countOf = () => page.evaluate(() => document.getElementById('resultsCount').textContent);
  const cardsOf = () => page.evaluate(() => document.querySelectorAll('.job-card').length);
  const deadline = Date.now() + 25000;
  let title = '', count = '', cards = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    [title, count, cards] = [await titleOf(), await countOf(), await cardsOf()];
    if (expect.settled(title, count, cards)) break;
  }
  const verdict = expect.check({ title, count, cards, seen });
  await page.close();
  if (verdict.ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}: ${verdict.why}\n     title=${JSON.stringify(title)} count=${JSON.stringify(count)} cards=${cards}`); }
}

const { chromium: _c } = { chromium };
globalThis.__browser = await _c.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});

try {
  await scenario('unsigned completion marker is not reported as no jobs', {
    hashRoute: 'direct',
    rows: () => [MARKER(null)],
    expect: {
      settled: (t, c, cards) => cards > 0 || OUTCOME.test(t),
      check: ({ title }) => ({
        ok: /could not confirm|not confirmed/i.test(title),
        why: 'an unsigned marker must read as unconfirmed',
      }),
    },
  });
  await scenario('explicit failure is reported as a failure, not no jobs', {
    hashRoute: 'direct',
    rows: () => [MARKER('failure')],
    expect: {
      settled: (t, c, cards) => cards > 0 || OUTCOME.test(t),
      check: ({ title, count }) => ({
        ok: /did not finish|stopped early/i.test(title) && !/no jobs matched/i.test(count + title),
        why: 'a failure signal must never read as no jobs found',
      }),
    },
  });
  await scenario('explicit success with zero rows is the only no-jobs state', {
    hashRoute: 'direct',
    rows: () => [MARKER('success')],
    expect: {
      settled: (t, c, cards) => cards > 0 || OUTCOME.test(t),
      check: ({ title }) => ({
        ok: /no live results|No jobs matched/i.test(title) || /no live results/i.test(title),
        why: 'an explicit success with no rows should show the no-jobs state',
      }),
    },
  });
  await scenario('gateway refusal is shown with the reason, and Make is never called', {
    hashRoute: 'gateway',
    gateway: { status: 503, body: { status: 'error', reason: 'at_capacity', message: 'Live Search is busy right now. Quick Match is still available.' } },
    expect: {
      settled: (t, c, cards) => cards > 0 || OUTCOME.test(t),
      check: ({ count, seen }) => ({
        ok: /busy right now/.test(count) && seen.makeCalls === 0 && seen.gatewayBodies.length === 1,
        why: 'the refusal message must be shown, with the gateway as the only route',
      }),
    },
  });
  await scenario('gateway path reads results only by the id the gateway issued', {
    hashRoute: 'gateway',
    rows: (id) => (id === 's_test_1' ? [RESULT_ROW(), RESULT_ROW({ job_title: 'Data Analyst II', apply_url: 'https://example.com/apply/2' }), MARKER('success')] : []),
    expect: {
      settled: (t, c, cards) => cards > 0,
      check: ({ seen, cards }) => ({
        ok: cards >= 1 && seen.jobMatchesUrls.length > 0 && seen.jobMatchesUrls.every((u) => u.includes('search_id=eq.s_test_1')) && seen.makeCalls === 0,
        why: 'every result read must filter by the gateway search id, and Make must not be called directly',
      }),
    },
  });
  await scenario('gateway status "failed" with no rows ends as a failure, not a long wait', {
    hashRoute: 'gateway',
    rows: () => [],
    statusState: 'failed',
    expect: {
      settled: (t, c, cards) => cards > 0 || OUTCOME.test(t),
      check: ({ title, seen }) => ({
        ok: /did not finish/i.test(title) && seen.statusUrls.length > 0
          && seen.statusUrls.every((u) => u.includes('search_id=s_test_1')) && seen.makeCalls === 0,
        why: 'a failed admission must be reported from the gateway status, by the gateway search id',
      }),
    },
  });
  await scenario('gateway status "indeterminate" is unconfirmed, never no jobs', {
    hashRoute: 'gateway',
    rows: () => [],
    statusState: 'indeterminate',
    expect: {
      settled: (t, c, cards) => cards > 0 || OUTCOME.test(t),
      check: ({ title }) => ({
        ok: /could not confirm/i.test(title),
        why: 'an unsignalled ending is not proof that nothing matched',
      }),
    },
  });
  await scenario('direct route never calls the gateway status endpoint', {
    hashRoute: 'direct',
    rows: () => [MARKER('success')],
    expect: {
      settled: (t, c, cards) => cards > 0 || OUTCOME.test(t),
      check: ({ seen }) => ({
        ok: seen.statusUrls.length === 0 && seen.gatewayBodies.length === 0 && seen.makeCalls === 1,
        why: 'with the switch off, the page must use only the existing Make route',
      }),
    },
  });
} finally {
  await globalThis.__browser.close();
  server.close();
}

console.log(failures ? `\n${failures} scenario(s) failed` : '\nall scenarios passed');
process.exit(failures ? 1 : 0);
