-- Prepared only. Do not apply until the billing webhook, user-token validation,
-- and quota counter have been reviewed together. Stripe is not configured.
-- A browser-supplied user_id must never be passed as p_account.

alter table public.live_search_limits
  add column if not exists pro_billing_enabled boolean not null default false,
  add column if not exists pro_monthly_searches integer not null default 50
    check (pro_monthly_searches between 1 and 1000),
  add column if not exists free_monthly_searches integer not null default 3
    check (free_monthly_searches between 0 and 1000),
  add column if not exists global_per_30_days integer not null default 200
    check (global_per_30_days between 1 and 100000);

-- Preserve the plan used when each search was admitted. Existing searches
-- predate paid access, so they are free. A Pro search on the same network must
-- not consume a guest's or free member's allowance.
alter table public.live_search_admissions
  add column if not exists plan_at_admission text not null default 'free'
    check (plan_at_admission in ('free', 'seeker_pro'));

create table if not exists public.seeker_live_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_code text not null default 'seeker_pro' check (plan_code = 'seeker_pro'),
  status text not null check (status in ('active', 'past_due', 'cancelled', 'expired')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  provider_subscription_id text unique,
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end > period_start),
  check (status <> 'active' or provider_subscription_id is not null)
);
alter table public.seeker_live_entitlements enable row level security;
revoke all on public.seeker_live_entitlements from public, anon, authenticated;
grant all on public.seeker_live_entitlements to service_role;

