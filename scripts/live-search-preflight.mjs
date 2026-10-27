// Live Search gateway preflight: zero-cost checks of the deployed live-search function.
//
// Safe by construction: it never sends a request that could reach Make or Apify.
//   - OPTIONS and GET (status) requests never dispatch.
//   - Every POST it sends is deliberately invalid (bad JSON, missing text, control
//     characters, wrong mode), and the gateway rejects those with 400 before admission or
//     dispatch, whether or not MAKE_LIVE_WEBHOOK_URL / MAKE_GATEWAY_SECRET are set.
//   - The one valid POST is a dry run. It is sent only when GATEWAY_TEST_KEY is set in the
//     environment AND the gateway has proved it carries the dry-run guard (an unkeyed
//     "x-fj-dry-run: 1" request is refused with 403). With the guard, a wrong or rotated
//     key is refused instead of becoming a paid search. The key is never printed.
//
//   node scripts/live-search-preflight.mjs            # public checks only
//   GATEWAY_TEST_KEY=... node scripts/live-search-preflight.mjs   # adds the dry run
import {pathToFileURL} from 'node:url';

export const GATEWAY_URL = 'https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/live-search';
export const SITE_ORIGIN = 'https://fortunejobsai.com';

async function call(fetchImpl, url, init) {
  const res = await fetchImpl(url, {redirect: 'error', signal: AbortSignal.timeout(15000), ...init});
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return {status: res.status, headers: res.headers, body};
}

const post = (fetchImpl, url, body, extra = {}) => call(fetchImpl, url, {
  method: 'POST',
  headers: {'content-type': 'application/json', origin: SITE_ORIGIN, ...extra},
  body,
});

export async function runPreflight({fetchImpl = fetch, url = GATEWAY_URL, testKey = ''} = {}) {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({name, ok: Boolean(ok), detail});

  // 1. CORS preflight for the site origin.
  const opt = await call(fetchImpl, url, {method: 'OPTIONS', headers: {origin: SITE_ORIGIN, 'access-control-request-method': 'POST'}});
  check('cors_preflight', opt.status === 204 && opt.headers.get('access-control-allow-origin') === SITE_ORIGIN,
    `status ${opt.status}, allow-origin ${opt.headers.get('access-control-allow-origin')}`);
  const allowHeaders = (opt.headers.get('access-control-allow-headers') || '').toLowerCase();
  check('cors_no_secret_header', !allowHeaders.includes('x-fj-gateway-secret'),
    'browsers must not be invited to send the Make secret');
  check('cors_dry_run_headers', allowHeaders.includes('x-fj-test-key') && allowHeaders.includes('x-fj-dry-run'),
    'browser dry runs must be able to declare intent and supply the test key');

  // 2. Status endpoint: unknown id returns only state and results.
  const probeId = `s_preflight_${Date.now().toString(36)}`;
  const st = await call(fetchImpl, `${url}?search_id=${encodeURIComponent(probeId)}`, {method: 'GET', headers: {origin: SITE_ORIGIN}});
  const keys = st.body && typeof st.body === 'object' ? Object.keys(st.body).sort().join(',') : '';
  check('status_unknown_id', st.status === 200 && ['unknown', 'not_found'].includes(st.body?.state) && st.body?.results === 0,
    `status ${st.status}, state ${st.body?.state}`);
  check('status_minimal_fields', keys === 'results,state', `fields ${keys}`);

  // 3. Invalid POSTs are refused before admission or dispatch.
  const bad = await post(fetchImpl, url, '{not json');
  check('rejects_invalid_json', bad.status === 400 && bad.body?.reason === 'invalid_request', `status ${bad.status}`);
  const noText = await post(fetchImpl, url, JSON.stringify({mode: 'live'}));
  check('rejects_missing_text', noText.status === 400 && /text is required/.test(noText.body?.detail || ''), `status ${noText.status}`);
  const ctrl = await post(fetchImpl, url, JSON.stringify({text: 'data\nanalyst', mode: 'live'}));
  check('rejects_control_characters', ctrl.status === 400 && /control characters/.test(ctrl.body?.detail || ''), `status ${ctrl.status}`);
  const quick = await post(fetchImpl, url, JSON.stringify({text: 'data analyst', mode: 'quick'}));
  check('rejects_non_live_mode', quick.status === 400, `status ${quick.status}`);

  // 4. Dry-run guard: the gateway refuses a dry-run request without the right key (403)
  //    before reading the body. The probe body has no text, so a gateway without the guard
  //    answers 400 instead. Neither can dispatch, on any version.
  const g = await post(fetchImpl, url, JSON.stringify({mode: 'live'}), {'x-fj-dry-run': '1'});
  const guarded = g.status === 403 && g.body?.reason === 'dry_run_unauthorized';
  check('dry_run_guard_deployed', guarded, guarded ? 'unkeyed dry run refused' : `status ${g.status}, reason ${g.body?.reason}`);

  // 5. Optional authorised dry run: admitted, never dispatched. Sent only when the guard is
  //    live, so a wrong or rotated key is refused instead of becoming a paid search.
  if (testKey && !guarded) {
    checks.push({name: 'dry_run_admitted', ok: false, detail: 'dry-run guard not deployed; dry run withheld so a wrong key cannot dispatch'});
  } else if (testKey) {
    const dry = await post(fetchImpl, url, JSON.stringify({text: 'preflight dry run', mode: 'live'}), {'x-fj-test-key': testKey, 'x-fj-dry-run': '1'});
    check('dry_run_admitted', dry.status === 202 && dry.body?.dry_run === true && /^s_/.test(String(dry.body?.search_id || '')),
      `status ${dry.status}, dry_run ${dry.body?.dry_run}`);
    if (dry.body?.search_id) {
      const ds = await call(fetchImpl, `${url}?search_id=${encodeURIComponent(dry.body.search_id)}`, {method: 'GET', headers: {origin: SITE_ORIGIN}});
      check('dry_run_status_pending', ds.status === 200 && ds.body?.state === 'pending', `state ${ds.body?.state}`);
    }
  } else {
    checks.push({name: 'dry_run_admitted', ok: true, skipped: true, detail: 'GATEWAY_TEST_KEY not provided; dry run skipped'});
  }

  return finish(checks, url);
}

function finish(checks, url) {
  const failed = checks.filter((c) => !c.ok);
  return {checked_at: new Date().toISOString(), gateway: url, status: failed.length ? 'attention_required' : 'ok', checks,
    note: 'No request in this preflight can reach Make or Apify.'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runPreflight({testKey: process.env.GATEWAY_TEST_KEY || ''});
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'ok') process.exitCode = 1;
  } catch (error) {
    console.error(`Live Search preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
