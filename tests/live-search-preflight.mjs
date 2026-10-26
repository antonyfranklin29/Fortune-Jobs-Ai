// The preflight against a stubbed gateway that mirrors live-search's behaviour. Proves the
// preflight passes on a healthy gateway, flags regressions, and never sends a request that
// could dispatch to Make (every POST it sends is invalid unless it is an authorised dry run).
import test from 'node:test';
import assert from 'node:assert/strict';
import {runPreflight, SITE_ORIGIN} from '../scripts/live-search-preflight.mjs';

const URL_ = 'https://gateway.fixture.test/functions/v1/live-search';
const KEY = 'fixture-test-key';

function gateway({breakCors = false, leakFields = false, acceptMissingText = false, exposeSecretHeader = false, noGuard = false} = {}) {
  const dispatchable = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const headers = new Headers(init.headers || {});
    const cors = {'access-control-allow-origin': breakCors ? 'https://evil.test' : SITE_ORIGIN,
      'access-control-allow-headers': exposeSecretHeader ? 'content-type, x-fj-test-key, x-fj-gateway-secret' : 'content-type, x-fj-test-key'};
    const reply = (status, body) => new Response(body === null ? null : JSON.stringify(body), {status, headers: cors});
    if (method === 'OPTIONS') return reply(204, null);
    if (method === 'GET') return reply(200, leakFields ? {state: 'unknown', results: 0, query: 'x'} : {state: 'unknown', results: 0});
    if (!noGuard && headers.get('x-fj-dry-run') === '1' && headers.get('x-fj-test-key') !== KEY)
      return reply(403, {status: 'rejected', reason: 'dry_run_unauthorized'});
    let body;
    try { body = JSON.parse(init.body); } catch { return reply(400, {status: 'rejected', reason: 'invalid_request', detail: 'body is not valid JSON'}); }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text && !acceptMissingText) return reply(400, {status: 'rejected', reason: 'invalid_request', detail: 'text is required'});
    if (/[\u0000-\u001F\u007F]/.test(text)) return reply(400, {status: 'rejected', reason: 'invalid_request', detail: 'text contains control characters'});
    if ((body.mode ?? 'live') !== 'live') return reply(400, {status: 'rejected', reason: 'invalid_request', detail: "mode must be 'live'"});
    if (headers.get('x-fj-test-key') === KEY) return reply(202, {status: 'accepted', search_id: 's_dry_1', dry_run: true});
    dispatchable.push(body);   // would reach Make in production
    return reply(503, {status: 'error', reason: 'gateway_not_configured'});
  };
  return {fetchImpl, dispatchable};
}

test('a healthy gateway passes, and the preflight sends nothing dispatchable', async () => {
  const g = gateway();
  const r = await runPreflight({fetchImpl: g.fetchImpl, url: URL_});
  assert.equal(r.status, 'ok', JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(g.dispatchable.length, 0, 'no valid non-dry-run POST may be sent');
  assert.ok(r.checks.find((c) => c.name === 'dry_run_admitted').skipped);
});

test('with a test key the dry run is checked and still nothing dispatchable is sent', async () => {
  const g = gateway();
  const statusCalls = [];
  const fetchImpl = async (url, init = {}) => {
    if ((init.method || 'GET') === 'GET' && String(url).includes('s_dry_1')) {
      statusCalls.push(url);
      return new Response(JSON.stringify({state: 'pending', results: 0}), {status: 200});
    }
    return g.fetchImpl(url, init);
  };
  const r = await runPreflight({fetchImpl, url: URL_, testKey: KEY});
  assert.equal(r.status, 'ok', JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(statusCalls.length, 1);
  assert.equal(g.dispatchable.length, 0);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(KEY), 'the key is never echoed in the report');
});

test('regressions are flagged', async () => {
  for (const [opts, name] of [
    [{breakCors: true}, 'cors_preflight'],
    [{leakFields: true}, 'status_minimal_fields'],
    [{acceptMissingText: true}, 'rejects_missing_text'],
    [{exposeSecretHeader: true}, 'cors_no_secret_header'],
  ]) {
    const r = await runPreflight({fetchImpl: gateway(opts).fetchImpl, url: URL_});
    assert.equal(r.status, 'attention_required', name);
    assert.equal(r.checks.find((c) => c.name === name).ok, false, name);
  }
});

test('a gateway without the dry-run guard is flagged and the keyed dry run is withheld', async () => {
  const g = gateway({noGuard: true});
  const r = await runPreflight({fetchImpl: g.fetchImpl, url: URL_, testKey: 'wrong-or-rotated-key'});
  assert.equal(r.status, 'attention_required');
  assert.equal(r.checks.find((c) => c.name === 'dry_run_guard_deployed').ok, false);
  assert.equal(g.dispatchable.length, 0, 'a wrong key must never turn into a dispatched search');
});

test('with the guard, a wrong key is refused rather than dispatched', async () => {
  const g = gateway();
  const r = await runPreflight({fetchImpl: g.fetchImpl, url: URL_, testKey: 'wrong-or-rotated-key'});
  assert.equal(r.checks.find((c) => c.name === 'dry_run_admitted').ok, false);
  assert.equal(g.dispatchable.length, 0);
});
