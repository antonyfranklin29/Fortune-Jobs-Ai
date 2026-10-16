// Concurrency review of the employer backend (docs/claude-employer-concurrency-review.md).
// Runs deterministic interleavings on a DISPOSABLE local PostgreSQL 16/17 server (never a
// Supabase project). Each scenario gets its own database cloned from a migrated template.
// Sessions use independent direct protocol connections; a statement is "blocked" when pg_stat_activity
// reports wait_event_type = 'Lock' for it.
//
//   FJ_PG_DISPOSABLE=1 PGHOST=/var/tmp/fjpg PGPORT=54329 PGUSER=postgres node --test tests/employer-concurrency-db.mjs
//   Defaults to the complete current chain. FJ_CONC_FIX=0 reproduces the old baseline.
//   FJ_CONC_RESULTS=/path/results.json   writes the per-scenario results
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const enabled = process.env.FJ_PG_DISPOSABLE === '1' && spawnSync('psql', ['--version']).status === 0;
const FIX = process.env.FJ_CONC_FIX !== '0';
const TPL = `fj_conc_tpl_${process.pid}`;

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
  ...(FIX ? ['migrations/pending/20261019_employer_concurrency_hardening.sql',
    'migrations/pending/20261020_employer_post_actions.sql',
    'migrations/pending/20261021_employer_feed_concurrency_hardening.sql'] : []),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(25); }
  throw new Error('required lock interleaving was not observed within the deadline');
}
const dbName = (tag) => `fj_conc_${tag}_${process.pid}`;

// Direct protocol sessions work on Windows and Unix without psql stdout buffering.
// Each session is a separate backend connection; errors are returned as text so
// negative scenarios can inspect the database's actual refusal.
class Session {
  constructor(db,label){
    this.label=label;
    this.client=new pg.Client({database:db,application_name:'fj_concurrency_'+label,
      connectionTimeoutMillis:3000,query_timeout:20000,statement_timeout:15000});
    this.client.on('error',()=>{});
    this.ready=this.client.connect();
  }
  async run(sql){
    let text;
    try{
      await this.ready;
      const result=await this.client.query(sql);
      text=(Array.isArray(result)?result:[result]).flatMap(r=>r.rows.map(row=>
        r.fields.map(f=>{const v=row[f.name];return v==null?'':typeof v==='object'?JSON.stringify(v):String(v);}).join('|'))).join('\n');
    }catch(e){text='ERROR '+e.code+': '+e.message+(e.detail?'\nDETAIL: '+e.detail:'');}
    if(process.env.FJ_CONC_DEBUG)console.error('['+this.label+'] '+sql.slice(0,90)+' => '+text.slice(0,240));
    return text.trim();
  }
  async end(){await this.client.end();}
}

// Scenario context: one database, a control session as the owner, and actor sessions.
async function open(db, ids) {
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
  const q = (sql) => ctl.run(sql);
  return { db, ctl, map, actor, raw, lockWaits, q, sessions, ids };
}

async function closeAll(c) { await Promise.allSettled(c.sessions.map(s=>s.end())); }

