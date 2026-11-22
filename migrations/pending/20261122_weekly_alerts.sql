-- File only. Existing opt-in and frequency choices are retained.
alter table public.newsletter_preferences alter column frequency set default 'weekly';
alter table public.newsletter_deliveries add column if not exists job_keys text[] not null default '{}';
-- Update the existing claim function's next_send_at expression to the next Monday
-- through the function replacement below. The worker independently gates weekly sends.
create or replace function public.newsletter_claim(p_user uuid, p_campaign text)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid; v_freq text;
begin
  perform pg_advisory_xact_lock(61421014);
  if (select count(*) from newsletter_deliveries where reserved_at >= now() - interval '24 hours') >= 95 then return null; end if;
  select frequency into v_freq from newsletter_preferences where user_id = p_user and subscribed and next_send_at <= now();
  if v_freq is null then return null; end if;
  if v_freq='weekly' and extract(isodow from now() at time zone 'UTC')<>1 then return null; end if;
  if exists (select 1 from newsletter_deliveries where user_id = p_user and state in ('reserved', 'unknown')) then return null; end if;
  insert into newsletter_deliveries (user_id, campaign) values (p_user, p_campaign) on conflict do nothing returning id into v_id;
  if v_id is not null then
    -- A few hours' slack so a daily run at the same time each day always finds the person due.
    update newsletter_preferences
      set next_send_at = case when v_freq='daily' then now()+interval '20 hours'
        else (date_trunc('week',now() at time zone 'UTC') at time zone 'UTC')+interval '7 days 13 hours' end
      where user_id = p_user;
  end if;
  return v_id;
end $$;
revoke all on function public.newsletter_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.newsletter_claim(uuid, text) to service_role;

