import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCatalogue, readCatalogue, US_STATE_CODES} from '../scripts/catalogue-health.mjs';

test('read-only catalogue fetch uses public fields and pages without sending data', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({url: String(url), options});
    return {ok: true, json: async () => requests.length === 1
      ? Array.from({length: 1000}, () => ({source: 'adzuna'}))
      : [{source: 'indeed'}]};
  };
  const rows = await readCatalogue({fetchImpl, key: 'public-test-key'});
  assert.equal(rows.length, 1001);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /offset=0/);
  assert.match(requests[1].url, /offset=1000/);
  for (const request of requests) {
    assert.equal(request.options.method, undefined); // GET only
    assert.match(request.url, /select=source%2Cstate_code%2Cposted_at%2Clast_seen_at/);
    assert.doesNotMatch(request.url, /resume|profile|email/);
  }
});

test('stalled refresh is reported even when old jobs remain open', () => {
  const now = new Date('2026-10-24T20:00:00Z');
  const rows = Array.from({length: 320}, (_, i) => ({source: 'adzuna', state_code: US_STATE_CODES[i % 32],
    posted_at: '2026-10-20T00:00:00Z', last_seen_at: '2026-10-18T00:00:00Z'}));
  const report = assessCatalogue(rows, {now});
  assert.equal(report.posted_within_30_days, 320);
  assert.equal(report.states_with_recent_jobs, 32);
  assert.deepEqual(report.failures, ['missing_recent_states', 'catalogue_not_refreshed']);
});

test('healthy snapshot has no false alarm and excludes stale or future postings', () => {
  const now = new Date('2026-10-24T20:00:00Z');
  const rows = Array.from({length: 320}, (_, i) => ({source: 'adzuna', state_code: US_STATE_CODES[i % 50],
    posted_at: '2026-10-20T00:00:00Z', last_seen_at: '2026-10-24T12:00:00Z'}));
  rows.push({source: 'dice', state_code: 'XX', posted_at: '2026-09-01T00:00:00Z', last_seen_at: null});
  rows.push({source: 'dice', state_code: 'YY', posted_at: '2026-10-26T00:00:00Z', last_seen_at: null});
  const report = assessCatalogue(rows, {now});
  assert.equal(report.status, 'healthy');
  assert.equal(report.posted_within_30_days, 320);
  assert.equal(report.states_with_recent_jobs, 50);
  assert.equal(report.by_source.dice, 2);
});
