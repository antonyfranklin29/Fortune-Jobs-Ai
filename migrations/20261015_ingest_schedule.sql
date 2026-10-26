-- Applied manually in production on 2026-10-25 after Adzuna API Access
-- activation, Vault credential setup by the owner, and a successful manual
-- feed test. Cron job 2 was verified active; a free pg_net dry run returned
-- HTTP 200. The first scheduled feed execution still needs verification.
--
-- Requires the paid Adzuna "API access" plan (500/day, 5,000/month); the free
-- Pending Activation plan has only 25 calls in total.
--
-- Hourly nationwide IT feed, 3 requests per run = 72/day, at most 2,232
-- in a 31-day month. This fits the worker's conservative 2,500/month default
-- and leaves at least 268 calls for targeted top-ups. Each request returns
-- up to 50 U.S. IT listings, classified into the 18 IT roles × 51 regions.
-- The paid API Access plan permits 5,000/month. The worker intentionally
-- retains its lower default 2,500/month cap.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'job-ingest-us-it-feed-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url     := 'https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/job-ingest',
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret')),
    body    := jsonb_build_object('mode', 'feed', 'feed', 'adzuna-us-it', 'budget', 3),
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
