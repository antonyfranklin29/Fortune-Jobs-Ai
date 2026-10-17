// Adapted from Claude commits 8962a74/8682283: include the deployed coordinator,
// settle absence there (L6), and queue selection before publication under its org lock (C1).
// Registry lease staging, candidate selection and cross-company application-URL claims.
// Runs on a DISPOSABLE local PostgreSQL 17 server (never a Supabase project). Each scenario gets its own
// database cloned from a template with the full applied chain (through the deployed refresh workflow), and uses independent
// backend sessions. Interleavings are parked on real locks, except the URL race, which parks each insert on
// a test-only advisory lock taken by a BEFORE INSERT trigger that exists only in the disposable database.
// That trigger does not change any migration; it widens the window between the duplicate check and the
// insert so both claims are past the check before either commits.
//
//   FJ_PG_DISPOSABLE=1 PGHOST=127.0.0.1 PGPORT=54417 PGUSER=postgres node --test tests/employer-lease-selection-url-db.mjs
//
//   Default: applied chain + migrations/pending/20261024_employer_url_conflicts.sql.
//   FJ_LEASE_FIX=0:  applied chain only (baseline, repository schema).
//   FJ_LEASE_RESULTS=/path/results.json  writes per-scenario results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const enabled = process.env.FJ_PG_DISPOSABLE === '1' && spawnSync('psql', ['--version']).status === 0;
const FIX_ON = process.env.FJ_LEASE_FIX !== '0';
const FIX_FILE = 'migrations/pending/20261024_employer_url_conflicts.sql';
const TPL = `fj_lease_tpl_${process.pid}`;

const CHAIN = [
  'tests/sql/supabase-shim.sql',
  'migrations/20261015_ingest_taxonomy.sql',
  'migrations/20261015_ingest_catalogue.sql',
  'migrations/20261015_ingest_feed.sql',
  'migrations/pending/20261016_employer_submissions.sql',
  'migrations/pending/20261016_employer_feed_runs.sql',
  'migrations/pending/20261017_employer_domain_checks.sql',
  'migrations/pending/20261017_employer_account_deletion.sql',
  'migrations/pending/20261017_employer_search_visibility.sql',
  'migrations/pending/20261017_employer_feed_publish_hardening.sql',
  'migrations/pending/20261017_employer_feed_registry_bridge.sql',
  'migrations/pending/20261018_employer_access_hardening.sql',
  'migrations/pending/20261019_employer_pending_account_cleanup.sql',
  'migrations/pending/20261019_employer_concurrency_hardening.sql',
  'migrations/pending/20261020_employer_post_actions.sql',
  'migrations/pending/20261021_employer_feed_concurrency_hardening.sql',
  'migrations/pending/20261022_employer_paused_post_state.sql',
  'migrations/pending/20261023_employer_refresh_workflow.sql',
  ...(FIX_ON && existsSync(root + FIX_FILE) ? [FIX_FILE] : []),
  'migrations/pending/20261025_employer_maintenance.sql',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(25); }
  throw new Error('required lock interleaving was not observed within the deadline');
}
const dbName = (tag) => `fj_lease_${tag}_${process.pid}`;

class Session {
  constructor(db, label) {
    this.label = label;
    this.client = new pg.Client({ database: db, application_name: 'fj_lease_' + label,
      connectionTimeoutMillis: 3000, query_timeout: 20000, statement_timeout: 15000 });
    this.client.on('error', () => {});
    this.ready = this.client.connect();
  }
  async run(sql) {
    let text;
    try {
      await this.ready;
      const result = await this.client.query(sql);
      text = (Array.isArray(result) ? result : [result]).flatMap((r) => r.rows.map((row) =>
        r.fields.map((f) => { const v = row[f.name]; return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }).join('|'))).join('\n');
    } catch (e) {
      text = 'ERROR ' + e.code + ': ' + e.message + (e.detail ? '\nDETAIL: ' + e.detail : '');
    }
    if (process.env.FJ_CONC_DEBUG) console.error('[' + this.label + '] ' + sql.slice(0, 90) + ' => ' + text.slice(0, 240));
    return text.trim();
  }
  async end() { await this.client.end(); }
}

