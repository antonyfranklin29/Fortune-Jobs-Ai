-- Live Search: tighten what counts as a completion, and stop a late dispatch
-- timeout from resurrecting a settled admission.
--
-- Before this change ANY job_matches insert released the concurrency slot, so
-- the first partial result freed capacity while the scraper was still running.
-- Now only the pipeline's final completion marker does. The explicit backend
-- completion signal remains live_search_settle(), which only service_role may
-- execute.

create or replace function public.live_search_mark_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if new.search_id is null then
    return new;
  end if;

  -- The trusted final marker, exactly as the pipeline emits it.
  if not (new.job_title    = 'No matching jobs found'
      and new.match_reason  = 'Search complete'
      and coalesce(new.match_score, -1) = 0) then
    return new;   -- partial result: slot stays held
  end if;

  -- Recorded so the inserting role is visible in the audit trail. job_matches
  -- still accepts inserts from anon, so this marker is corroborating evidence
  -- rather than an authenticated signal on its own.
  begin
    v_role := coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(((current_setting('request.jwt.claims', true))::jsonb ->> 'role'), ''),
      'unknown');
  exception when others then
    v_role := 'unknown';
  end;

  update public.live_search_admissions
     set status     = 'completed',
         settled_at = now(),
         outcome    = left(coalesce(outcome || ' -> ', '') || 'results_received:' || v_role, 300)
   where search_id = new.search_id
     and status in ('in_flight', 'dispatched');

  return new;
end;
$$;

-- Marking a dispatch unconfirmed must never resurrect a settled admission. The
-- status guard lives in the database so the condition cannot be lost in a URL
-- filter, and the caller is told whether it applied.
create or replace function public.live_search_mark_unconfirmed(p_search_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows   integer;
  v_status text;
begin
  update public.live_search_admissions
     set status  = 'dispatched',
         outcome = left(coalesce(outcome || ' -> ', '') || 'dispatch_unconfirmed', 300)
   where search_id = p_search_id
     and status in ('in_flight', 'dispatched');
  get diagnostics v_rows = row_count;

  select status into v_status from public.live_search_admissions where search_id = p_search_id;

  return jsonb_build_object('applied', v_rows > 0, 'status', v_status);
end;
$$;

-- NOTE: revoking from anon and authenticated alone is NOT enough. Postgres
-- grants EXECUTE to PUBLIC on every new function, and anon inherits it, so both
-- functions stayed callable by anon until PUBLIC was revoked. See
-- 20261013_live_search_function_execute_lockdown.sql, which is the authoritative
-- grant state for all four gateway functions.
revoke all on function public.live_search_mark_unconfirmed(text) from public, anon, authenticated;
grant execute on function public.live_search_mark_unconfirmed(text) to service_role;
revoke all on function public.live_search_mark_completed() from public, anon, authenticated;
grant execute on function public.live_search_mark_completed() to service_role;
