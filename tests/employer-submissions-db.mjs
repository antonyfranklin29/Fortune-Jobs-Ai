// Database tests for the PENDING employer migration, against a DISPOSABLE local
// PostgreSQL 16 server (never a Supabase project). Creates a throwaway database,
// applies a Supabase role/auth shim, the applied ingest migrations and the
// pending employer migration, then runs:
//   1. tests/sql/employer-submissions.sql — permissions, workflow, quota (rolled back)
//   2. a real two-connection race: two simultaneous publications at 14 active
//
// Requires psql/createdb/dropdb on PATH and FJ_PG_DISPOSABLE=1 plus the usual
// PGHOST/PGPORT/PGUSER for the disposable server. Skips otherwise.
//   FJ_PG_DISPOSABLE=1 PGHOST=/var/tmp/fjpg PGPORT=54329 PGUSER=postgres node --test tests/employer-submissions-db.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const enabled = process.env.FJ_PG_DISPOSABLE === '1' && spawnSync('psql', ['--version']).status === 0;
const db = `fj_employer_test_${process.pid}`;
const FILES = ['tests/sql/supabase-shim.sql', 'migrations/20261015_ingest_taxonomy.sql',
  'migrations/20261015_ingest_catalogue.sql', 'migrations/20261015_ingest_feed.sql',
  'migrations/pending/20261016_employer_feed_runs.sql',
  'migrations/pending/20261016_employer_submissions.sql',
  'migrations/pending/20261017_employer_feed_registry_bridge.sql',
  'migrations/pending/20261017_employer_feed_publish_hardening.sql',
  'migrations/pending/20261017_employer_domain_checks.sql',
  'migrations/pending/20261017_employer_account_deletion.sql',
  'migrations/pending/20261017_employer_search_visibility.sql',
  'migrations/pending/20261018_employer_access_hardening.sql',
    'migrations/pending/20261019_employer_pending_account_cleanup.sql',
    'migrations/pending/20261019_employer_concurrency_hardening.sql',
    'migrations/pending/20261020_employer_post_actions.sql',
    'migrations/pending/20261021_employer_feed_concurrency_hardening.sql',
    'migrations/pending/20261022_employer_paused_post_state.sql','migrations/pending/20261023_employer_refresh_workflow.sql'];

const psql = (args, input) => spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args],
  { cwd: root, input, encoding: 'utf8' });
const psqlAsync = (sql) => new Promise((resolve) => {
  const p = spawn('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db], { cwd: root });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  p.stdin.end(sql);
});

test('employer migration: permissions, workflow and quota', { skip: !enabled && 'set FJ_PG_DISPOSABLE=1 with a disposable PostgreSQL 16' }, async (t) => {
  spawnSync('dropdb', ['--if-exists', db]);
  assert.equal(spawnSync('createdb', [db]).status, 0, 'createdb');
  t.after(() => spawnSync('dropdb', ['--if-exists', db]));
  for (const f of FILES) {
    const r = psql(['-q', '-f', f]);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }

  await t.test('scripted scenarios (rolled back)', () => {
    const r = psql(['-f', 'tests/sql/employer-submissions.sql']);
    assert.equal(r.status, 0, r.stderr.split('\n').filter((l) => /ERROR|FAIL/.test(l)).join('\n'));
    assert.match(r.stdout, /PASS: employer submissions/);
  });

  await t.test('two simultaneous publications at 14 active cannot overshoot 15', async () => {
    // Committed fixture: a verified org with 14 live posts and two approved, unpublished ones.
    const setup = psql(['-q', '-At'], `
      insert into auth.users (id, email, email_confirmed_at) values
        ('11111111-1111-1111-1111-111111111111', 'race@race-org.com', now()),
        ('22222222-2222-2222-2222-222222222222', 'ops@fortunejobsai.com', now());
      insert into public.employer_operators values ('22222222-2222-2222-2222-222222222222');
      select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
      create table public.race_ids as select (public.employer_register_org('Race Org', 'race-org.com')->>'org_id')::uuid as org;
      select public.employer_mark_domain_verified(org, (select token from public.employer_domain_challenges c where c.org_id = org)) from public.race_ids;
      select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
      select public.operator_set_org_status(org, 'verified', 'race') from public.race_ids;
      create table public.race_posts (n int, id uuid);
      do $$ declare i int; pid uuid; begin
        for i in 1..16 loop
          perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
          pid := (public.employer_save_post((select org from public.race_ids), null, jsonb_build_object(
            'job_title', 'Data Analyst ' || i, 'canonical_role', 'data-analyst', 'state_code', 'NJ', 'city', 'Edison',
            'description', repeat('Build dashboards and reports for operations. ', 3),
            'apply_url', 'https://jobs.race-org.com/' || i, 'posting_date', current_date::text,
            'closing_date', (current_date + 30)::text))->>'id')::uuid;
          perform public.employer_submit_post(pid);
          insert into public.race_posts values (i, pid);
          perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
          if i <= 14 then perform public.operator_review_post(pid, 1, 'approve', null);
          else update public.employer_posts set reviewed_revision = revision, status = 'approved' where id = pid; end if;
        end loop;
      end $$;
      grant select on public.race_posts, public.race_ids to authenticated;
      select public.employer_active_count(org) from public.race_ids;`);
    assert.equal(setup.status, 0, setup.stderr);
    assert.match(setup.stdout, /^14$/m);

    // Each session holds its transaction open briefly after publishing, so the
    // two genuinely overlap; the org row lock must serialise them.
    const session = (n) => psqlAsync(`
      begin;
      set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
      set local role authenticated;
      select public.employer_activate_post((select id from public.race_posts where n = ${n}))->>'state';
      select pg_sleep(1.5);
      commit;`);
    const [a, b] = await Promise.all([session(15), session(16)]);
    assert.equal(a.code, 0, a.err); assert.equal(b.code, 0, b.err);
    const states = [a.out.split('\n')[0], b.out.split('\n')[0]].sort();
    assert.deepEqual(states, ['', 'upgrade_required'], `one publishes, one is blocked: ${JSON.stringify(states)}`);
    const count = psql(['-At', '-c', 'select public.employer_active_count(org) from public.race_ids']);
    assert.equal(count.stdout.trim(), '15');
  });
});
