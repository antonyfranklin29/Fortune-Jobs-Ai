-- Live Search admission decision and slot release.
--
-- The whole decision runs inside one advisory lock so two concurrent requests
-- can never both claim the last concurrency slot. Mirrors what is applied to
-- production.

create or replace function public.live_search_try_admit(
  p_search_id   text,
  p_client_hash text,
  p_account     uuid,
  p_query       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg           public.live_search_limits%rowtype;
  n_inflight    integer;
  n_client_min  integer;
  n_client_hour integer;
  n_client_day  integer;
  n_global_hour integer;
  n_global_day  integer;
  v_expires     timestamptz;
begin
  select * into cfg from public.live_search_limits where id;
  if not found then
    return jsonb_build_object('admitted', false, 'reason', 'no_config', 'retry_after', 60);
  end if;

  if cfg.paused then
    return jsonb_build_object('admitted', false, 'reason', 'paused', 'retry_after', 300);
  end if;

  -- One admission decision at a time.
  perform pg_advisory_xact_lock(hashtext('fj_live_search_admission'));

  -- Release slots whose searches never reported back.
  update public.live_search_admissions
     set status = 'expired', settled_at = now()
   where status in ('in_flight', 'dispatched')
     and slot_expires_at < now();

  select count(*) into n_inflight
    from public.live_search_admissions
   where status in ('in_flight', 'dispatched')
     and slot_expires_at >= now();

  select
    count(*) filter (where admitted_at > now() - interval '1 minute'),
    count(*) filter (where admitted_at > now() - interval '1 hour'),
    count(*) filter (where admitted_at > now() - interval '1 day')
    into n_client_min, n_client_hour, n_client_day
    from public.live_search_admissions
   where client_hash = p_client_hash;

  select
    count(*) filter (where admitted_at > now() - interval '1 hour'),
    count(*) filter (where admitted_at > now() - interval '1 day')
    into n_global_hour, n_global_day
    from public.live_search_admissions;

  -- Per-caller limits.
  if n_client_min >= cfg.per_client_per_minute then
    return jsonb_build_object('admitted', false, 'reason', 'rate_limited_minute', 'retry_after', 60);
  end if;
  if n_client_hour >= cfg.per_client_per_hour then
    return jsonb_build_object('admitted', false, 'reason', 'rate_limited_hour', 'retry_after', 900);
  end if;
  if n_client_day >= cfg.per_client_per_day then
    return jsonb_build_object('admitted', false, 'reason', 'rate_limited_day', 'retry_after', 3600);
  end if;

  -- Global cost bounds. These protect the paid scraping budget.
  if n_global_hour >= cfg.global_per_hour then
    return jsonb_build_object('admitted', false, 'reason', 'budget_hour', 'retry_after', 600);
  end if;
  if n_global_day >= cfg.global_per_day then
    return jsonb_build_object('admitted', false, 'reason', 'budget_day', 'retry_after', 3600);
  end if;

  -- Concurrency. Caller may wait and retry within its queue budget.
  if n_inflight >= cfg.max_concurrent then
    return jsonb_build_object('admitted', false, 'reason', 'at_capacity',
                              'in_flight', n_inflight, 'retry_after', 15);
  end if;

  v_expires := now() + make_interval(secs => cfg.slot_seconds);

  insert into public.live_search_admissions
    (search_id, client_hash, account_id, query_text, status, slot_expires_at)
  values (p_search_id, p_client_hash, p_account, left(p_query, 200), 'in_flight', v_expires);

  return jsonb_build_object('admitted', true, 'search_id', p_search_id,
                            'slot_expires_at', v_expires, 'in_flight', n_inflight + 1);
end;
$$;

-- Only a conclusive outcome settles an admission. An unconfirmed dispatch stays
-- in 'dispatched' and keeps holding its slot.
create or replace function public.live_search_settle(
  p_search_id text,
  p_status    text,
  p_outcome   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.live_search_admissions
     set status = case when p_status in ('completed','failed','expired') then p_status else 'completed' end,
         settled_at = now(),
         outcome = left(coalesce(p_outcome, ''), 300)
   where search_id = p_search_id
     and status in ('in_flight','dispatched');
end;
$$;