// Fixture helpers. Posts are created as the owner; approval goes through the real
// operator RPC unless the scenario needs an approved but unpublished post, in which case
// the state is set directly (the publish path itself is still the real one).
const body = (i) => JSON.stringify({
  job_title: `Data Analyst ${i}`, canonical_role: 'data-analyst', state_code: 'NC', city: 'Raleigh',
  description: 'Analyse data and build reports for the finance team. '.repeat(3),
  apply_url: `https://careers.acme-a.com/jobs/conc-${i}-${Math.random().toString(36).slice(2)}`,
  posting_date: new Date().toISOString().slice(0, 10),
  closing_date: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
async function mkPost(c, owner, org, i) {
  const s = await c.actor(owner);
  const pid = await s.run(`select (public.employer_save_post('${org}', null, $j$${body(i)}$j$::jsonb)->>'id')`);
  await s.run(`select public.employer_submit_post('${pid}')`);
  s.end();
  return pid;
}
async function mkApproved(c, owner, org, i) {
  const pid = await mkPost(c, owner, org, i);
  await c.q(`update public.employer_posts set status = 'approved', reviewed_revision = revision,
             reviewed_by = '${c.map.OP}', reviewed_at = now() where id = '${pid}'`);
  return pid;
}
async function mkLive(c, owner, org, i) {
  const pid = await mkPost(c, owner, org, i);
  const ops = await c.actor('OP');
  const out = await ops.run(`select public.operator_review_post('${pid}', 1, 'approve', null)`);
  ops.end();
  if (!/"published"\s*:\s*true/.test(out)) throw new Error(`fixture: live post not published: ${out}`);
  return pid;
}
const openJobs = (c, post) => c.q(`select count(*) from public.pre_scraped_jobs where employer_post_id = '${post}' and closed_at is null`).then(Number);
const postStatus = (c, post) => c.q(`select status from public.employer_posts where id = '${post}'`);
const hasDeadlock = (...outs) => outs.some((o) => /deadlock detected/.test(o));

// ── scenarios ────────────────────────────────────────────────────────────────
// Each returns { name, expected, observed, pass }. Expected behaviour is the correct
// behaviour; a baseline failure is a demonstrated defect.

async function s01BanBeforeActivation(c) {
  const post = await mkApproved(c, 'A', c.map.ORG_A, 1);
  await c.q(`update auth.users set banned_until = now() + interval '1 day' where id = '${c.map.A}'`);
  const a = await c.actor('A');
  const out = await a.run(`select public.employer_activate_post('${post}')`);
  const pass = /account_banned/.test(out) && (await openJobs(c, post)) === 0;
  return { expected: 'activation refused with account_banned; no job', observed: out.split('\n').pop().slice(0, 160), pass };
}

async function s02BanDuringActivation(c) {
  const post = await mkApproved(c, 'A', c.map.ORG_A, 2);
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const a = await c.actor('A');
  const pending = a.run(`select public.employer_activate_post('${post}')`);
  await until(async () => (await c.lockWaits()) >= 1);
  const ban = c.raw();
  let banDone = false;
  const banP = ban.run(`update auth.users set banned_until = now() + interval '1 day' where id = '${c.map.A}'`).then((r) => { banDone = true; return r; });
  await sleep(800);
  const banCommittedWhilePublishWaiting = banDone;
  await hold.run('commit;');
  const out = await pending;
  await banP;
  const jobs = await openJobs(c, post);
  const pass = banCommittedWhilePublishWaiting
    ? /account_banned/.test(out) && jobs === 0
    : /"published"\s*:\s*true/.test(out) && jobs === 1;
  return {
    expected: 'if the ban committed before the publish committed, the publish must be refused',
    observed: `ban committed while publish waited: ${banCommittedWhilePublishWaiting}; publish: ${out.split('\n').pop().slice(0, 120)}; open jobs: ${jobs}`,
    pass,
  };
}

async function s03EmployerCloseVsPublish(c) {
  const post = await mkApproved(c, 'A', c.map.ORG_A, 3);
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const pub = (await c.actor('A')).run(`select public.employer_activate_post('${post}')`);
  await until(async () => (await c.lockWaits()) >= 1);
  const close = (await c.actor('A')).run(`select public.employer_close_post('${post}')`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const outcomes=await Promise.all([pub, close]);
  const st = await postStatus(c, post);
  const jobs = await openJobs(c, post);
  const pass = st === 'closed' && jobs === 0 && !/ERROR/.test(outcomes.join('\n'));
  return { expected: 'after the owner closes, no open job remains for the post', observed: `post status ${st}; open jobs ${jobs}`, pass };
}

async function s04OperatorCloseVsPublish(c) {
  const post = await mkApproved(c, 'A', c.map.ORG_A, 4);
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const pub = (await c.actor('A')).run(`select public.employer_activate_post('${post}')`);
  await until(async () => (await c.lockWaits()) >= 1);
  let closeDone = false;
  const cl = (await c.actor('OP')).run(`select public.operator_close_post('${post}', 'takedown')`).then((r) => { closeDone = true; return r; });
  await until(async () => (await c.lockWaits()) >= 2 || closeDone);
  await hold.run('commit;');
  await Promise.all([pub, cl]);
  const st = await postStatus(c, post);
  const jobs = await openJobs(c, post);
  const pass = st === 'closed' && jobs === 0;
  return { expected: 'operator close is final: post closed and no open job', observed: `post status ${st}; open jobs ${jobs}`, pass };
}

async function s05ReviewVsEmployerClose(c) {
  const post = await mkPost(c, 'A', c.map.ORG_A, 5);
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const cl = (await c.actor('A')).run(`select public.employer_close_post('${post}')`);
  await until(async () => (await c.lockWaits()) >= 1);
  const rv = (await c.actor('OP')).run(`select public.operator_review_post('${post}', 1, 'approve', null)`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [a, b] = await Promise.all([cl, rv]);
  return { expected: 'review and owner close both complete without database errors', observed: hasDeadlock(a, b) ? 'deadlock detected' : (a+b).includes('ERROR') ? a+b : 'both completed', pass: !/ERROR/.test(a+b) };
}

async function s06OperatorCloseVsActivateLive(c) {
  const post = await mkLive(c, 'A', c.map.ORG_A, 6);
  const job = await c.q(`select published_job_id from public.employer_posts where id = '${post}'`);
  const hold = c.raw();
  await hold.run(`begin; select 1 from public.pre_scraped_jobs where id = ${job} for update;`);
  const cl = (await c.actor('OP')).run(`select public.operator_close_post('${post}', 'takedown')`);
  await until(async () => (await c.lockWaits()) >= 1);
  const pub = (await c.actor('A')).run(`select public.employer_activate_post('${post}')`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [a, b] = await Promise.all([cl, pub]);
  const closed = (await postStatus(c, post)) === 'closed' && (await openJobs(c,post)) === 0;
  return { expected: 'operator close wins without deadlock and leaves no open job', observed: hasDeadlock(a, b) ? 'deadlock detected' : `closed with no job: ${closed}`, pass: !hasDeadlock(a, b) && closed && !/ERROR/.test(a) };
}

// Owner A (post creator) and co-owner X. Deletion and approval, in both orders.
async function s07ApprovalFirstThenOwnerDeletion(c) {
  const post = await mkPost(c, 'A', c.map.ORG_A, 7);
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const rv = (await c.actor('OP')).run(`select public.operator_review_post('${post}', 1, 'approve', null)`);
  await until(async () => (await c.lockWaits()) >= 1);
  const del = c.raw();
  const dp = del.run(`delete from auth.users where id = '${c.map.A}'`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [r, d] = await Promise.all([rv, dp]);
  const jobs = await openJobs(c, post);
  const org = await c.q(`select status from public.employer_orgs where id = '${c.map.ORG_A}'`);
  const pass = !/ERROR/.test(d) && /"published"\s*:\s*true/.test(r) && jobs === 1 && org === 'verified';
  return { expected: 'approval publishes, deletion succeeds, org stays verified (X still owns it)', observed: `approval: ${r.split('\n').pop().slice(0, 90)}; deletion: ${d.slice(0, 60) || 'ok'}; open jobs ${jobs}; org ${org}`, pass };
}

async function s08OwnerDeletionFirstThenApproval(c) {
  const post = await mkPost(c, 'A', c.map.ORG_A, 8);
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const del = c.raw();
  const dp = del.run(`delete from auth.users where id = '${c.map.A}'`);
  await until(async () => (await c.lockWaits()) >= 1);
  const rv = (await c.actor('OP')).run(`select public.operator_review_post('${post}', 1, 'approve', null)`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [d, r] = await Promise.all([dp, rv]);
  const jobs = await openJobs(c, post);
  const org = await c.q(`select status from public.employer_orgs where id = '${c.map.ORG_A}'`);
  const pass = !/ERROR/.test(d) && /"published"\s*:\s*true/.test(r) && jobs === 1 && org === 'verified';
  return { expected: 'deletion of a post creator neither deadlocks nor blocks approval', observed: hasDeadlock(r, d) ? 'deadlock detected' : `approval: ${r.split('\n').pop().slice(0, 90)}; open jobs ${jobs}; org ${org}`, pass };
}

// Org B has one owner. Deleting that owner suspends the org.
async function s09LastOwnerDeletionFirst(c) {
  const post = await mkPost(c, 'B', c.map.ORG_B, 9);
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_B}');`);
  const dp = c.raw().run(`delete from auth.users where id = '${c.map.B}'`);
  await until(async () => (await c.lockWaits()) >= 1);
  const rv = (await c.actor('OP')).run(`select public.operator_review_post('${post}', 1, 'approve', null)`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [d, r] = await Promise.all([dp, rv]);
  const org = await c.q(`select status from public.employer_orgs where id = '${c.map.ORG_B}'`);
  const jobs = await openJobs(c, post);
  const pass = !hasDeadlock(r, d) && org === 'suspended' && jobs === 0;
  return { expected: 'last owner deleted: org suspended, no new listing for it', observed: hasDeadlock(r, d) ? 'deadlock detected' : `org ${org}; open jobs ${jobs}`, pass };
}

async function s10LastOwnerDeletionAfterApproval(c) {
  const post = await mkPost(c, 'B', c.map.ORG_B, 10);
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_B}');`);
  const rv = (await c.actor('OP')).run(`select public.operator_review_post('${post}', 1, 'approve', null)`);
  await until(async () => (await c.lockWaits()) >= 1);
  const dp = c.raw().run(`delete from auth.users where id = '${c.map.B}'`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [r, d] = await Promise.all([rv, dp]);
  const org = await c.q(`select status from public.employer_orgs where id = '${c.map.ORG_B}'`);
  const an = c.raw();
  const anon = await an.run(`set role anon; select count(*) from public.pre_scraped_jobs where employer_org_id = '${c.map.ORG_B}';`);
  const pass = !hasDeadlock(r, d) && org === 'suspended' && Number(anon.split('\n').pop()) === 0;
  return { expected: 'approved-then-deleted org: suspended, its listings hidden from anonymous visitors', observed: hasDeadlock(r, d) ? 'deadlock detected' : `org ${org}; anonymous visible rows ${anon.split('\n').pop()}`, pass };
}

async function s11TwoOwnersDeletedAOrderFirst(c, order) {
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const first = order === 'A-first' ? c.map.A : c.map.X;
  const second = order === 'A-first' ? c.map.X : c.map.A;
  const d1 = c.raw().run(`delete from auth.users where id = '${first}'`);
  await until(async () => (await c.lockWaits()) >= 1);
  const d2 = c.raw().run(`delete from auth.users where id = '${second}'`);
  await until(async () => (await c.lockWaits()) >= 2);
  await hold.run('commit;');
  const [a, b] = await Promise.all([d1, d2]);
  const org = await c.q(`select status from public.employer_orgs where id = '${c.map.ORG_A}'`);
  const active = await c.q(`select count(*) from public.employer_org_members where org_id = '${c.map.ORG_A}' and role = 'owner' and status = 'active'`);
  const audit = await c.q(`select count(*) from public.employer_audit where org_id = '${c.map.ORG_A}' and action = 'last_owner_account_deleted'`);
  const pass = !hasDeadlock(a, b) && !/ERROR/.test(a + b) && org === 'suspended' && Number(active) === 0 && Number(audit) === 1;
  return { expected: 'both owners deleted: org suspended exactly once, no active owner, no error', observed: `org ${org}; active owners ${active}; suspension audit rows ${audit}; errors: ${/ERROR/.test(a + b)}`, pass };
}

// Two organisations register the same domain; both are DNS-proven; the operator verifies
// them concurrently. Only one may be verified, and the loser must get a clean error.
async function s12DomainRace(c, first) {
  const ops = await c.actor('OP');
  const reg = async (who, name) => JSON.parse((await (await c.actor(who)).run(`select public.employer_register_org('${name}', 'contoso.com')`)).replace(/\n/g, ''));
  const o1 = (await reg('C1', 'Contoso One')).org_id;
  const o2 = (await reg('C2', 'Contoso Two')).org_id;
  for (const o of [o1, o2]) {
    const tok = await c.q(`select token from public.employer_domain_challenges where org_id = '${o}'`);
    await c.q(`set role service_role; select public.employer_mark_domain_verified('${o}', '${tok}'); reset role;`);
  }
  const [winner, loser] = first === 'C1-first' ? [o1, o2] : [o2, o1];
  await ops.run('begin');
  const w = await ops.run(`select public.operator_set_org_status('${winner}', 'verified', 'Checked: Contoso owns contoso.com')`);
  const l = c.actor('OP').then((s) => s.run(`select public.operator_set_org_status('${loser}', 'verified', 'Checked: Contoso owns contoso.com')`));
  await until(async () => (await c.lockWaits()) >= 1);
  await ops.run('commit;');
  const loserOut = await l;
  const verified = Number(await c.q(`select count(*) from public.employer_orgs where primary_domain = 'contoso.com' and status = 'verified'`));
  const cleanError = /domain_already_claimed/.test(loserOut);
  const pass = verified === 1 && cleanError;
  return { expected: 'exactly one verified; the loser gets domain_already_claimed', observed: `verified ${verified}; loser: ${loserOut.split('\n').pop().slice(0, 140) || 'ok'}`, pass };
}

// Quota under concurrency: 14 live posts, three approved posts publish at once.
async function s13QuotaThreePublishers(c) {
  for (let i = 1; i <= 14; i++) await mkLive(c, 'A', c.map.ORG_A, 100 + i);
  const posts = [];
  for (let i = 1; i <= 3; i++) posts.push(await mkApproved(c, 'A', c.map.ORG_A, 200 + i));
  const hold = c.raw();
  await hold.run(`begin; select public.employer_lock_org('${c.map.ORG_A}');`);
  const runs = [];
  for (const p of posts) runs.push((await c.actor('A')).run(`select public.employer_activate_post('${p}')`));
  await until(async () => (await c.lockWaits()) >= 3);
  await hold.run('commit;');
  const outs = await Promise.all(runs);
  const published = outs.filter((o) => /"published"\s*:\s*true/.test(o)).length;
  const refused = outs.filter((o) => /upgrade_required/.test(o)).length;
  const active = Number(await c.q(`select public.employer_active_count('${c.map.ORG_A}')`));
  const pass = published === 1 && refused === 2 && active === 15;
  return { expected: 'one publish takes the 15th slot, two get upgrade_required, active count 15', observed: `published ${published}, upgrade_required ${refused}, active ${active}`, pass };
}

// A post the operator closed must not be re-opened by its owner.
async function s16OwnerReactivatesOperatorClosedPost(c) {
  const post = await mkLive(c, 'A', c.map.ORG_A, 16);
  await (await c.actor('OP')).run(`select public.operator_close_post('${post}', 'takedown')`);
  const out = await (await c.actor('A')).run(`select public.employer_activate_post('${post}')`);
  const jobs = await openJobs(c, post);
  const pass = /review_required/.test(out) && jobs === 0 && (await postStatus(c,post)) === 'closed';
  return { expected: 'owner activation refused after an operator close; no open job', observed: `${out.split('\n').pop().slice(0, 120)}; open jobs ${jobs}`, pass };
}

const SCENARIOS = [
  ['S01 ban before activation (control)', s01BanBeforeActivation],
  ['S02 ban during in-flight activation', s02BanDuringActivation],
  ['S03 owner close vs publish (unpublished approved post)', s03EmployerCloseVsPublish],
  ['S04 operator close vs publish (unpublished approved post)', s04OperatorCloseVsPublish],
  ['S05 operator review vs owner close: lock order', s05ReviewVsEmployerClose],
  ['S06 operator close vs owner re-activation of live post: lock order', s06OperatorCloseVsActivateLive],
  ['S07 owner deletion after approval queued (approval first)', s07ApprovalFirstThenOwnerDeletion],
  ['S08 owner deletion first, approval queued behind it', s08OwnerDeletionFirstThenApproval],
  ['S09 last owner deleted, approval queued (deletion first)', s09LastOwnerDeletionFirst],
  ['S10 last owner deleted after approval (approval first)', s10LastOwnerDeletionAfterApproval],
  ['S11a two owners deleted concurrently, A first', (c) => s11TwoOwnersDeletedAOrderFirst(c, 'A-first')],
  ['S11b two owners deleted concurrently, X first', (c) => s11TwoOwnersDeletedAOrderFirst(c, 'X-first')],
  ['S12a two companies verify one domain, C1 first', (c) => s12DomainRace(c, 'C1-first')],
  ['S12b two companies verify one domain, C2 first', (c) => s12DomainRace(c, 'C2-first')],
  ['S13 quota at 14 with three concurrent publishers', s13QuotaThreePublishers],
  ['S16 owner re-activates an operator-closed post', s16OwnerReactivatesOperatorClosedPost],
];

async function fixtureDb(tag) {
  const db = dbName(tag);
  spawnSync('dropdb', ['--if-exists', db]);
  assert.equal(spawnSync('createdb', ['-T', TPL, db]).status, 0, `createdb ${db}`);
  const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', 'tests/sql/employer-concurrency-fixtures.sql'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `fixtures: ${r.stderr}`);
  return db;
}

test('employer concurrency review: deterministic interleavings', { skip: !enabled && 'set FJ_PG_DISPOSABLE=1 with a disposable PostgreSQL 16' }, async (t) => {
  spawnSync('dropdb', ['--if-exists', TPL]);
  assert.equal(spawnSync('createdb', [TPL]).status, 0, 'createdb template');
  t.after(() => spawnSync('dropdb', ['--if-exists', TPL]));
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
  const summary = results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      expected: ${r.expected}\n      observed: ${r.observed}`).join('\n');
  console.log(`\n${FIX ? 'with 20261019 fix' : 'baseline (no 20261019 fix)'}\n${summary}`);
  if (process.env.FJ_CONC_RESULTS) writeFileSync(process.env.FJ_CONC_RESULTS, JSON.stringify({ fix: FIX, results }, null, 2));
  const failed = results.filter((r) => !r.pass).map((r) => r.name);
  assert.deepEqual(failed, [], `failed scenarios: ${failed.join('; ')}`);
});