async function open(db) {
  const ctl = new Session(db, 'ctl');
  const sessions = [ctl];
  const map = Object.fromEntries((await ctl.run("select name || '|' || id from public.conc_ids"))
    .split('\n').map((l) => l.split('|')));
  const actor = async (name) => {
    const s = new Session(db, name);
    sessions.push(s);
    await s.run(`set role authenticated; select set_config('request.jwt.claim.sub', '${map[name]}', false);`);
    return s;
  };
  const raw = () => { const s = new Session(db, 'raw'); sessions.push(s); return s; };
  const lockWaits = async () => Number(await ctl.run(
    "select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()"));
  return { db, ctl, map, actor, raw, lockWaits, q: (sql) => ctl.run(sql), sessions };
}
async function closeAll(c) { await Promise.allSettled(c.sessions.map((s) => s.end())); }

const hasDeadlock = (...outs) => outs.some((o) => /deadlock detected/.test(o));
const hasError = (...outs) => outs.some((o) => /^ERROR/m.test(o));
const parseJson = (t) => { try { return JSON.parse(t); } catch { return null; } };
const num = (t) => Number(String(t).trim());
const dollar = (obj) => `$j$${JSON.stringify(obj)}$j$::jsonb`;

// ── fixtures ─────────────────────────────────────────────────────────────────
// Feed source for company A: submitted by X, approved by the operator (revision 2). No candidates yet.
async function feedSource(c, tag) {
  const board = 'acmeboard' + tag;
  const x = await c.actor('X');
  const sub = parseJson(await x.run(`select public.employer_submit_source('${c.map.ORG_A}', 'greenhouse', 'global', '${board}',
    '{"boards.greenhouse.io"}', '{"display":true,"refresh":true,"description":true}', 'v1')`));
  if (!sub || !sub.id) throw new Error('fixture: submit source failed');
  const op = await c.actor('OP');
  const appr = await op.run(`select public.operator_review_source('${sub.id}', 1, 'approve', '{"boards.greenhouse.io"}',
    'Acme Analytics', true, now() + interval '200 days', 'letter-2026-10-01', 'checked permission letter')`);
  if (!/"revision"\s*:\s*2/.test(appr)) throw new Error('fixture: approve source failed: ' + appr);
  return { src: sub.id, board };
}
const listing = (src, board, pid, description = `Feed role ${pid}`) => ({
  source: 'employer_feed', employer_source_id: src, source_listing_id: `${src}:${pid}`,
  job_title: 'Data Analyst', canonical_role: 'data-analyst', location: 'Raleigh, NC', state_code: 'NC', country: 'us',
  employment_type: 'Full-time', work_mode: 'onsite', is_remote: false, posted_at: new Date().toISOString(),
  job_description: description, apply_url: `https://boards.greenhouse.io/${board}/jobs/${pid}`,
});

// Worker-side claim: snapshot and revision come from the registry view, as the worker reads them.
async function claim(c, src) {
  const w = parseJson(await c.q(`select public.employer_source_for_worker('${src}')`));
  if (!w) throw new Error('fixture: source not publishable for worker');
  const out = parseJson(await c.q(`set role service_role; select public.employer_feed_run_begin('${src}', ${w.revision}, ${dollar(w.source)}); reset role;`));
  if (!out || out.status !== 'claimed') throw new Error('claim failed: ' + JSON.stringify(out));
  return { run: out.run_id, token: out.lease_token, rev: w.revision, src };
}
function stageSql(run, rows, complete = true) {
  const summary = { enumeration_complete: complete, source_id: run.src, source_revision: String(run.rev),
    accepted: rows.length, received: rows.length, requests_used: '1', rejected: {} };
  return `set role service_role; select public.employer_feed_stage_registered_run('${run.run}', '${run.token}', ${run.rev}, ${dollar(rows)}, ${dollar(summary)}); reset role;`;
}
const stageRun = async (sess, run, rows, complete = true) => parseJson(await sess.run(stageSql(run, rows, complete))) ?? {};
const select = async (c, src, pids) => (await c.actor('X')).run(`select public.employer_select_feed_jobs('${src}', '{${pids.join(',')}}', true)`);
const deselect = async (sess, src, pids) => sess.run(`select public.employer_select_feed_jobs('${src}', '{${pids.join(',')}}', false)`);
const pubOn = (sess, src, ids) => sess.run(`set role service_role;
  select public.employer_publish_feed_jobs('${src}', 2, '{${ids.join(',')}}'::text[]); reset role;`);
