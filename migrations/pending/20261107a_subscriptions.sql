-- Fortune Jobs AI Pro subscriptions, kept in step with Stripe by the billing-webhook function.
-- Only the service role writes. A person can read their own row (to show "Pro" and "Manage").
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'none',          -- Stripe status: active, trialing, past_due, canceled, ...
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  livemode boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from public, anon, authenticated;
grant select on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;
drop policy if exists subscriptions_own_read on public.subscriptions;
create policy subscriptions_own_read on public.subscriptions for select to authenticated using (user_id = auth.uid());

-- Pro while Stripe says the subscription is active (or trialing) and the paid period has not ended.
create or replace function public.is_pro(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.subscriptions s where s.user_id = p_user
    and s.status in ('active', 'trialing') and (s.current_period_end is null or s.current_period_end > now()));
$$;
revoke all on function public.is_pro(uuid) from public, anon, authenticated;
grant execute on function public.is_pro(uuid) to service_role;

-- Stripe sends each event at least once and possibly out of order: remember processed event ids.
create table if not exists public.stripe_events (id text primary key, type text not null, received_at timestamptz not null default now());
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from public, anon, authenticated;
grant all on public.stripe_events to service_role;
