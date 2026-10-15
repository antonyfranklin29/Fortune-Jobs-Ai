-- Newsletter preparation only. Apply before deploying email-preferences.
begin;
create table if not exists public.newsletter_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 subscribed boolean not null default false,
 consent_version text not null default 'weekly-v1',
 consent_at timestamptz,
 unsubscribed_at timestamptz,
 updated_at timestamptz not null default now(),
 next_send_at timestamptz not null default now() + interval '7 days'
);
create table if not exists public.newsletter_deliveries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 campaign text not null,
 state text not null default 'reserved' check(state in ('reserved','accepted','suppressed','unknown')),
 reserved_at timestamptz not null default now(),
 provider_id text,
 unique(user_id,campaign)
);
alter table public.newsletter_preferences enable row level security;
alter table public.newsletter_deliveries enable row level security;
revoke all on public.newsletter_preferences, public.newsletter_deliveries from public,anon,authenticated;
grant select on public.newsletter_preferences to authenticated;
grant all on public.newsletter_preferences,public.newsletter_deliveries to service_role;
create policy newsletter_owner_read on public.newsletter_preferences for select to authenticated using(auth.uid()=user_id);
-- No direct client writes: consent timestamps and cadence are server controlled.
create or replace function public.newsletter_claim(p_user uuid,p_campaign text)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id uuid;
begin
 perform pg_advisory_xact_lock(61421014);
 -- Hard daily ceiling includes unknown outcomes, and concurrent worker invocations.
 if (select count(*) from newsletter_deliveries where reserved_at >= now()-interval '24 hours') >= 80 then return null; end if;
 if not exists(select 1 from newsletter_preferences where user_id=p_user and subscribed and next_send_at<=now()) then return null; end if;
 -- Never auto-retry a timed out/unknown delivery: it may already have reached provider.
 if exists(select 1 from newsletter_deliveries where user_id=p_user and state in ('reserved','unknown')) then return null; end if;
 insert into newsletter_deliveries(user_id,campaign) values(p_user,p_campaign) on conflict do nothing returning id into v_id;
 if v_id is not null then update newsletter_preferences set next_send_at=now()+interval '7 days' where user_id=p_user; end if;
 return v_id;
end $$;
revoke all on function public.newsletter_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.newsletter_claim(uuid,text) to service_role;
commit;
