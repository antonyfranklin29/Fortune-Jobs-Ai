// Make completion-signal contract (tests/sql/live-search-completion-signals.sql) on a
// DISPOSABLE local PostgreSQL, never a Supabase project. job_matches is created outside the
// repository in production, so this recreates its production columns (checked read-only on
// 2026-10-24) and service_role-only write grants, then applies the Live Search migrations.
//
//   FJ_PG_DISPOSABLE=1 PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres node --test tests/live-search-signals-db.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const enabled = process.env.FJ_PG_DISPOSABLE === '1' && spawnSync('psql', ['--version']).status === 0;
const db = `fj_live_signals_${process.pid}`;
const TABLE = `
create table public.job_matches (id bigserial primary key, created_at timestamptz default now(), job_title text,
  company text, location text, salary text, apply_url text, match_reason text, match_score integer,
  search_id text, source_metadata jsonb);
revoke all on public.job_matches from anon, authenticated;
grant select, insert, update on public.job_matches to service_role;
grant usage on sequence public.job_matches_id_seq to service_role;`;
const CHAIN = [
  'migrations/20261013_live_search_gateway.sql',
  'migrations/20261013_live_search_admission_function.sql',
  'migrations/20261013_live_search_completion_trigger.sql',
  'migrations/20261013_live_search_trusted_completion_marker.sql',
  'migrations/20261013_live_search_function_execute_lockdown.sql',
  'migrations/20261013_live_search_explicit_outcome_signals.sql',
];
const psql = (args) => spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args], { cwd: root, encoding: 'utf8' });

test('Make completion signals: object vs string, failure, and the pending normalizer', { skip: !enabled && 'set FJ_PG_DISPOSABLE=1 with a disposable PostgreSQL' }, (t) => {
  spawnSync('dropdb', ['--if-exists', db]);
  assert.equal(spawnSync('createdb', [db]).status, 0, 'createdb');
  t.after(() => spawnSync('dropdb', ['--if-exists', db]));
  for (const step of [['-q', '-f', 'tests/sql/supabase-shim.sql'], ['-q', '-c', TABLE], ...CHAIN.map((f) => ['-q', '-f', f])]) {
    const r = psql(step);
    assert.equal(r.status, 0, `${step.join(' ')}: ${r.stderr}`);
  }
  const r = psql(['-f', 'tests/sql/live-search-completion-signals.sql']);
  assert.equal(r.status, 0, (r.stderr || '').split('\n').filter((l) => /ERROR|FAIL/.test(l)).join('\n'));
  assert.match(r.stdout, /PASS: live search completion signals/);
});
