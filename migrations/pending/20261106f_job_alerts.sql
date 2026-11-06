-- Job alert emails (Franklin, Nov 6): opt-in only, each person picks daily or weekly.
-- Builds on the weekly newsletter tables. Nothing is sent until the job-alerts function
-- has RESEND_API_KEY, NEWSLETTER_ENABLED=true and the schedule below is created.

alter table public.newsletter_preferences
  add column if not exists frequency text not null default 'weekly';
alter table public.newsletter_preferences drop constraint if exists newsletter_preferences_frequency_check;
alter table public.newsletter_preferences add constraint newsletter_preferences_frequency_check check (frequency in ('daily', 'weekly'));

-- Claim one delivery: respects each person's frequency, a site-wide daily ceiling
-- (Resend's free plan allows 100 emails a day) and never retries an unknown outcome.
create or replace function public.newsletter_claim(p_user uuid, p_campaign text)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid; v_freq text;
begin
  perform pg_advisory_xact_lock(61421014);
  if (select count(*) from newsletter_deliveries where reserved_at >= now() - interval '24 hours') >= 95 then return null; end if;
  select frequency into v_freq from newsletter_preferences where user_id = p_user and subscribed and next_send_at <= now();
  if v_freq is null then return null; end if;
  if exists (select 1 from newsletter_deliveries where user_id = p_user and state in ('reserved', 'unknown')) then return null; end if;
  insert into newsletter_deliveries (user_id, campaign) values (p_user, p_campaign) on conflict do nothing returning id into v_id;
  if v_id is not null then
    -- A few hours' slack so a daily run at the same time each day always finds the person due.
    update newsletter_preferences
      set next_send_at = now() + case when v_freq = 'daily' then interval '20 hours' else interval '6 days 20 hours' end
      where user_id = p_user;
  end if;
  return v_id;
end $$;
revoke all on function public.newsletter_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.newsletter_claim(uuid, text) to service_role;

-- Check: frequency column exists with the check constraint
select column_name, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'newsletter_preferences' and column_name = 'frequency';

-- Schedule (create only after Resend is set up and Franklin approves sending):
-- select cron.schedule('fortune-job-alerts-daily', '7 13 * * *', $job$  -- 8:07 AM Eastern (EST); 9:07 during EDT
--   select net.http_post(url := 'https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/job-alerts',
--     headers := jsonb_build_object('content-type','application/json','x-ingest-secret', s.decrypted_secret),
--     body := '{"send":true}'::jsonb, timeout_milliseconds := 300000)
--   from (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret' order by updated_at desc limit 1) s
--   where nullif(s.decrypted_secret, '') is not null; $job$);
-- Rollback: alter table public.newsletter_preferences drop column frequency; (and restore the old newsletter_claim from migrations)
