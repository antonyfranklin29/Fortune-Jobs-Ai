// End-to-end employer approval-flow rehearsal (tests/sql/employer-approval-flow.sql),
// run against a DISPOSABLE local PostgreSQL server, never a Supabase project. Applies the
// Supabase shim, the ingest migrations and the full employer chain, then walks one synthetic
// company from registration to suspension as the employer and an independent reviewer.
//
//   FJ_PG_DISPOSABLE=1 PGHOST=/var/tmp/fjpg PGPORT=54329 PGUSER=postgres node --test tests/employer-approval-flow-db.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const enabled = process.env.FJ_PG_DISPOSABLE === '1' && spawnSync('psql', ['--version']).status === 0;
const db = `fj_employer_approval_${process.pid}`;

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
  'migrations/pending/20261024_employer_url_conflicts.sql',
  'migrations/pending/20261025_employer_maintenance.sql',
  'migrations/pending/20261026_employer_email_domain_rule.sql',
];

const psql = (args) => spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args], { cwd: root, encoding: 'utf8' });

test('employer approval flow: registration, DNS proof, review feedback and suspension', { skip: !enabled && 'set FJ_PG_DISPOSABLE=1 with a disposable PostgreSQL' }, (t) => {
  spawnSync('dropdb', ['--if-exists', db]);
  assert.equal(spawnSync('createdb', [db]).status, 0, 'createdb');
  t.after(() => spawnSync('dropdb', ['--if-exists', db]));
  for (const f of CHAIN) {
    const r = psql(['-q', '-f', f]);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
  const r = psql(['-f', 'tests/sql/employer-approval-flow.sql']);
  assert.equal(r.status, 0, (r.stderr || '').split('\n').filter((l) => /ERROR|FAIL/.test(l)).join('\n'));
  assert.match(r.stdout, /PASS: employer approval flow rehearsal/);
  // The state the workspace receives after a reviewer rejects an edit to a live post.
  const line = r.stdout.split('\n')[r.stdout.split('\n').indexOf('REJECTED_LIVE_EDIT_STATE') + 1];
  const post = JSON.parse(line);
  assert.equal(post.status, 'published');
  assert.equal(post.has_unreviewed_changes, false);
  assert.equal(post.review_note, 'Title must match the role on your careers page');
});