const feedOpen = (c, src, pid) => c.q(`select count(*) from public.pre_scraped_jobs where source = 'employer_feed'
  and employer_source_id = '${src}' and source_listing_id = '${src}:${pid}' and closed_at is null`).then(num);
const feedVisible = async (c, src) => num((await c.raw().run(`set role anon; select count(*) from public.pre_scraped_jobs where employer_source_id = '${src}';`)).split('\n').pop());
const selected = (c, src, pid) => c.q(`select selected from public.employer_feed_candidates where source_id = '${src}' and provider_post_id = '${pid}'`);
const candidates = (c, src, pid) => c.q(`select count(*) from public.employer_feed_candidates where source_id = '${src}' and provider_post_id = '${pid}'`).then(num);

// Manual post with a caller-chosen application URL (for the cross-company claim).
async function mkPostUrl(c, owner, org, url, tag) {
  const s = await c.actor(owner);
  const body = JSON.stringify({ job_title: `Analyst ${tag}`, canonical_role: 'data-analyst', state_code: 'NC', city: 'Raleigh',
    description: `Shared URL role for ${tag}. `.repeat(4), apply_url: url,
    posting_date: new Date().toISOString().slice(0, 10), closing_date: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) });
  const pid = await s.run(`select (public.employer_save_post('${org}', null, $j$${body}$j$::jsonb)->>'id')`);
  await s.run(`select public.employer_submit_post('${pid}')`);
  return pid;
}
const approveOn = (c, post) => c.actor('OP').then((s) => s.run(`select public.operator_review_post('${post}', 1, 'approve', null)`));

// Test-only instrumentation: park each listing insert after its duplicate check (see header).
async function installInsertPause(c) {
  await c.q(`create or replace function public.fj_test_insert_pause() returns trigger language plpgsql as $$
    begin perform pg_advisory_xact_lock(424242); return new; end $$;
    create trigger fj_test_insert_pause before insert on public.pre_scraped_jobs
      for each row execute function public.fj_test_insert_pause();`);
}

// ── scenarios ────────────────────────────────────────────────────────────────

// L1: revocation commits after a run is claimed and before its batch arrives.
async function l1RevokeBeforeStage(c) {
  const { src, board } = await feedSource(c, 'l1');
  const run = await claim(c, src);
  await (await c.actor('OP')).run(`select public.operator_revoke_source('${src}', 'takedown')`);
  const out = await stageRun(c.raw(), run, [listing(src, board, 'P1')]);
  const cands = await candidates(c, src, 'P1');
  const pass = out.status === 'rejected' && out.reason === 'source_changed' && cands === 0;
  return { expected: 'a batch for a source revoked after claim is rejected; no candidate is staged',
    observed: `stage: ${JSON.stringify(out)}; candidates ${cands}`, pass };
}

