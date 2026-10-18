import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Adzuna planner coverage excludes other sources and stays backend-only', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema if not exists public;
      create table public.pre_scraped_jobs (
        source text, canonical_role text, state_code text, job_title text,
        company text, location text, posted_at timestamptz,
        last_seen_at timestamptz, closed_at timestamptz, ingest_feed text
      );
      grant usage on schema public to service_role;
      grant select on public.pre_scraped_jobs to service_role;`);
    const migration = await readFile(new URL('../migrations/20261018_ingest_source_coverage.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(`insert into public.pre_scraped_jobs
      (source, canonical_role, state_code, job_title, company, location, posted_at, last_seen_at)
      values
      ('adzuna','data-analyst','NC','Data Analyst','Acme','Raleigh',now(),now()),
      ('adzuna','data-analyst','NC','Data Analyst','Acme','Raleigh',now(),now()),
      ('indeed','data-analyst','NC','BI Analyst','Beta','Charlotte',now(),now()),
      ('adzuna','data-analyst','SC','Data Analyst','Gamma','Columbia',now(),now());`);
    const result = await db.query("select source, state, fresh_distinct from public.ingest_source_coverage order by source, state");
    assert.deepEqual(result.rows, [
      { source: 'adzuna', state: 'NC', fresh_distinct: 1 },
      { source: 'adzuna', state: 'SC', fresh_distinct: 1 },
      { source: 'indeed', state: 'NC', fresh_distinct: 1 },
    ]);
    const privileges = await db.query(`select
      has_table_privilege('anon','public.ingest_source_coverage','select') as anon,
      has_table_privilege('authenticated','public.ingest_source_coverage','select') as authenticated,
      has_table_privilege('service_role','public.ingest_source_coverage','select') as service_role`);
    assert.deepEqual(privileges.rows[0], { anon: false, authenticated: false, service_role: true });
  } finally { await db.close(); }
});
