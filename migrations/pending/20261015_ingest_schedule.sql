-- NOT APPLIED. Apply only after all three are true:
--   1. Adzuna API access is active and ADZUNA_APP_ID / ADZUNA_APP_KEY are set
--      as Edge Function secrets.
--   2. INGEST_SECRET is set as an Edge Function secret AND the same value is
--      stored in Vault:  select vault.create_secret('<value>', 'ingest_secret');
--      (Set by the owner. Never written into this file or the repository.)
--   3. job-ingest is deployed from the repository:
--        supabase functions deploy job-ingest --no-verify-jwt
--
-- Hourly, bounded to 10 requests per run, Data Analyst across all 51 regions.
-- The planner only spends what is due, so after the first ~16 hours (153
-- requests for the initial full sweep) steady state averages about 68 requests
-- a day: 51 one-page refreshes plus staggered three-page full sweeps every six
-- days. That is about 2,040 a month, inside Adzuna's free 2,500/month. Adding a
-- second role would exceed it; see docs/us-job-coverage-2026-10-15.md.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'job-ingest-data-analyst-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url     := 'https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/job-ingest',
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret')),
    body    := jsonb_build_object(
                 'roles',   jsonb_build_array('data-analyst'),
                 'regions', (select jsonb_agg(code) from public.ingest_regions),
                 'budget',  10),
    timeout_milliseconds := 300000);
  $$);

-- Health: alert when a cell has failed three times running, or no run has
-- succeeded for a day. Read by scripts/production-health.cjs.
create or replace view public.ingest_health with (security_invoker = true) as
select
  (select max(finished_at) from public.ingest_runs where status in ('succeeded','partial')) as last_good_run,
  (select count(*) from public.ingest_cells where consecutive_failures >= 3)                 as cells_failing,
  (select count(*) from public.ingest_runs where status = 'blocked' and started_at > now() - interval '1 day') as blocked_runs_24h,
  now() - (select max(finished_at) from public.ingest_runs where status in ('succeeded','partial')) > interval '1 day' as stale;
revoke all on public.ingest_health from public, anon, authenticated;
grant select on public.ingest_health to service_role;
