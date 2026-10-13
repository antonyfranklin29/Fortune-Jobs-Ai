// 100-user admission load test for the Live Search gateway.
//
//   DRY RUN (free, default):  node tests/live-search-gateway-load.cjs
//     Requires GATEWAY_TEST_KEY. Every request is admitted or shed exactly as in
//     production, but none reaches Make, so no scraping is paid for.
//
//   PAID RUN (spends credits): add --paid AND --max-searches=N
//     Refuses to run without an explicit cap, so a test can never cost an
//     unbounded amount. Do not use without the owner's approved limit.
//
// Env: GATEWAY_URL, GATEWAY_TEST_KEY
const GATEWAY = process.env.GATEWAY_URL
  || 'https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/live-search';
const TEST_KEY = process.env.GATEWAY_TEST_KEY || '';

const args = process.argv.slice(2);
const paid = args.includes('--paid');
const users = Number((args.find(a => a.startsWith('--users=')) || '--users=100').split('=')[1]);
const capArg = args.find(a => a.startsWith('--max-searches='));
const cap = capArg ? Number(capArg.split('=')[1]) : null;

if (paid && (!cap || cap <= 0)) {
  console.error('Refusing to run a paid test without --max-searches=N. Each admitted search costs Make and Apify credits.');
  process.exit(2);
}
if (!paid && !TEST_KEY) {
  console.error('Dry run needs GATEWAY_TEST_KEY so the gateway skips the paid dispatch. Set it or pass --paid with a cap.');
  process.exit(2);
}
if (paid) {
  console.log(`PAID MODE: at most ${cap} searches will actually reach Make. Remaining users will be shed by the gateway.`);
}

const QUERIES = ['Data Analyst','Power BI Developer','Data Engineer','Registered Nurse',
                 'Accountant','DevOps Engineer','Project Manager','Salesforce Developer'];

let dispatched = 0;

async function oneUser(i) {
  const started = Date.now();
  const headers = { 'content-type': 'application/json' };
  // In paid mode, only the first `cap` users are allowed to really dispatch.
  const useDry = !paid || dispatched >= cap;
  if (useDry && TEST_KEY) headers['x-fj-test-key'] = TEST_KEY;
  if (!useDry) dispatched++;

  try {
    const res = await fetch(GATEWAY, {
      method: 'POST', headers,
      body: JSON.stringify({ text: QUERIES[i % QUERIES.length], mode: 'live', location: 'Chicago, Illinois' }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: true, http: res.status, reason: body.reason || body.status,
             queued_ms: body.queued_ms ?? null, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, http: 0, reason: String(e.name || e).slice(0, 40), ms: Date.now() - started };
  }
}

(async () => {
  console.log(`Firing ${users} simultaneous Live Search attempts at ${GATEWAY}`);
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: users }, (_, i) => oneUser(i)));
  const wall = Date.now() - t0;

  const by = {};
  for (const r of results) by[`${r.http} ${r.reason}`] = (by[`${r.http} ${r.reason}`] || 0) + 1;
  const times = results.map(r => r.ms).sort((a, b) => a - b);
  const pct = p => times[Math.min(times.length - 1, Math.floor(times.length * p))];

  console.log('\n--- outcomes ---');
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log('\n--- latency ---');
  console.log(`  wall ${wall}ms | p50 ${pct(0.5)}ms | p95 ${pct(0.95)}ms | max ${times[times.length-1]}ms`);

  const admitted = results.filter(r => r.http === 202).length;
  const shed     = results.filter(r => r.http === 503 || r.http === 429).length;
  const broken   = results.filter(r => !r.ok || r.http >= 500 && r.http !== 503).length;

  console.log('\n--- acceptance ---');
  console.log(`  admitted            ${admitted}`);
  console.log(`  shed cleanly        ${shed}`);
  console.log(`  technical failures  ${broken}`);
  console.log(`  every user answered ${admitted + shed === users ? 'YES' : 'NO'}`);
  console.log(`  no unbounded admit  ${admitted <= 25 ? 'YES' : 'NO (check limits)'}`);
  if (paid) console.log(`  real searches sent  ${dispatched} (cap ${cap})`);
  process.exit(broken === 0 && admitted + shed === users ? 0 : 1);
})();
