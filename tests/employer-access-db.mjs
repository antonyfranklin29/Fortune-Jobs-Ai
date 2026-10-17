// Access-control review of the employer backend (docs/claude-employer-access-review.md),
// run against a DISPOSABLE local PostgreSQL 16 server (never a Supabase project).
// Creates a throwaway database, applies the Supabase role/auth shim, the applied ingest
// migrations and EVERY pending employer migration in dependency order, then runs
// tests/sql/employer-access.sql as the real anon / authenticated / service_role roles.
//
//   FJ_PG_DISPOSABLE=1 PGHOST=/var/tmp/fjpg PGPORT=54329 PGUSER=postgres node --test tests/employer-access-db.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const enabled = process.env.FJ_PG_DISPOSABLE === '1' && spawnSync('psql', ['--version']).status === 0;
const db = `fj_employer_access_${process.pid}`;

// Dependency order: the employer submissions migration first, then the feed-run tables
// (the registry bridge uses them), then the Codex hardening and the access hardening.
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
    'migrations/pending/20261022_employer_paused_post_state.sql', 'migrations/pending/20261023_employer_lease_selection_url_hardening.sql',
];

const psql = (args) => spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args], { cwd: root, encoding: 'utf8' });

test('employer access review: anon, job seekers, members, reviewers and quota', { skip: !enabled && 'set FJ_PG_DISPOSABLE=1 with a disposable PostgreSQL 16' }, (t) => {
  spawnSync('dropdb', ['--if-exists', db]);
  assert.equal(spawnSync('createdb', [db]).status, 0, 'createdb');
  t.after(() => spawnSync('dropdb', ['--if-exists', db]));
  for (const f of CHAIN) {
    const r = psql(['-q', '-f', f]);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
  const r = psql(['-f', 'tests/sql/employer-access.sql']);
  assert.equal(r.status, 0, (r.stderr || '').split('\n').filter((l) => /ERROR|FAIL/.test(l)).join('\n'));
  assert.match(r.stdout, /PASS: employer access review/);
});
