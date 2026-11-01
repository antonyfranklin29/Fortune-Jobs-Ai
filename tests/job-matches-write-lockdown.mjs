import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.job_matches(id bigint generated always as identity primary key, search_id text);
    grant select, insert, update, delete on public.job_matches to public, anon, authenticated;
    grant select, insert on public.job_matches to service_role;
    alter table public.job_matches enable row level security;
    create policy "pipeline can insert job matches" on public.job_matches
      for insert to anon, authenticated with check (true);`);
  await db.exec(readFileSync('migrations/pending/20261031_job_matches_write_lockdown.sql', 'utf8'));
  const { rows } = await db.query(`select role, privilege,
    has_table_privilege(role, 'public.job_matches', privilege) as allowed
    from (values ('anon','SELECT'),('anon','INSERT'),('authenticated','UPDATE'),
      ('authenticated','DELETE'),('service_role','INSERT')) as checks(role,privilege)`);
  assert.deepEqual(rows, [
    { role: 'anon', privilege: 'SELECT', allowed: true },
    { role: 'anon', privilege: 'INSERT', allowed: false },
    { role: 'authenticated', privilege: 'UPDATE', allowed: false },
    { role: 'authenticated', privilege: 'DELETE', allowed: false },
    { role: 'service_role', privilege: 'INSERT', allowed: true },
  ]);
  const policies = await db.query(`select policyname from pg_policies
    where schemaname='public' and tablename='job_matches' and cmd='INSERT'`);
  assert.deepEqual(policies.rows, [], 'the permissive insert policy is removed');
  console.log('job_matches: public reads retained, public writes denied, pipeline writes retained');
} finally {
  await db.close();
}
