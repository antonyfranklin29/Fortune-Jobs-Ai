// Employer verification by work email (tests/sql/employer-apply-email.sql), run against a
// DISPOSABLE local PostgreSQL server, never a Supabase project.
//
//   FJ_PG_DISPOSABLE=1 PGHOST=/var/tmp/fjpg PGPORT=54329 PGUSER=postgres node --test tests/employer-work-email-db.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const enabled = process.env.FJ_PG_DISPOSABLE === '1' && spawnSync('psql', ['--version']).status === 0;
const db = `fj_employer_apply_email_${process.pid}`;

// pg_net and Vault stand-ins: emails are recorded instead of sent.
const SHIM = `
create schema if not exists net;
create table net.calls (id bigserial primary key, url text, body jsonb);
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language sql as $$ insert into net.calls (url, body) values (url, body) returning id $$;
create schema if not exists vault;
create view vault.decrypted_secrets as select 'ingest_secret'::text as name, 'test'::text as decrypted_secret;
`;

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
  'migrations/pending/20261024_employer_routine_post_approval.sql',
  'migrations/pending/20261025_employer_maintenance.sql',
  'migrations/pending/20261026_employer_email_domain_rule.sql',
  'migrations/pending/20261027_employer_reviewer_queue_details.sql',
  'migrations/pending/20261107b_account_emails.sql',
  'migrations/pending/20261108_employer_work_email_verify.sql',
  'migrations/pending/20261109b_employer_apply_by_email.sql',
];

const psql = (args) => spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args], { cwd: root, encoding: 'utf8' });

test('employer apply by email: domain rule, preview, live page, switching back', { skip: !enabled && 'set FJ_PG_DISPOSABLE=1 with a disposable PostgreSQL' }, (t) => {
  spawnSync('dropdb', ['--if-exists', db]);
  assert.equal(spawnSync('createdb', [db]).status, 0, 'createdb');
  t.after(() => spawnSync('dropdb', ['--if-exists', db]));
  const shim = join(mkdtempSync(join(tmpdir(), 'fj-')), 'shim.sql');
  writeFileSync(shim, SHIM);
  for (const f of [CHAIN[0], shim, ...CHAIN.slice(1)]) {
    const r = psql(['-q', '-f', f]);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
  const r = psql(['-f', 'tests/sql/employer-apply-email.sql']);
  assert.equal(r.status, 0, (r.stderr || '').split('\n').filter((l) => /ERROR|FAIL/.test(l)).join('\n'));
  assert.match(r.stdout, /PASS: employer apply by email/);
});
