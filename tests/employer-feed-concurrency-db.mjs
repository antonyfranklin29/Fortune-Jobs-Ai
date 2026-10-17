// Feed, revocation, draft-edit, downgrade and deletion interleavings for the employer backend.
// Runs on a DISPOSABLE local PostgreSQL 17 server (never a Supabase project). Each scenario gets
// its own database cloned from a template that has the full pending chain applied.
//
//   FJ_PG_DISPOSABLE=1 PGHOST=127.0.0.1 PGPORT=54417 PGUSER=postgres node --test tests/employer-feed-concurrency-db.mjs
//
//   Default: the current main chain (through 20261020) plus the feed concurrency fix in
//            migrations 20261021 and 20261022.
//   FJ_FEED_FIX=0: the baseline, main chain only. Expected to show the failing interleavings.
//   FJ_CONC_RESULTS=/path/results.json  writes per-scenario results.
//
// Feed candidates are staged by calling employer_stage_feed_candidates directly as the database
// owner (the registry lease path is not exercised here). Revocation and deletion use the real RPCs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const enabled = process.env.FJ_PG_DISPOSABLE === '1' && spawnSync('psql', ['--version']).status === 0;
const FEED_FIX = process.env.FJ_FEED_FIX !== '0';
const REVIEW_FIX = process.env.FJ_FEED_REVIEW_FIX !== '0';
const FIX_FILE = 'migrations/pending/20261021_employer_feed_concurrency_hardening.sql';
const TPL = `fj_feed_tpl_${process.pid}`;

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
  ...(FEED_FIX ? [FIX_FILE] : []),
  ...(FEED_FIX ? ['migrations/pending/20261022_employer_paused_post_state.sql', 'migrations/pending/20261023_employer_lease_selection_url_hardening.sql'] : []),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(25); }
  throw new Error('required lock interleaving was not observed within the deadline');
}
const dbName = (tag) => `fj_feed_${tag}_${process.pid}`;

