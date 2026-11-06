-- Run AFTER job-ingest is redeployed with the DC fix (adzunaLocation: DC is searched
-- with where=Washington, DC). Re-adds DC to the coverage job as the LAST priority:
-- DC cells are picked only when no other due cell remains.
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'fortune-us-coverage-50-all-roles'),
  command := $job$
  with due as (
    select c.state, c.role_id
    from public.ingest_coverage c
    left join public.ingest_cells r
      on r.state_code = c.state and r.canonical_role = c.role_id and r.source = 'adzuna'
    where c.fresh_distinct < 50
      and coalesce(r.next_due_at, '-infinity'::timestamptz) <= now()
    order by (c.state = 'DC'), r.last_attempt_at nulls first, c.fresh_distinct desc, c.role_id, c.state
    limit 1
  )
  select net.http_post(
    url := 'https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/job-ingest',
    headers := jsonb_build_object('content-type', 'application/json', 'x-ingest-secret', s.decrypted_secret),
    body := jsonb_build_object('mode', 'cells', 'regions', jsonb_build_array(d.state), 'roles', jsonb_build_array(d.role_id), 'budget', 1),
    timeout_milliseconds := 300000)
  from due d
  cross join lateral (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret' order by updated_at desc limit 1) s
  where nullif(s.decrypted_secret, '') is not null;
$job$);

-- Check: the job command now orders by (c.state = 'DC') and has no DC exclusion.
select jobname, position('(c.state = ''DC'')' in command) > 0 as dc_last, position('<> ''DC''' in command) > 0 as dc_skipped
from cron.job where jobname = 'fortune-us-coverage-50-all-roles';

-- Rollback: apply migrations/pending/20261106_coverage_50_all_roles.sql's job command again (skips DC).
