// node --test tests/job-ingest.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../supabase/functions/job-ingest/lib.mjs';

const roleCfg = JSON.parse(readFileSync(new URL('../config/job-roles.json', import.meta.url)));
const regCfg  = JSON.parse(readFileSync(new URL('../config/us-regions.json', import.meta.url)));
const roles = L.compileRoles(roleCfg);
const idx = L.regionIndex(regCfg);
const DA = roles.find((r) => r.id === 'data-analyst');
const now = new Date('2026-10-15T04:00:00Z');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/adzuna-nc-data-analyst.json', import.meta.url)));

const norm = (r, region) => L.normalizeAdzuna(r, { role: DA, regionCode: region, idx, fetchedAt: now.toISOString(), now });

test('config covers 50 states plus DC as a separate region', () => {
  assert.equal(regCfg.regions.length, 51);
  assert.equal(regCfg.regions.filter((r) => r.separate).map((r) => r.code).join(), 'DC');
});

test('Data Analyst accepts real aliases seen in production', () => {
  for (const t of ['Data Analyst', 'Sr. Data Analyst', 'DATA ANALYST', 'Business Data Analyst - Wealth Management',
                   'Data & Decision Analyst', 'Data Analyst Spotfire Specialist', 'Infrastructure Data Analyst',
                   'Reporting Analyst', 'Analytics Analyst'])
    assert.ok(L.titleMatchesRole(t, DA), `should accept: ${t}`);
});

test('Data Analyst rejects neighbouring roles instead of padding with them', () => {
  for (const t of ['Azure Data Engineer Power BI / Synapse / ADF', 'Lead Data Engineer', 'Data Scientist - Pricing',
                   'Cybersecurity Analyst', 'BUSINESS ANALYST', 'Data Entry Clerk', 'Data Center Analyst', 'Data Architect'])
    assert.ok(!L.titleMatchesRole(t, DA), `should reject: ${t}`);
});

test('state comes only from listing evidence, in both catalogue formats', () => {
  const s = (o) => L.stateFromEvidence(o, idx);
  assert.equal(s({ area: ['US', 'North Carolina', 'Wake County', 'Raleigh'] }), 'NC');
  assert.equal(s({ area: ['US', 'South Carolina'] }), 'SC');
  assert.equal(s({ location: 'Charlotte, North Carolina, USA' }), 'NC');
  assert.equal(s({ location: 'Spartanburg, SC' }), 'SC');
  assert.equal(s({ location: 'Raleigh, NC 27601' }), 'NC');
  assert.equal(s({ location: 'Washington, DC' }), 'DC');
  assert.equal(s({ location: 'Seattle, Washington, USA' }), 'WA');
  assert.equal(s({ location: 'Pennsylvania, USA' }), 'PA', 'state-level listing');
  assert.equal(s({ location: 'North Carolina, USA' }), 'NC');
});

test('ambiguous or missing location is never guessed into a state', () => {
  const s = (o) => L.stateFromEvidence(o, idx);
  assert.equal(s({ location: 'Carolina' }), null, 'Carolina alone names no state');
  assert.equal(s({ location: 'Washington, USA' }), null, 'state or DC: refuse');
  assert.equal(s({ location: 'Remote, USA' }), null);
  assert.equal(s({}), null);
});

test('NC and SC are isolated: an SC listing is rejected from an NC sweep and vice versa', () => {
  const sc = fixture.results.find((r) => r.id === '4804');
  assert.equal(norm(sc, 'NC').reject, 'other_state');
  assert.ok(norm(sc, 'SC').row);
  const nc = fixture.results.find((r) => r.id === '4801');
  assert.equal(norm(nc, 'SC').reject, 'other_state');
});

test('fixture sweep for NC keeps exactly the genuine NC Data Analyst listings', () => {
  const out = fixture.results.map((r) => ({ id: r.id, ...norm(r, 'NC') }));
  const reasons = Object.fromEntries(out.filter((o) => o.reject).map((o) => [o.id, o.reject]));
  assert.deepEqual(reasons, { '4803': 'off_role', '4804': 'other_state', '4806': 'invalid_apply_url' });
  const kept = L.dedupe(out.filter((o) => o.row).map((o) => o.row));
  assert.deepEqual(kept.map((r) => r.source_listing_id).sort(), ['4801', '4802', '4805']);
  for (const r of kept) assert.equal(r.state_code, 'NC');
});

test('no invented data: predicted salary, missing company and bad dates stay empty', () => {
  const sr = norm(fixture.results.find((r) => r.id === '4802'), 'NC').row;
  assert.equal(sr.salary, null, 'predicted salaries are not presented as listed pay');
  const dd = norm(fixture.results.find((r) => r.id === '4805'), 'NC').row;
  assert.equal(dd.company, null);
  assert.equal(dd.posted_at, null, 'unparseable date is not replaced with now');
  const real = norm(fixture.results.find((r) => r.id === '4801'), 'NC').row;
  assert.equal(real.salary, '$70,000–$85,000');
  assert.equal(real.posted_at, '2026-10-12T14:00:00.000Z');
  assert.equal(real.attribution, 'Adzuna');
  assert.ok(!/<b>/.test(real.job_description), 'markup stripped');
});

