-- Franklin, Nov 6: the launch audience is IT people, so fill the 18 IT roles first.
-- The 8 non-IT roles are picked only when no IT cell is due. DC stays skipped until
-- job-ingest is redeployed with the DC fix (then apply 20261106b, adding this role ordering).
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'fortune-us-coverage-50-all-roles'),
  command := $job$
  with due as (
    select c.state, c.role_id
    from public.ingest_coverage c
    left join public.ingest_cells r
      on r.state_code = c.state and r.canonical_role = c.role_id and r.source = 'adzuna'
    where c.fresh_distinct < 50
      and c.state <> 'DC'  -- Adzuna rejects location1='District of Columbia' (HTTP 400); see docs/us-coverage-50-2026-11-06.md
      and coalesce(r.next_due_at, '-infinity'::timestamptz) <= now()
    -- IT roles first; non-IT roles only when no IT cell is due.
    order by (c.role_id in ('customer-service-representative','human-resources-manager','marketing-manager','product-manager',
                            'project-manager','registered-nurse','sales-representative','accountant')),
             r.last_attempt_at nulls first, c.fresh_distinct desc, c.role_id, c.state
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

-- Check: should return it_first = true, dc_skipped = true.
select jobname, position('registered-nurse' in command) > 0 as it_first, position('<> ''DC''' in command) > 0 as dc_skipped
from cron.job where jobname = 'fortune-us-coverage-50-all-roles';

-- Rollback: apply 20261106_coverage_50_all_roles.sql's job command again.
