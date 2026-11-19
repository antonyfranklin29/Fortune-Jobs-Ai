// Probe a fresh, disposable localhost cluster named catalogue-index-pg.
// node scripts/check-catalogue-indexes.mjs [port]
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const port = Number(process.argv[2] || 55438);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local test port');
const db = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
const root = new URL('../', import.meta.url);
async function statements(file) {
  const sql = await readFile(new URL(file, root), 'utf8');
  for (const statement of sql.split(';').filter(value => value.trim())) await db.query(statement);
}
const fields = 'id,job_title,company,location,state_code,canonical_role,country,posted_at,expires_at,closed_at,source,apply_url,salary,is_remote';
const queries = {
  employer_direct: `select ${fields},job_description,is_remote,work_mode from public.pre_scraped_jobs where country='us' and closed_at is null and source='employer_direct' order by id asc limit 1000`,
  catalogue_page: `select ${fields} from public.pre_scraped_jobs where country='us' and closed_at is null and source not in ('remotive','himalayas') and id>10000 order by id asc limit 1000`,
};
const plans = {};
try {
  await db.connect();
  const directory = (await db.query('show data_directory')).rows[0].data_directory;
  assert.match(directory.replaceAll('\\', '/'), /\/catalogue-index-pg$/i, 'Requires a dedicated disposable cluster');
  assert.equal((await db.query("select to_regclass('public.pre_scraped_jobs') as existing")).rows[0].existing, null, 'Requires a fresh cluster');
  for (const file of ['tests/sql/supabase-shim.sql', 'migrations/20261015_ingest_taxonomy.sql',
    'migrations/20261015_ingest_catalogue.sql', 'migrations/20261015_ingest_feed.sql',
    'migrations/pending/20261016_employer_submissions.sql', 'migrations/pending/20261017_employer_search_visibility.sql']) {
    await db.query(await readFile(new URL(file, root), 'utf8'));
  }
  await db.query(`insert into public.pre_scraped_jobs(category,job_title,company,location,apply_url,posted_at,country,source,closed_at,job_description)
    select 'Data Analyst','Data Analyst','Synthetic Company','Edison, NJ','https://example.test/jobs/'||g,now(),
      case when g%5=0 then 'ca' else 'us' end, case when g%3=0 then 'greenhouse' else 'adzuna' end,
      case when g%6=0 then now() else null end,repeat('Synthetic description. ',100)
    from generate_series(1,22000) g;
    analyze public.pre_scraped_jobs;`);
  for (const phase of ['before', 'after']) {
    if (phase === 'after') {
      await statements('migrations/20261118_catalogue_read_indexes.sql');
      await db.query('analyze public.pre_scraped_jobs');
    }
    await db.query('set role anon');
    try {
      plans[phase] = {};
      for (const [name, sql] of Object.entries(queries)) {
        const result = await db.query('explain (analyze, buffers) ' + sql);
        plans[phase][name] = result.rows.map(row => row['QUERY PLAN']).join('\n');
      }
    } finally { await db.query('reset role'); }
  }
  assert.match(plans.after.employer_direct, /Index Scan using pre_scraped_jobs_open_source_id_idx/);
  assert.match(plans.after.catalogue_page, /Index Scan using (?:pre_scraped_jobs_open_country_id_idx|pre_scraped_jobs_pkey)/);
  const valid = await db.query(`select indisvalid from pg_index where indexrelid in
    ('public.pre_scraped_jobs_open_source_id_idx'::regclass,'public.pre_scraped_jobs_open_country_id_idx'::regclass)`);
  assert.ok(valid.rows.length === 2 && valid.rows.every(row => row.indisvalid));
  await statements('migrations/rollback/20261118_catalogue_read_indexes.sql');
  const remaining = await db.query("select indexname from pg_indexes where indexname in ('pre_scraped_jobs_open_source_id_idx','pre_scraped_jobs_open_country_id_idx')");
  assert.equal(remaining.rows.length, 0);
  const sections = Object.entries(queries).map(([name, sql]) =>
    '## ' + name + '\n\n```sql\n' + sql + ';\n```\n\nBefore\n\n```text\n' + plans.before[name] +
    '\n```\n\nAfter\n\n```text\n' + plans.after[name] + '\n```').join('\n\n');
  const version = (await db.query('select version()')).rows[0].version;
  const report = '# Catalogue read index probe — 2026-11-18\n\n' + version +
    '\n\nDisposable localhost cluster, 22,000 synthetic rows, queried as anon with the repository Supabase shim and employer visibility RLS. No employer_direct rows. Local timings do not predict production latency. Default planner settings were used.\n\n' + sections +
    '\n\nThe employer query uses the new source index. For this fixture, the catalogue page prefers the existing primary-key index before and after; the planner was not forced. The country index was built and validated. Production plans depend on their data and statistics.\n\nBoth concurrent index builds were valid. The concurrent rollback removed both indexes.\n';
  await writeFile(new URL('docs/catalogue-read-index-explain-2026-11-18.md', root), report);
  console.log(report);
} finally { await db.end(); }
