-- U.S. coverage: aim for 50 fresh jobs for every role in every state (and DC).
-- Run in the Supabase SQL editor (production). Rollback is at the bottom.
--
-- Why: the 24-hour boost 'fortune-us-coverage-51-next-pass' covered 18 of the 26 roles
-- and ran ~216 Adzuna requests a day. Adzuna's standard allowance is 1,000 a week and
-- 2,500 a month, so the worker would block itself within about two days. The hourly
-- IT feed alone (72 a day) used most of the monthly allowance for ~8 new jobs a request,
-- while a targeted role x state request adds ~25-40.
--
-- New split (about 76 requests a day, ~2,300 per 30 days, ~530 a week):
--   * every 20 minutes: one role x state below 50 jobs, never-tried cells first (72/day)
--   * IT feed every 6 hours instead of hourly, budget 1 (4/day)

select cron.unschedule('fortune-us-coverage-51-next-pass')
where exists (select 1 from cron.job where jobname = 'fortune-us-coverage-51-next-pass');

select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'job-ingest-us-it-feed-hourly'),
  schedule := '7 */6 * * *',
  command := $cmd$ select net.http_post(url := 'https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/job-ingest', headers := jsonb_build_object('content-type','application/json','x-ingest-secret',(select decrypted_secret from vault.decrypted_secrets where name='ingest_secret')), body := jsonb_build_object('mode','feed','feed','adzuna-us-it','budget',1), timeout_milliseconds := 300000); $cmd$);

select cron.schedule('fortune-us-coverage-50-all-roles', '*/20 * * * *', $job$
  with due as (
    select c.state, c.role_id
    from public.ingest_coverage c
    left join public.ingest_cells r
      on r.state_code = c.state and r.canonical_role = c.role_id and r.source = 'adzuna'
    where c.fresh_distinct < 50
      and coalesce(r.next_due_at, '-infinity'::timestamptz) <= now()
    order by r.last_attempt_at nulls first, c.fresh_distinct desc, c.role_id, c.state
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

-- Check:
select jobname, schedule, active from cron.job order by jobname;

-- Rollback (restores the hourly feed and removes the new job):
-- select cron.unschedule('fortune-us-coverage-50-all-roles');
-- select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'job-ingest-us-it-feed-hourly'), schedule := '7 * * * *',
--   command := $cmd$ select net.http_post(url := 'https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/job-ingest', headers := jsonb_build_object('content-type','application/json','x-ingest-secret',(select decrypted_secret from vault.decrypted_secrets where name='ingest_secret')), body := jsonb_build_object('mode','feed','feed','adzuna-us-it','budget',3), timeout_milliseconds := 300000); $cmd$);