test('future-dated postings are rejected rather than trusted', () => {
  assert.equal(L.parsePostedAt('2027-01-01T00:00:00Z', now), null);
  assert.equal(L.parsePostedAt(null, now), null);
});

test('tracking parameters do not create duplicates; reposts keep the newest date', () => {
  assert.equal(L.canonicalUrl('https://WWW.Adzuna.com/land/ad/4801?utm_source=a&se=1&v=2#x'),
               L.canonicalUrl('https://www.adzuna.com/land/ad/4801?utm_campaign=b&gclid=z'));
  const rows = fixture.results.filter((r) => r.id === '4801').map((r) => norm(r, 'NC').row);
  const [one] = L.dedupe(rows);
  assert.equal(L.dedupe(rows).length, 1);
  assert.equal(one.posted_at, '2026-10-13T08:00:00.000Z');
});

test('invalid application URLs are rejected', () => {
  for (const u of ['javascript:alert(1)', 'ftp://x.com/a', 'http://localhost/a', 'not a url', '', null])
    assert.equal(L.canonicalUrl(u), null, String(u));
});

test('eligibility needs a real date, recent sighting and an open listing', () => {
  const cfg = roleCfg;
  const base = { posted_at: '2026-10-10T00:00:00Z', last_seen_at: '2026-10-14T00:00:00Z', closed_at: null };
  assert.ok(L.isEligible(base, cfg, now));
  assert.ok(!L.isEligible({ ...base, posted_at: null }, cfg, now), 'unknown date is not fresh');
  assert.ok(!L.isEligible({ ...base, posted_at: '2026-08-01T00:00:00Z' }, cfg, now), 'too old');
  assert.ok(!L.isEligible({ ...base, last_seen_at: '2026-09-30T00:00:00Z' }, cfg, now), 'not seen recently');
  assert.ok(!L.isEligible({ ...base, closed_at: '2026-10-14T00:00:00Z' }, cfg, now), 'closed');
});

test('planning spends the budget on the biggest shortfalls and reports what it deferred', () => {
  const regions = regCfg.regions.filter((r) => ['NC', 'SC'].includes(r.code));
  const cells = new Map([['data-analyst:NC', { fresh: 3 }], ['data-analyst:SC', { fresh: 1 }]]);
  const { plan, deferred } = L.planRequests({ cells, roles: [DA], regions, target: 100, budget: 4, now });
  assert.equal(plan.length, 4, 'never exceeds the budget');
  assert.deepEqual(plan.slice(0, 3).map((p) => `${p.region}:${p.page}`), ['SC:1', 'SC:2', 'SC:3'], 'SC is furthest short');
  assert.equal(plan[3].region, 'NC');
  assert.equal(deferred.length, 1);
  assert.equal(deferred[0].region, 'NC');
  assert.equal(deferred[0].pages, 2);
});

test('quota exhaustion: zero budget plans nothing and defers everything', () => {
  const regions = regCfg.regions;
  const { plan, deferred } = L.planRequests({ cells: new Map(), roles: [DA], regions, target: 100, budget: 0, now });
  assert.equal(plan.length, 0);
  assert.equal(deferred.length, 51);
});

test('a full, recently swept cell gets one incremental page; cells not yet due are skipped', () => {
  const regions = regCfg.regions.filter((r) => ['NC', 'SC'].includes(r.code));
  const cells = new Map([['data-analyst:NC', { fresh: 120, lastFullSweepAt: '2026-10-13T00:00:00Z' }],
                         ['data-analyst:SC', { fresh: 5, nextDueAt: '2026-10-16T00:00:00Z' }]]);
  const { plan } = L.planRequests({ cells, roles: [DA], regions, target: 100, budget: 50, now });
  assert.deepEqual(plan, [{ role: 'data-analyst', region: 'NC', page: 1, mode: 'refresh' }]);
});

test('a full cell is fully re-swept before its listings could age out of the seen window', () => {
  const regions = regCfg.regions.filter((r) => r.code === 'NC');
  const stale = new Map([['data-analyst:NC', { fresh: 120, lastFullSweepAt: '2026-10-08T00:00:00Z' }]]);
  const { plan } = L.planRequests({ cells: stale, roles: [DA], regions, target: 100, budget: 50, now });
  assert.equal(plan.length, 3, 'full sweep, not one page');
  assert.ok(plan.every((p) => p.mode === 'fill'));
  const never = new Map([['data-analyst:NC', { fresh: 120 }]]);
  assert.equal(L.planRequests({ cells: never, roles: [DA], regions, target: 100, budget: 50, now }).plan.length, 3,
               'never fully swept counts as stale');
  assert.ok(6 < roleCfg.seen_within_days + 1 && 6 < roleCfg.seen_within_days, 'full-sweep interval stays inside the seen window');
});

test('retry backoff grows and is capped', () => {
  const max = () => 0.999999;
  assert.ok(L.backoffMs(0, 1000, 30000, max) < 1000);
  assert.ok(L.backoffMs(3, 1000, 30000, max) < 8000 && L.backoffMs(3, 1000, 30000, max) > 7000);
  assert.ok(L.backoffMs(20, 1000, 30000, max) < 30000);
});