// Independent backend per session. Errors are returned as text so negative cases can be inspected.
class Session {
  constructor(db, label) {
    this.label = label;
    this.client = new pg.Client({ database: db, application_name: 'fj_feed_' + label,
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

// ── fixtures ─────────────────────────────────────────────────────────────────
const body = (i, tag = 'base') => JSON.stringify({
  job_title: `Data Analyst ${i}`, canonical_role: 'data-analyst', state_code: 'NC', city: 'Raleigh',
  description: `Analyse data and build reports for the finance team (${tag}). `.repeat(3),
  apply_url: `https://careers.acme-a.com/jobs/feed-${i}-${Math.random().toString(36).slice(2)}`,
  posting_date: new Date().toISOString().slice(0, 10),
  closing_date: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
async function mkPost(c, owner, org, i, tag) {
  const s = await c.actor(owner);
  const pid = await s.run(`select (public.employer_save_post('${org}', null, $j$${body(i, tag)}$j$::jsonb)->>'id')`);
  await s.run(`select public.employer_submit_post('${pid}')`);
  return pid;
}
async function mkApproved(c, owner, org, i) {
  const pid = await mkPost(c, owner, org, i);
  await c.q(`update public.employer_posts set status = 'approved', reviewed_revision = revision,
             reviewed_by = '${c.map.OP}', reviewed_at = now() where id = '${pid}'`);
  return pid;
}
async function mkLive(c, owner, org, i, tag) {
  const pid = await mkPost(c, owner, org, i, tag);
  const ops = await c.actor('OP');
  const out = await ops.run(`select public.operator_review_post('${pid}', 1, 'approve', null)`);
  if (!/"published"\s*:\s*true/.test(out)) throw new Error(`fixture: live post not published: ${out}`);
  return pid;
}

// Feed source: submitted by X (owner), approved by the operator, two candidates staged at revision 2
// and selected by X. Returns the source id and the listing ids.
async function feedFixture(c, tag, pids) {
  const board = 'acmeboard' + tag;
  const x = await c.actor('X');
  const sub = parseJson(await x.run(`select public.employer_submit_source('${c.map.ORG_A}', 'greenhouse', 'global', '${board}',
    '{"boards.greenhouse.io"}', '{"display":true,"refresh":true,"description":true}', 'v1')`));
  if (!sub || !sub.id) throw new Error('fixture: submit source failed');
  const src = sub.id;
  const op = await c.actor('OP');
  const appr = await op.run(`select public.operator_review_source('${src}', 1, 'approve', '{"boards.greenhouse.io"}',
    'Acme Analytics', true, now() + interval '200 days', 'letter-2026-10-01', 'checked permission letter')`);
  if (!/"revision"\s*:\s*2/.test(appr)) throw new Error('fixture: approve source failed: ' + appr);
  const rows = pids.map((pid, i) => ({
    source_listing_id: `${src}:${pid}`, job_title: `Data Analyst ${i + 1}`, canonical_role: 'data-analyst',
    location: 'Raleigh, NC', state_code: 'NC', country: 'us', employment_type: 'Full-time', work_mode: 'onsite',
    is_remote: false, posted_at: new Date().toISOString(), job_description: `Feed role ${i + 1} description`,
    apply_url: `https://boards.greenhouse.io/${board}/jobs/${pid}`,
  }));
  const staged = await c.q(`select public.employer_stage_feed_candidates('${src}', 2, $j$${JSON.stringify(rows)}$j$::jsonb)`);
  if (!/^\d+$/.test(staged)) throw new Error('fixture: stage failed: ' + staged);
  await x.run(`select public.employer_select_feed_jobs('${src}', '{${pids.join(',')}}', true)`);
  return { src, pids };
}
// Publish through the service-role RPC, on its own backend so it can be parked.
const pubOn = (sess, src, ids) => sess.run(`set role service_role;
  select public.employer_publish_feed_jobs('${src}', 2, '{${ids.join(',')}}'::text[]); reset role;`);
const openFeedJobs = (c, src) => c.q(`select count(*) from public.pre_scraped_jobs where employer_source_id = '${src}' and closed_at is null`).then(num);
async function anonVisible(c, where) {
  const s = c.raw();
  return num((await s.run(`set role anon; select count(*) from public.pre_scraped_jobs where ${where};`)).split('\n').pop());
}
const activeCount = (c, org) => c.q(`select public.employer_active_count('${org}')`).then(num);

// ── scenarios ────────────────────────────────────────────────────────────────
// Each returns { expected, observed, pass }.

// F01: a feed publish holds the organisation lock and is parked on a candidate row; revocation queues
// behind it. Once both finish, revocation must leave no open or visible listing from the source.
async function f01PublishParkedThenRevoke(c) {
  const f = await feedFixture(c, 'f01', ['P1']);
  const hold = c.raw();
  await hold.run(`begin; select 1 from public.employer_feed_candidates where source_id = '${f.src}' and provider_post_id = 'P1' for update;`);
  const pub = pubOn(c.raw(), f.src, ['P1']);
  await until(async () => (await c.lockWaits()) >= 1);
  const rv = (await c.actor('OP')).run(`select public.operator_revoke_source('${f.src}', 'takedown')`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [p, r] = await Promise.all([pub, rv]);
  const open = await openFeedJobs(c, f.src);
  const vis = await anonVisible(c, `employer_source_id = '${f.src}'`);
  const pass = !hasError(p, r) && parseJson(p)?.published === 1 && open === 0 && vis === 0;
  return { expected: 'revocation after an in-flight publish leaves no open or visible job from the source',
    observed: `publish: ${p.split('\n').pop().slice(0, 100)}; revoke closed: ${r.split('\n').pop().slice(0, 60)}; open ${open}; visible to anon ${vis}`, pass };
}

// F02: revocation and publish both queue on the organisation lock. Whichever runs first, the end state
// must have no open or visible listing from the source.
async function f02RevokeAndPublishQueued(c) {
  const f = await feedFixture(c, 'f02', ['P1']);
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const rv = (await c.actor('OP')).run(`select public.operator_revoke_source('${f.src}', 'takedown')`);
  await until(async () => (await c.lockWaits()) >= 1);
  const pub = pubOn(c.raw(), f.src, ['P1']);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [r, p] = await Promise.all([rv, pub]);
  const open = await openFeedJobs(c, f.src);
  const vis = await anonVisible(c, `employer_source_id = '${f.src}'`);
  const pass = !hasError(r) && (!hasError(p) || /source_not_publishable/.test(p)) && open === 0 && vis === 0;
  return { expected: 'queued revoke and publish end with no open or visible job from the source',
    observed: `revoke: ${r.split('\n').pop().slice(0, 70)}; publish: ${p.split('\n').pop().slice(0, 90)}; open ${open}; visible ${vis}`, pass };
}

// F03: 14 live manual posts. Manual activation and a two-listing feed publish queue behind the same
// organisation lock. Exactly one new listing may take the 15th slot.
async function f03QuotaManualAndFeed(c) {
  for (let i = 1; i <= 14; i++) await mkLive(c, 'A', c.map.ORG_A, 300 + i, 'f03');
  const f = await feedFixture(c, 'f03', ['P1', 'P2']);
  const post = await mkApproved(c, 'A', c.map.ORG_A, 320);
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const manual = (await c.actor('A')).run(`select public.employer_activate_post('${post}')`);
  await until(async () => (await c.lockWaits()) >= 1);
  const feed = pubOn(c.raw(), f.src, ['P1', 'P2']);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [m, fe] = await Promise.all([manual, feed]);
  const feedOut = parseJson(fe) || {};
  const newListings = (/"published"\s*:\s*true/.test(m) ? 1 : 0) + (feedOut.published || 0) + (feedOut.updated || 0);
  const active = await activeCount(c, c.map.ORG_A);
  const pass = !hasError(m, fe) && newListings === 1 && active === 15;
  return { expected: 'manual and feed listings together take one slot; active count 15',
    observed: `manual: ${m.split('\n').pop().slice(0, 60)}; feed published ${feedOut.published}, blocked ${feedOut.blocked_quota}; active ${active}`, pass };
}

// F04: an operator approves revision 1 while it waits on the organisation lock; the owner edits the post
// (which takes only the post row) and commits revision 2 first. The approval must not bind to revision 2,
// and the edited text must not go live under revision 1's approval.
async function f04EditDuringApproval(c) {
  const post = await mkPost(c, 'A', c.map.ORG_A, 401, 'f04');
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const rv = (await c.actor('OP')).run(`select public.operator_review_post('${post}', 1, 'approve', null)`);
  await until(async () => (await c.lockWaits()) >= 1);
  const a = await c.actor('A');
  const edit = a.run(`select public.employer_save_post('${c.map.ORG_A}', '${post}', $j$${JSON.stringify({ description: 'EDITED-REVISION-TWO ' + 'x'.repeat(60) })}$j$::jsonb)`);
  const editDone = await Promise.race([edit.then(() => true), sleep(1000).then(() => false)]);
  await hold.run('commit;');
  const [r, e] = await Promise.all([rv, edit]);
  const rev = await c.q(`select revision || '|' || coalesce(reviewed_revision::text,'') from public.employer_posts where id = '${post}'`);
  const edited = num(await c.q(`select count(*) from public.pre_scraped_jobs where employer_post_id = '${post}' and closed_at is null and job_description like 'EDITED-REVISION-TWO%'`));
  const [revision, reviewed] = rev.split('|');
  const pass = !edited && (reviewed === '' || reviewed !== revision) && !hasDeadlock(r, e);
  return { expected: 'approval of revision 1 never publishes the edited revision 2 text',
    observed: `edit completed before approval released: ${editDone}; approval: ${r.split('\n').pop().slice(0, 80)}; revision ${revision}, reviewed ${reviewed || 'null'}; live edited text ${edited}`, pass };
}

// F05: an owner edits a live post. The public listing must keep the approved text until the new revision
// is approved, and owner re-activation must be refused.
async function f05LiveEditKeepsApprovedListing(c) {
  const post = await mkLive(c, 'A', c.map.ORG_A, 501, 'f05');
  const a = await c.actor('A');
  await a.run(`select public.employer_save_post('${c.map.ORG_A}', '${post}', $j$${JSON.stringify({ description: 'EDITED-REVISION-TWO ' + 'x'.repeat(60) })}$j$::jsonb)`);
  const act = await a.run(`select public.employer_activate_post('${post}')`);
  const edited = num(await c.q(`select count(*) from public.pre_scraped_jobs where employer_post_id = '${post}' and closed_at is null and job_description like 'EDITED-REVISION-TWO%'`));
  const open = await openJobs(c, post);
  const pass = /review_required/.test(act) && edited === 0 && open === 1;
  return { expected: 'live post edits stay private until re-approved; activation refused with review_required',
    observed: `activation: ${act.split('\n').pop().slice(0, 80)}; open jobs ${open}; listing carries edit ${edited}`, pass };
}
const openJobs = (c, post) => c.q(`select count(*) from public.pre_scraped_jobs where employer_post_id = '${post}' and closed_at is null`).then(num);

// F06: an approved (quota-blocked) post is edited. The edit must drop the approval; neither owner
// activation nor a direct operator-path publish may use the stale approval.
async function f06ApprovedThenEdited(c) {
  const post = await mkApproved(c, 'A', c.map.ORG_A, 601);
  const a = await c.actor('A');
  await a.run(`select public.employer_save_post('${c.map.ORG_A}', '${post}', '{"job_title":"Edited title"}'::jsonb)`);
  const act = await a.run(`select public.employer_activate_post('${post}')`);
  const direct = await c.q(`select public.employer_publish_post_internal('${post}', null, 'operator')`);
  const open = await openJobs(c, post);
  const pass = /review_required/.test(act) && /revision_not_approved/.test(direct) && open === 0;
  return { expected: 'an edited approved post cannot publish on its old approval',
    observed: `activation: ${act.split('\n').pop().slice(0, 60)}; direct publish: ${direct.split('\n').pop().slice(0, 70)}; open jobs ${open}`, pass };
}

// Helper for F07/F08: 16 active posts with the free allowance raised for the setup, then restored to 15.
async function sixteenLive(c) {
  const ids = [];
  await c.q(`update public.employer_billing_config set free_active_posts = 16 where id`);
  for (let i = 1; i <= 16; i++) ids.push(await mkLive(c, 'A', c.map.ORG_A, 700 + i, 'downgrade'));
  await c.q(`update public.employer_billing_config set free_active_posts = 15 where id`);
  for (let i = 0; i < 14; i++) await (await c.actor('A')).run(`select public.employer_set_keep_on_downgrade('${ids[i]}', true)`);
  return ids;
}

// F07: the owner marks post 15 to keep while the downgrade is parked on post 16's job row. The keep
// choice commits before the downgrade's pause runs. Honour it, or refuse to pause it.
async function f07KeepDuringDowngrade(c) {
  const ids = await sixteenLive(c);
  const job16 = await c.q(`select published_job_id from public.employer_posts where id = '${ids[15]}'`);
  const hold = c.raw();
  await hold.run(`begin; select 1 from public.pre_scraped_jobs where id = ${job16} for update;`);
  const dg = c.raw().run(`set role service_role; select public.employer_apply_downgrade('${c.map.ORG_A}'); reset role;`);
  await until(async () => (await c.lockWaits()) >= 1);
  const keep = (await c.actor('A')).run(`select public.employer_set_keep_on_downgrade('${ids[14]}', true)`);
  const keepDone = await Promise.race([keep.then(() => true), sleep(1000).then(() => false)]);
  await hold.run('commit;');
  const [d, k] = await Promise.all([dg, keep]);
  const flags = await c.q(`select keep_on_downgrade || '|' || status from public.employer_posts where id = '${ids[14]}'`);
  const active = await activeCount(c, c.map.ORG_A);
  const pass = active <= 15 && !(keepDone && flags.startsWith('true|paused')) && !hasError(d,k);
  return { expected: 'a keep choice committed during a downgrade is honoured; active count at most 15',
    observed: `keep committed before downgrade finished: ${keepDone}; downgrade: ${d.split('\n').pop().slice(0, 90)}; post 15 keep|status ${flags}; active ${active}`, pass };
}

// F08: the downgrade is parked on the same row; a manual activation queues behind the organisation lock.
// The final active count must stay within 15.
async function f08DowngradeThenPublish(c) {
  const ids = await sixteenLive(c);
  const job16 = await c.q(`select published_job_id from public.employer_posts where id = '${ids[15]}'`);
  const extra = await mkApproved(c, 'A', c.map.ORG_A, 717);
  const hold = c.raw();
  await hold.run(`begin; select 1 from public.pre_scraped_jobs where id = ${job16} for update;`);
  const dg = c.raw().run(`set role service_role; select public.employer_apply_downgrade('${c.map.ORG_A}'); reset role;`);
  await until(async () => (await c.lockWaits()) >= 1);
  const pub = (await c.actor('A')).run(`select public.employer_activate_post('${extra}')`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [d, p] = await Promise.all([dg, pub]);
  const active = await activeCount(c, c.map.ORG_A);
  const pass = active <= 15 && !hasError(d,p);
  return { expected: 'publish after a downgrade respects the free allowance; active count at most 15',
    observed: `downgrade: ${d.split('\n').pop().slice(0, 90)}; publish: ${p.split('\n').pop().slice(0, 70)}; active ${active}`, pass };
}

// F09: the submitting owner is deleted while a feed publish holds the organisation lock and is parked on a
// candidate. The deletion must neither deadlock nor lose the publish.
async function f09OwnerDeletedDuringFeedPublish(c) {
  const f = await feedFixture(c, 'f09', ['P1']);
  const hold = c.raw();
  await hold.run(`begin; select 1 from public.employer_feed_candidates where source_id = '${f.src}' and provider_post_id = 'P1' for update;`);
  const pub = pubOn(c.raw(), f.src, ['P1']);
  await until(async () => (await c.lockWaits()) >= 1);
  const del = c.raw().run(`delete from auth.users where id = '${c.map.X}'`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [p, d] = await Promise.all([pub, del]);
  const open = await openFeedJobs(c, f.src);
  const org = await c.q(`select status from public.employer_orgs where id = '${c.map.ORG_A}'`);
  const pass = !hasDeadlock(p, d) && !hasError(d) && open === 1 && org === 'verified';
  return { expected: 'owner deletion during a feed publish: no deadlock, publish completes, org stays verified',
    observed: hasDeadlock(p, d) ? 'deadlock detected' : `publish: ${p.split('\n').pop().slice(0, 80)}; deletion: ${d.slice(0, 50) || 'ok'}; open feed jobs ${open}; org ${org}`, pass };
}

// F10: the operator who approved a source is deleted. The source is demoted to pending and hidden. Its open
// feed listings must not stay open and count against the organisation's allowance.
async function f10ApproverDeletedLeavesFeedJobs(c) {
  const f = await feedFixture(c, 'f10', ['P1']);
  const p = await pubOn(c.raw(), f.src, ['P1']);
  const before = await openFeedJobs(c, f.src);
  const del = await c.q(`delete from auth.users where id = '${c.map.OP}'`);
  const status = await c.q(`select status || '|' || enabled from public.employer_sources where id = '${f.src}'`);
  const open = await openFeedJobs(c, f.src);
  const vis = await anonVisible(c, `employer_source_id = '${f.src}'`);
  const active = await activeCount(c, c.map.ORG_A);
  const pass = before === 1 && !hasError(del) && status === 'pending|false' && open === 0 && vis === 0 && active === 0;
  return { expected: 'a source demoted by approver deletion has no open feed listing and holds no allowance',
    observed: `published ${parseJson(p)?.published}; deletion: ${del.slice(0, 60) || 'ok'}; source ${status}; open feed jobs ${open}; visible ${vis}; active ${active}`, pass };
}

// F11: the last owner of an org is deleted. The org is suspended. Its open live listing must be closed,
// not left open and counted against the allowance.
async function f11LastOwnerDeletedLeavesListing(c) {
  const post = await mkLive(c, 'B', c.map.ORG_B, 901, 'f11');
  const del = await c.q(`delete from auth.users where id = '${c.map.B}'`);
  const org = await c.q(`select status from public.employer_orgs where id = '${c.map.ORG_B}'`);
  const open = await openJobs(c, post);
  const active = await activeCount(c, c.map.ORG_B);
  const pass = !hasError(del) && org === 'suspended' && open === 0 && active === 0;
  return { expected: 'last owner deleted: org suspended and its open listing closed',
    observed: `deletion: ${del.slice(0, 60) || 'ok'}; org ${org}; open listings ${open}; active ${active}`, pass };
}

// F12: the operator revokes a source while the submitting owner is deleted; both queue on the org lock.
async function f12RevokeAndOwnerDeletion(c) {
  const f = await feedFixture(c, 'f12', ['P1']);
  await pubOn(c.raw(), f.src, ['P1']);
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const rv = (await c.actor('OP')).run(`select public.operator_revoke_source('${f.src}', 'takedown')`);
  await until(async () => (await c.lockWaits()) >= 1);
  const del = c.raw().run(`delete from auth.users where id = '${c.map.X}'`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [r, d] = await Promise.all([rv, del]);
  const open = await openFeedJobs(c, f.src);
  const vis = await anonVisible(c, `employer_source_id = '${f.src}'`);
  const pass = !hasError(r, d) && open === 0 && vis === 0;
  return { expected: 'revocation and owner deletion queued together: no deadlock, no open or visible job',
    observed: hasDeadlock(r, d) ? 'deadlock detected' : `revoke: ${r.split('\n').pop().slice(0, 60)}; deletion: ${d.slice(0, 40) || 'ok'}; open ${open}; visible ${vis}`, pass };
}

// F13: after F11's suspension, an operator re-verifies the org. A listing that was live before the
// suspension must not reappear without a fresh review.
async function f13ReverifyDoesNotRevive(c) {
  const post = await mkLive(c, 'B', c.map.ORG_B, 902, 'f13');
  await c.q(`delete from auth.users where id = '${c.map.B}'`);
  const op = await c.actor('OP');
  const re = await op.run(`select public.operator_set_org_status('${c.map.ORG_B}', 'verified', 'Re-checked: Beta Labs owns beta-b.com')`);
  const vis = await anonVisible(c, `employer_post_id = '${post}'`);
  const open = await openJobs(c, post);
  const org=await c.q(`select status from employer_orgs where id='${c.map.ORG_B}'`);
  const pass = !hasError(re) && org === 'verified' && vis === 0 && open === 0;
  return { expected: 're-verification does not revive the pre-suspension listing',
    observed: `re-verify: ${re.split('\n').pop().slice(0, 60) || 'ok'}; visible ${vis}; open ${open}`, pass };
}

// Additional regression probes for the new preference lock and the existing
// downgrade path. These interleavings pass with Claude's fix: no extra locking
// change is justified by these tests.
async function f14KeepAndCreatorDeletion(c) {
  const post=await mkLive(c,'A',c.map.ORG_A,1401,'f14');
  const hold=c.raw();await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const keep=(await c.actor('X')).run(`select public.employer_set_keep_on_downgrade('${post}',true)`);
  await until(async()=>(await c.lockWaits())>=1);
  const del=c.raw().run(`delete from auth.users where id='${c.map.A}'`);
  await until(async()=>(await c.lockWaits())>=2);
  await hold.run('commit');const [k,d]=await Promise.all([keep,del]);
  const flag=await c.q(`select keep_on_downgrade from employer_posts where id='${post}'`);
  const remaining=num(await c.q(`select count(*) from auth.users where id='${c.map.A}'`));
  return {expected:'keep choice and creator deletion both succeed without a deadlock',
    observed:`keep: ${k||'ok'}; deletion: ${d||'ok'}; kept ${flag}; creator remaining ${remaining}`,
    pass:!hasError(k,d)&&flag==='true'&&remaining===0};
}

async function f15DowngradeAndOwnerDeletion(c) {
  const ids=await sixteenLive(c);
  const job=await c.q(`select published_job_id from employer_posts where id='${ids[15]}'`);
  const hold=c.raw();await hold.run(`begin; select 1 from pre_scraped_jobs where id=${job} for update;`);
  const downgrade=c.raw().run(`set role service_role; select public.employer_apply_downgrade('${c.map.ORG_A}'); reset role;`);
  await until(async()=>(await c.lockWaits())>=1);
  const del=c.raw().run(`delete from auth.users where id='${c.map.A}'`);
  await until(async()=>(await c.lockWaits())>=2);
  await hold.run('commit');const [dg,d]=await Promise.all([downgrade,del]);
  const active=await activeCount(c,c.map.ORG_A);
  const remaining=num(await c.q(`select count(*) from auth.users where id='${c.map.A}'`));
  return {expected:'downgrade and creator deletion both succeed, active jobs at most 15',
    observed:`downgrade: ${dg}; deletion: ${d||'ok'}; active ${active}; creator remaining ${remaining}`,
    pass:!hasError(dg,d)&&active<=15&&remaining===0};
}

const SCENARIOS = [
  ['F01 publish parked, revocation queued behind it', f01PublishParkedThenRevoke],
  ['F02 revocation and publish both queued on the org lock', f02RevokeAndPublishQueued],
  ['F03 shared 15-slot quota: manual and feed publishers', f03QuotaManualAndFeed],
  ['F04 edit committed while approval of the prior revision is queued', f04EditDuringApproval],
  ['F05 live post edited: listing stays on approved text', f05LiveEditKeepsApprovedListing],
  ['F06 approved post edited: old approval not usable', f06ApprovedThenEdited],
  ['F07 keep-on-downgrade committed during a downgrade', f07KeepDuringDowngrade],
  ['F08 downgrade parked, manual publish queued behind it', f08DowngradeThenPublish],
  ['F09 submitting owner deleted during a feed publish', f09OwnerDeletedDuringFeedPublish],
  ['F10 approving operator deleted: feed listings closed', f10ApproverDeletedLeavesFeedJobs],
  ['F11 last owner deleted: live listing closed', f11LastOwnerDeletedLeavesListing],
  ['F12 revocation and owner deletion queued together', f12RevokeAndOwnerDeletion],
  ['F13 re-verification after suspension does not revive listing', f13ReverifyDoesNotRevive],
  ['F14 keep choice and post creator deletion', f14KeepAndCreatorDeletion],
  ['F15 downgrade and owner deletion', f15DowngradeAndOwnerDeletion],
];

async function fixtureDb(tag) {
  const db = dbName(tag);
  spawnSync('dropdb', ['--if-exists', '--force', db]);
  assert.equal(spawnSync('createdb', ['-T', TPL, db]).status, 0, `createdb ${db}`);
  const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', 'tests/sql/employer-concurrency-fixtures.sql'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `fixtures: ${r.stderr}`);
  return db;
}

test('employer feed, revocation, draft and deletion interleavings', { skip: !enabled && 'set FJ_PG_DISPOSABLE=1 with a disposable PostgreSQL 17' }, async (t) => {
  assert.equal(new Set(CHAIN).size,CHAIN.length,'migration chain must not repeat a file');
  spawnSync('dropdb', ['--if-exists', '--force', TPL]);
  assert.equal(spawnSync('createdb', [TPL]).status, 0, 'createdb template');
  t.after(() => spawnSync('dropdb', ['--if-exists', '--force', TPL]));
  for (const f of CHAIN) {
    const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', TPL, '-f', f], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
  const results = [];
  const only = process.env.FJ_CONC_ONLY;
  // F14/F15 are follow-up regressions on the reviewed lock design. In
  // particular F14 requires the org lock that did not exist before 20261021.
  for (const [name, fn] of SCENARIOS.filter(([n]) => (!only || n.startsWith(only))
    && (FEED_FIX || (!n.startsWith('F14 ') && !n.startsWith('F15 '))))) {
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
  const summary = results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      expected: ${r.expected}\n      observed: ${r.observed}`).join('\n');
  console.log(`\n${FEED_FIX ? 'with 20261021 fix and current workspace projection' : 'baseline (main chain, no 20261021 fix)'}\n${summary}`);
  if (process.env.FJ_CONC_RESULTS) writeFileSync(process.env.FJ_CONC_RESULTS, JSON.stringify({ fix: FEED_FIX, results }, null, 2));
  const failed = results.filter((r) => !r.pass).map((r) => r.name);
  assert.deepEqual(failed, [], `failed scenarios: ${failed.join('; ')}`);
});
