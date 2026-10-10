const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function source(name) {
  const match = html.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
  assert.ok(match, 'Missing function ' + name);
  return match[0];
}
function harness(fetch) {
  const timers = new Map();
  let id = 0;
  const elements = new Map();
  const context = vm.createContext({
    fetch, AbortController, console,
    SUPABASE_KEY: 'test', SUPABASE_URL: 'https://test.invalid',
    FREE_RESULTS: 10, SEARCH_REQUEST_TIMEOUT_MS: 10000, POLL_INTERVAL_MS: 3000, MAX_WAIT_MS: 300000,
    QUICK_CANDIDATE_LIMIT: 300, STOPWORDS: new Set(),
    searchGeneration: 1, pollInFlight: false, activePollFn: null, activeAbortCtrl: null,
    pollingTimer: null, timeoutTimer: null, initialWaitTimer: null,
    setTimeout(fn, ms) { const key = ++id; timers.set(key, { fn, ms }); return key; },
    clearTimeout(key) { timers.delete(key); },
    document: { getElementById(key) { if (!elements.has(key)) elements.set(key, { textContent: '', classList: { add() {} } }); return elements.get(key); } },
    showPollingBar() {}, hidePollingBar() {},
    showJobCards(jobs, search, mode, scroll) { context.displays.push({ jobs, scroll }); },
    showSearchError(message) { context.errors.push(message); },
    showLiveSearchEmpty(search) { context.emptySearches.push(search); },
    displays: [], errors: [], emptySearches: [],
  });
  vm.runInContext(['readSearchRows', 'stripCodeFence', 'sanitizeJobRow', 'fetchJobs', 'queryTokens', 'quickMatchUrl', 'scoreJob', 'fetchQuickMatches', 'stopPolling', 'startPolling'].map(source).join('\n'), context);
  return { context, timers, async flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }, async tick(ms) { const entry = [...timers].find(([, value]) => value.ms === ms); assert.ok(entry, 'Missing timer ' + ms); timers.delete(entry[0]); await entry[1].fn(); } };
}
const row = { job_title: 'Engineer', company: 'Test', location: 'Remote', apply_url: 'https://test.invalid/apply', match_score: '80' };
test('all inline JavaScript parses', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (match[1].trim()) new vm.Script(match[1]);
});
test('Quick Match uses one request even with fewer than ten results and preserves filters', async () => {
  const calls = [];
  const { context } = harness(async url => { calls.push(url); return { ok: true, json: async () => [row] }; });
  const jobs = await context.fetchQuickMatches('engineer', { job_type: 'Full-time', work_mode: 'Remote' }, new AbortController().signal);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /employment_type=eq.Full-time/);
  assert.match(calls[0], /work_mode=eq.Remote/);
  assert.equal(jobs.length, 1);
});
test('Quick Match surfaces HTTP failures instead of returning an empty list', async () => {
  const { context } = harness(async () => ({ ok: false, status: 503 }));
  await assert.rejects(context.fetchQuickMatches('engineer', {}, new AbortController().signal), /503/);
});
test('database reads time out instead of hanging', async () => {
  const h = harness((url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) )));
  const pending = h.context.readSearchRows('https://test.invalid', new AbortController().signal);
  await h.tick(10000);
  await assert.rejects(pending, /timed out/);
  assert.equal(h.timers.size, 0);
});
test('live search checks immediately, displays partial results, and checks only its own id', async () => {
  const calls = [];
  const h = harness(async url => { calls.push(url); return { ok: true, json: async () => calls.length === 1 ? [row] : Array.from({ length: 10 }, (_, i) => ({ ...row, apply_url: row.apply_url + i })) }; });
  h.context.startPolling('engineer', 1, '', 'live', 'search-one');
  await h.flush();
  assert.equal(calls.length, 1);
  assert.equal(h.context.displays[0].jobs.length, 1);
  assert.equal(h.context.displays[0].scroll, true);
  await h.tick(3000);
  await h.flush();
  assert.equal(h.context.displays[1].jobs.length, 10);
  assert.equal(h.context.displays[1].scroll, false);
  assert.ok(calls.every(url => url.includes('search_id=eq.search-one')));
  assert.equal(h.context.activePollFn, null);
});
test('live search never falls back to unscoped rows when empty', async () => {
  const calls = [];
  const h = harness(async url => { calls.push(url); return { ok: true, json: async () => [] }; });
  h.context.startPolling('engineer', 1, '', 'live', 'search-two');
  await h.flush();
  await h.tick(3000);
  await h.flush();
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.includes('search_id=eq.search-two')));
  assert.equal(h.context.displays.length, 0);
});
test('a completed empty source stops polling immediately instead of waiting five minutes', async () => {
  const calls = [];
  const h = harness(async url => {
    calls.push(url);
    return { ok: true, json: async () => [{ job_title: 'No matching jobs found', company: 'N/A' }] };
  });
  h.context.startPolling('engineer', 1, '', 'live', 'completed-empty');
  await h.flush();
  assert.equal(calls.length, 1);
  assert.equal(h.context.emptySearches[0], 'engineer');
  assert.equal(h.context.activePollFn, null);
  assert.equal(h.timers.size, 0);
  assert.equal(h.context.displays.length, 0);
});
test('superseded live requests cannot display or schedule stale results', async () => {
  let resolve;
  const h = harness(() => new Promise(r => { resolve = r; }));
  h.context.startPolling('engineer', 1, '', 'live', 'old');
  h.context.stopPolling();
  h.context.searchGeneration = 2;
  resolve({ ok: true, json: async () => [row] });
  await h.flush();
  assert.equal(h.context.displays.length, 0);
  assert.equal(h.timers.size, 0);
});
test('three failed live reads stop with an actionable error', async () => {
  const h = harness(async () => ({ ok: false, status: 503 }));
  h.context.startPolling('engineer', 1, '', 'live', 'search-three');
  await h.flush();
  await h.tick(3000);
  await h.tick(3000);
  assert.equal(h.context.errors.length, 1);
  assert.equal(h.context.activePollFn, null);
});
test('a slow webhook response does not hold up live result checks', async () => {
  const calls = [];
  let submission;
  const h = harness(async (url, options) => {
    calls.push(url);
    if (options.method === 'POST') {
      submission = options;
      return new Promise(() => {});
    }
    return { ok: true, json: async () => Array.from({ length: 10 }, () => row) };
  });
  Object.assign(h.context, {
    currentMode: 'live', CLOCK_SKEW_MS: 5000, WEBHOOK_URL_LIVE: 'https://test.invalid/webhook',
    closeTitleList() {}, closeCityList() {}, newSearchId: () => 'new-search',
    getFilters: () => ({}), filterSummary: () => '', rememberSearch() {},
    showLoading() {}, hideLoading() {}, accountPayload: () => ({}),
  });
  h.context.document.getElementById('jobSearchInput').value = 'engineer';
  h.context.document.getElementById('resultsSection').classList.remove = () => {};
  vm.runInContext(source('handleSearch'), h.context);
  await h.context.handleSearch();
  await h.flush();
  assert.equal(calls.length, 2);
  assert.equal(submission.mode, 'cors');
  assert.equal(submission.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(submission.body).search_id, 'new-search');
  assert.equal(h.context.displays.length, 1);
  assert.match(calls[1], /search_id=eq.new-search/);
});