// L2: a batch waits on the organisation lock while the source is revoked. Whatever order they run in,
// the revoked source must not publish, and nothing may be visible.
async function l2StageParkedRevokeQueued(c) {
  const { src, board } = await feedSource(c, 'l2');
  const run0 = await claim(c, src);
  await stageRun(c.raw(), run0, [listing(src, board, 'P1')]);
  await select(c, src, ['P1']);
  const run1 = await claim(c, src);
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const stage = c.raw().run(stageSql(run1, [listing(src, board, 'P1')]));
  await until(async () => (await c.lockWaits()) >= 1);
  const rv = (await c.actor('OP')).run(`select public.operator_revoke_source('${src}', 'takedown')`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [s, r] = await Promise.all([stage, rv]);
  const pub = await pubOn(c.raw(), src, ['P1']);
  const open = await feedOpen(c, src, 'P1');
  const vis = await feedVisible(c, src);
  const pass = !hasDeadlock(s, r) && !hasError(r) && /source_not_publishable/.test(pub) && open === 0 && vis === 0;
  return { expected: 'staging and revocation queued together: revoked source cannot publish; no open or visible listing',
    observed: `stage: ${s.slice(0, 70)}; revoke: ${r.split('\n').pop().slice(0, 40)}; publish: ${pub.split('\n').pop().slice(0, 70)}; open ${open}; visible ${vis}`, pass };
}

// L3: a lease expires and another run takes over. The first run's late batch must not promote.
async function l3LeaseTakeover(c) {
  const { src, board } = await feedSource(c, 'l3');
  const a = await claim(c, src);
  await c.q(`update public.employer_feed_leases set expires_at = clock_timestamp() - interval '1 second' where source_id = '${src}'`);
  const b = await claim(c, src);
  const outB = await stageRun(c.raw(), b, [listing(src, board, 'P2')]);
  const outA = await stageRun(c.raw(), a, [listing(src, board, 'P1')]);
  const p1 = await candidates(c, src, 'P1');
  const p2 = await candidates(c, src, 'P2');
  const pass = outB.status === 'staged' && ['stale_lease', 'stale_batch'].includes(outA.reason) && p1 === 0 && p2 === 1;
  return { expected: 'after takeover only the new run promotes; the expired run is rejected with no candidate',
    observed: `new run: ${outB.status}; expired run: ${JSON.stringify(outA)}; candidates P1 ${p1}, P2 ${p2}`, pass };
}

// L4: the employer's approval is withdrawn (approver deletion) and re-granted before the old batch arrives.
// The batch was collected under revision 2 and must not promote under revision 4.
async function l4ReapprovalWithOldRun(c) {
  const { src, board } = await feedSource(c, 'l4');
  const run = await claim(c, src);
  await c.q(`delete from auth.users where id = '${c.map.OP}'`);
  await c.q(`insert into public.employer_operators (user_id) values ('${c.map.C3}')`);
  const re = await (await c.actor('C3')).run(`select public.operator_review_source('${src}', 3, 'approve', '{"boards.greenhouse.io"}',
    'Acme Analytics', true, now() + interval '200 days', 'letter-2026-10-02', 're-approved')`);
  const out = await stageRun(c.raw(), run, [listing(src, board, 'P1')]);
  const cands = await candidates(c, src, 'P1');
  const pass = /"revision"\s*:\s*4/.test(re) && out.reason === 'source_changed' && cands === 0;
  return { expected: 'a batch collected under the old approval never promotes after re-approval',
    observed: `re-approval: ${re.slice(0, 50)}; stage: ${JSON.stringify(out)}; candidates ${cands}`, pass };
}

// L5: a partial batch (enumeration incomplete) must not withdraw earlier selections; it reports 'partial'.
async function l5PartialBatchKeepsSelection(c) {
  const { src, board } = await feedSource(c, 'l5');
  const run0 = await claim(c, src);
  await stageRun(c.raw(), run0, [listing(src, board, 'P1'), listing(src, board, 'P2')]);
  await select(c, src, ['P1', 'P2']);
  const run1 = await claim(c, src);
  const out = await stageRun(c.raw(), run1, [listing(src, board, 'P2')], false);
  const pub = parseJson(await pubOn(c.raw(), src, ['P1'])) || {};
  const pass = out.status === 'partial' && pub.published === 1;
  return { expected: 'partial batch reports partial and does not withdraw an earlier selection',
    observed: `partial batch: ${JSON.stringify(out)}; publish P1: published ${pub.published}, skipped ${JSON.stringify(pub.skipped)}`, pass };
}

// L6: staging never closes a listing; clean coordinator settlement reconciles absence.
async function l6CompleteBatchWithdraws(c) {
  const { src, board } = await feedSource(c, 'l6');
  const run0 = await claim(c, src);
  await stageRun(c.raw(), run0, [listing(src, board, 'P1'), listing(src, board, 'P2')]);
  await select(c, src, ['P1', 'P2']);
  const pub = parseJson(await pubOn(c.raw(), src, ['P1'])) || {};
  await c.q(`update employer_refresh_control set enabled=true;`);
  const ticket=parseJson(await c.q(`select employer_refresh_claim('${src}')`));
  const run1 = await claim(c, src);
  const out = await stageRun(c.raw(), run1, [listing(src, board, 'P2')], true);
  const before = await feedOpen(c, src, 'P1');
  const settled=parseJson(await c.q(`select employer_refresh_finish('${ticket.ticket}','${run1.run}')`));
  const open = await feedOpen(c, src, 'P1');
  const pass = pub.published === 1 && out.status === 'staged' && before===1 && settled?.reconciled===true && open === 0;
  return { expected: 'staging never withdraws; a clean complete coordinator settlement closes the absent listing',
    observed: `initial publish ${pub.published}; staged open ${before}; settled ${JSON.stringify(settled)}; live P1 open ${open}`, pass };
}

// C1: selection queued first must take the shared company lock before publication.
async function c1DeselectWhilePublishWaits(c) {
  const { src, board } = await feedSource(c, 'c1');
  const run = await claim(c, src);await stageRun(c.raw(),run,[listing(src,board,'P1')]);await select(c,src,['P1']);
  const hold=c.raw();await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const change=deselect(await c.actor('X'),src,['P1']);await until(async()=>(await c.lockWaits())>=1);
  const pub=pubOn(c.raw(),src,['P1']);await until(async()=>(await c.lockWaits())>=2);
  await hold.run('commit;');const [d,published]=await Promise.all([change,pub]);const p=parseJson(published)||{};
  return{expected:'selection queued first takes the shared company lock before publication and prevents publication',
    observed:JSON.stringify({d,p}),pass:!hasError(d,published)&&p.published===0&&(p.skipped||[]).some(s=>s.reason==='not_selected')};
}

// C2: a later batch refreshes a selected listing's content. The employer granted refresh permission when
// attesting to the source, so the refreshed content is what gets published; the selection covers it.
async function c2RefreshKeepsSelection(c) {
  const { src, board } = await feedSource(c, 'c2');
  const run0 = await claim(c, src);
  await stageRun(c.raw(), run0, [listing(src, board, 'P1', 'Original description')]);
  await select(c, src, ['P1']);
  const run1 = await claim(c, src);
  const out = await stageRun(c.raw(), run1, [listing(src, board, 'P1', 'Refreshed description')], true);
  const p = parseJson(await pubOn(c.raw(), src, ['P1'])) || {};
  const desc = await c.q(`select job_description from public.pre_scraped_jobs where source = 'employer_feed' and source_listing_id = '${src}:P1' and closed_at is null`);
  const pass = out.status === 'staged' && p.published === 1 && desc === 'Refreshed description';
  return { expected: 'refresh under the granted refresh permission keeps the selection and publishes the refreshed content',
    observed: `restage: ${out.status}; publish: published ${p.published}; live description "${desc}"`, pass };
}

// C3: a selection change waits on a candidate that a publication has locked. The publication completes
// on the selection it read; the later change must not deadlock or error.
async function c3SelectionWaitsForPublication(c) {
  const { src, board } = await feedSource(c, 'c3');
  const run = await claim(c, src);
  await stageRun(c.raw(), run, [listing(src, board, 'P1')]);
  await select(c, src, ['P1']);
  const hold = c.raw();
  await hold.run(`begin; select 1 from public.employer_feed_candidates where source_id = '${src}' and provider_post_id = 'P1' for update;`);
  const pub = pubOn(c.raw(), src, ['P1']);
  await until(async () => (await c.lockWaits()) >= 1);
  const d = deselect(await c.actor('X'), src, ['P1']);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [p, dsel] = await Promise.all([pub, d]);
  const pp = parseJson(p) || {};
  const open = await feedOpen(c, src, 'P1');
  const pass = !hasDeadlock(p, dsel) && !hasError(p, dsel) && pp.published === 1;
  return { expected: 'selection change behind a publication: no deadlock or error; publication uses the selection it read',
    observed: hasDeadlock(p, dsel) ? 'deadlock detected' : `publish: published ${pp.published}; deselect: ${dsel.slice(0, 30)}; open after ${open}`, pass };
}

// U1: two companies publish the same application URL manually, both past the duplicate check.
async function u1TwoCompaniesSameUrl(c) {
  await installInsertPause(c);
  const url = 'https://careers.shared-employer.example/jobs/u1-shared-role';
  const postA = await mkPostUrl(c, 'A', c.map.ORG_A, url, 'A');
  const postB = await mkPostUrl(c, 'B', c.map.ORG_B, url, 'B');
  const park = c.raw();
  await park.run('select pg_advisory_lock(424242);');
  const a = approveOn(c, postA);
  await until(async () => (await c.lockWaits()) >= 1);
  const b = approveOn(c, postB);
  await until(async () => (await c.lockWaits()) >= 2);
  await park.run('select pg_advisory_unlock(424242);');
  const [oa, ob] = await Promise.all([a, b]);
  const live = num(await c.q(`select count(*) from public.pre_scraped_jobs where apply_url = '${url}' and closed_at is null`));
  const pass = live === 1 && !hasError(oa, ob);
  return { expected: 'one company lists the shared URL; the other gets a clean apply_url_already_listed, not an error',
    observed: `listings for URL ${live}; A: ${oa.split('\n').pop().slice(0, 90)}; B: ${ob.split('\n').pop().slice(0, 90)}`, pass };
}

// U2: a feed batch and a manual post race for the same application URL. Both orders are run. The advisory
// lock queues its waiters in arrival order, so the claim that arrives first commits first. When the manual
// claim commits first, the feed batch's insert for that URL collides; the batch must not lose its other
// listing, and exactly one listing must hold the URL.
async function u2FeedBatchVsManualSameUrl(c, order) {
  await installInsertPause(c);
  const { src, board } = await feedSource(c, 'u2');
  const run = await claim(c, src);
  await stageRun(c.raw(), run, [listing(src, board, 'P1'), listing(src, board, 'P2')]);
  await select(c, src, ['P1', 'P2']);
  const url = `https://boards.greenhouse.io/${board}/jobs/P1`;
  const postB = await mkPostUrl(c, 'B', c.map.ORG_B, url, 'U2');
  const park = c.raw();
  await park.run('select pg_advisory_lock(424242);');
  let feed, manual;
  if (order === 'manual-first') {
    manual = approveOn(c, postB);
    await until(async () => (await c.lockWaits()) >= 1);
    feed = pubOn(c.raw(), src, ['P1', 'P2']);
    await until(async () => (await c.lockWaits()) >= 2);
  } else {
    feed = pubOn(c.raw(), src, ['P1', 'P2']);
    await until(async () => (await c.lockWaits()) >= 1);
    manual = approveOn(c, postB);
    await until(async () => (await c.lockWaits()) >= 2);
  }
  await park.run('select pg_advisory_unlock(424242);');
  const [fe, mo] = await Promise.all([feed, manual]);
  const live = num(await c.q(`select count(*) from public.pre_scraped_jobs where apply_url = '${url}' and closed_at is null`));
  const p2 = await feedOpen(c, src, 'P2');
  const pass = live === 1 && !hasError(fe, mo) && p2 === 1;
  return { expected: 'exactly one listing holds the URL; the feed batch keeps its other listing and reports the collision',
    observed: `order ${order}; listings for URL ${live}; feed: ${fe.split('\n').pop().slice(0, 110)}; manual: ${mo.split('\n').pop().slice(0, 80)}; P2 open ${p2}`, pass };
}

const SCENARIOS = [
  ['L1 revocation between claim and batch', l1RevokeBeforeStage],
  ['L2 batch parked on org lock, revocation queued', l2StageParkedRevokeQueued],
  ['L3 lease takeover: expired run cannot promote', l3LeaseTakeover],
  ['L4 approval withdrawn and re-granted before old batch', l4ReapprovalWithOldRun],
  ['L5 partial batch does not withdraw selections', l5PartialBatchKeepsSelection],
  ['L6 complete batch withdraws absent listings', l6CompleteBatchWithdraws],
  ['C1 deselect while publication waits', c1DeselectWhilePublishWaits],
  ['C2 refresh of a selected listing keeps its selection', c2RefreshKeepsSelection],
  ['C3 selection change behind publication', c3SelectionWaitsForPublication],
  ['U1 two companies, one application URL (manual)', u1TwoCompaniesSameUrl],
  ['U2a feed batch behind manual claim, one application URL', (c) => u2FeedBatchVsManualSameUrl(c, 'manual-first')],
  ['U2b manual claim behind feed batch, one application URL', (c) => u2FeedBatchVsManualSameUrl(c, 'feed-first')],
];

async function fixtureDb(tag) {
  const db = dbName(tag);
  spawnSync('dropdb', ['--if-exists', '--force', db]);
  assert.equal(spawnSync('createdb', ['-T', TPL, db]).status, 0, `createdb ${db}`);
  const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', 'tests/sql/employer-concurrency-fixtures.sql'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `fixtures: ${r.stderr}`);
  return db;
}

test('employer lease, selection and application-URL interleavings', { skip: !enabled && 'set FJ_PG_DISPOSABLE=1 with a disposable PostgreSQL 17' }, async (t) => {
  spawnSync('dropdb', ['--if-exists', '--force', TPL]);
  assert.equal(spawnSync('createdb', [TPL]).status, 0, 'createdb template');
  t.after(() => spawnSync('dropdb', ['--if-exists', '--force', TPL]));
  for (const f of CHAIN) {
    const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', TPL, '-f', f], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
  const results = [];
  const only = process.env.FJ_CONC_ONLY;
  for (const [name, fn] of SCENARIOS.filter(([n]) => !only || n.startsWith(only))) {
    const tag = name.split(' ')[0].toLowerCase();
    const db = await fixtureDb(tag);
    const c = await open(db);
    let res;
    try {
      res = await fn(c);
    } catch (e) {
      res = { expected: 'scenario runs', observed: `harness error: ${e.message}`, pass: false };
    } finally {
      await closeAll(c);
      spawnSync('dropdb', ['--if-exists', '--force', db]);
    }
    results.push({ name, ...res });
  }
  const label = FIX_ON && existsSync(root + FIX_FILE) ? 'with integrated URL fix and deployed coordinator' : 'baseline (deployed coordinator, no URL fix)';
  const summary = results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      expected: ${r.expected}\n      observed: ${r.observed}`).join('\n');
  console.log(`\n${label}\n${summary}`);
  if (process.env.FJ_LEASE_RESULTS) writeFileSync(process.env.FJ_LEASE_RESULTS, JSON.stringify({ label, results }, null, 2));
  const failed = results.filter((r) => !r.pass).map((r) => r.name);
  assert.deepEqual(failed, [], `failed scenarios: ${failed.join('; ')}`);
});