-- The existing advisory lock covers the paid quota check and the admission
-- insert in one transaction. In-flight reservations count; failed or expired
-- searches do not consume a member's allowance.
create or replace function public.live_search_try_admit(
  p_search_id text, p_client_hash text, p_account uuid, p_query text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg public.live_search_limits%rowtype;
  ent public.seeker_live_entitlements%rowtype;
  n_inflight integer;
  n_client_min integer;
  n_client_hour integer;
  n_client_day integer;
  n_global_hour integer;
  n_global_day integer;
  n_global_month integer;
  n_plan_month integer;
  v_plan_limit integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_paid boolean := false;
  v_expires timestamptz;
begin
  select * into cfg from public.live_search_limits where id;
  if not found then
    return jsonb_build_object('admitted', false, 'reason', 'no_config', 'retry_after', 60);
  end if;
  if cfg.paused then
    return jsonb_build_object('admitted', false, 'reason', 'paused', 'retry_after', 300);
  end if;

  perform pg_advisory_xact_lock(hashtext('fj_live_search_admission'));

  update public.live_search_admissions
     set status = 'expired', settled_at = now()
   where status in ('in_flight', 'dispatched') and slot_expires_at < now();

  select count(*) into n_inflight from public.live_search_admissions
   where status in ('in_flight', 'dispatched') and slot_expires_at >= now();
  select count(*) filter (where admitted_at > now() - interval '1 minute'),
         count(*) filter (where admitted_at > now() - interval '1 hour'),
         count(*) filter (where admitted_at > now() - interval '1 day')
    into n_client_min, n_client_hour, n_client_day
    from public.live_search_admissions where client_hash = p_client_hash;
  select count(*) filter (where admitted_at > now() - interval '1 hour'),
         count(*) filter (where admitted_at > now() - interval '1 day'),
         count(*) filter (where admitted_at > now() - interval '30 days')
    into n_global_hour, n_global_day, n_global_month
    from public.live_search_admissions;

  if n_client_min >= cfg.per_client_per_minute then
    return jsonb_build_object('admitted', false, 'reason', 'rate_limited_minute', 'retry_after', 60);
  end if;
  if n_client_hour >= cfg.per_client_per_hour then
    return jsonb_build_object('admitted', false, 'reason', 'rate_limited_hour', 'retry_after', 900);
  end if;
  if n_client_day >= cfg.per_client_per_day then
    return jsonb_build_object('admitted', false, 'reason', 'rate_limited_day', 'retry_after', 3600);
  end if;
  if n_global_hour >= cfg.global_per_hour then
    return jsonb_build_object('admitted', false, 'reason', 'budget_hour', 'retry_after', 600);
  end if;
  if n_global_day >= cfg.global_per_day then
    return jsonb_build_object('admitted', false, 'reason', 'budget_day', 'retry_after', 3600);
  end if;
  if n_global_month >= cfg.global_per_30_days then
    return jsonb_build_object('admitted', false, 'reason', 'budget_month', 'retry_after', 3600);
  end if;

  if cfg.pro_billing_enabled then
    if p_account is not null then
      select * into ent from public.seeker_live_entitlements
       where user_id = p_account and plan_code = 'seeker_pro'
         and status = 'active' and period_start <= now() and period_end > now();
      v_paid := found;
    end if;
    v_plan_limit := case when v_paid then cfg.pro_monthly_searches else cfg.free_monthly_searches end;
    v_period_start := case when v_paid then ent.period_start else now() - interval '30 days' end;
    v_period_end := case when v_paid then ent.period_end else now() + interval '30 days' end;
    select count(*) into n_plan_month
      from public.live_search_admissions
     where admitted_at >= v_period_start and admitted_at < v_period_end
       and status not in ('failed', 'expired')
       and (case when v_paid then account_id = p_account and plan_at_admission = 'seeker_pro'
                 else plan_at_admission = 'free' and
                      (client_hash = p_client_hash or
                       (p_account is not null and account_id = p_account)) end);
    if n_plan_month >= v_plan_limit then
      return jsonb_build_object('admitted', false,
        'reason', case when v_paid then 'rate_limited_pro_month' else 'rate_limited_free_month' end,
        'retry_after', 3600, 'remaining', 0, 'limit', v_plan_limit);
    end if;
  end if;

  if n_inflight >= cfg.max_concurrent then
    return jsonb_build_object('admitted', false, 'reason', 'at_capacity',
                              'in_flight', n_inflight, 'retry_after', 15);
  end if;

  v_expires := now() + make_interval(secs => cfg.slot_seconds);
  insert into public.live_search_admissions
    (search_id, client_hash, account_id, query_text, status, slot_expires_at, plan_at_admission)
  values (p_search_id, p_client_hash, p_account, left(p_query, 200), 'in_flight', v_expires,
          case when v_paid then 'seeker_pro' else 'free' end);

  return jsonb_build_object('admitted', true, 'search_id', p_search_id,
    'slot_expires_at', v_expires, 'in_flight', n_inflight + 1,
    'remaining', case when cfg.pro_billing_enabled then v_plan_limit - n_plan_month - 1 else null end);
end;
$$;
revoke all on function public.live_search_try_admit(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.live_search_try_admit(text, text, uuid, text) to service_role;

-- Read-only balance for a verified member or a guest. The gateway supplies
-- p_account after validating a Supabase session token; browsers cannot call
-- this function directly or choose another user's ID.
create or replace function public.live_search_quota_status(p_account uuid, p_client_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg public.live_search_limits%rowtype;
  ent public.seeker_live_entitlements%rowtype;
  v_paid boolean := false;
  v_limit integer;
  v_used integer;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into cfg from public.live_search_limits where id;
  if not found or not cfg.pro_billing_enabled then
    return jsonb_build_object('enabled', false);
  end if;
  if p_account is not null then
    select * into ent from public.seeker_live_entitlements
     where user_id = p_account and plan_code = 'seeker_pro'
       and status = 'active' and period_start <= now() and period_end > now();
    v_paid := found;
  end if;
  v_limit := case when v_paid then cfg.pro_monthly_searches else cfg.free_monthly_searches end;
  v_start := case when v_paid then ent.period_start else now() - interval '30 days' end;
  v_end := case when v_paid then ent.period_end else now() + interval '30 days' end;
  select count(*) into v_used from public.live_search_admissions
   where admitted_at >= v_start and admitted_at < v_end
     and status not in ('failed', 'expired')
     and (case when v_paid then account_id = p_account and plan_at_admission = 'seeker_pro'
               else plan_at_admission = 'free' and
                    (client_hash = p_client_hash or
                     (p_account is not null and account_id = p_account)) end);
  return jsonb_build_object('enabled', true,
    'plan', case when v_paid then 'seeker_pro' else 'free' end,
    'limit', v_limit, 'used', v_used, 'remaining', greatest(0, v_limit-v_used),
    'period_end', case when v_paid then ent.period_end else null end);
end;
$$;
revoke all on function public.live_search_quota_status(uuid, text) from public, anon, authenticated;
grant execute on function public.live_search_quota_status(uuid, text) to service_role;
