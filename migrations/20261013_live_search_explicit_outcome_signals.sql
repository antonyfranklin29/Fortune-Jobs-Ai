-- Separate a genuinely empty search from a backend failure, and expose a
-- minimal public status for one search id.
--
-- Until now the pipeline wrote the same marker row whether the search found
-- nothing or the scraper failed, so a failure reached the visitor as "No
-- matching jobs found". Make carries an explicit signal in
-- job_matches.source_metadata:
--
--   {"signal":"success"}                   the search ran, however many results
--   {"signal":"failure","stage":"apify"}   the workflow or scraper failed
--
-- A marker arriving with no signal is NOT treated as proof of success. It still
-- releases the concurrency slot, because capacity must not leak while Make is
-- being updated, but it is recorded as unverified and reported as
-- indeterminate rather than empty.

create or replace function public.live_search_mark_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_signal text;
  v_stage  text;
  v_role   text;
  v_marker boolean;
begin
  if new.search_id is null then
    return new;
  end if;

  -- source_metadata is jsonb, but older rows hold a JSON-encoded *string*, where
  -- ->> yields null. That simply reads as "no signal", which is the safe default.
  begin
    v_signal := nullif(lower(coalesce(new.source_metadata ->> 'signal', '')), '');
    v_stage  := nullif(left(coalesce(new.source_metadata ->> 'stage', ''), 40), '');
  exception when others then
    v_signal := null; v_stage := null;
  end;

  begin
    v_role := coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(((current_setting('request.jwt.claims', true))::jsonb ->> 'role'), ''),
      'unknown');
  exception when others then
    v_role := 'unknown';
  end;

  -- An explicit failure is conclusive on any row: release the slot as failed.
  if v_signal = 'failure' then
    update public.live_search_admissions
       set status     = 'failed',
           settled_at = now(),
           outcome    = left(coalesce(outcome || ' -> ', '') ||
                             'failure:' || coalesce(v_stage, 'unspecified') || ':' || v_role, 300)
     where search_id = new.search_id
       and status in ('in_flight', 'dispatched');
    return new;
  end if;

  v_marker := (new.job_title = 'No matching jobs found'
           and new.match_reason = 'Search complete'
           and coalesce(new.match_score, -1) = 0);

  if v_signal = 'success' then
    update public.live_search_admissions
       set status     = 'completed',
           settled_at = now(),
           outcome    = left(coalesce(outcome || ' -> ', '') || 'success:' || v_role, 300)
     where search_id = new.search_id
       and status in ('in_flight', 'dispatched');
    return new;
  end if;

  if v_marker then
    update public.live_search_admissions
       set status     = 'completed',
           settled_at = now(),
           outcome    = left(coalesce(outcome || ' -> ', '') || 'marker_unverified:' || v_role, 300)
     where search_id = new.search_id
       and status in ('in_flight', 'dispatched');
    return new;
  end if;

  -- A partial job row means the scraper is still working. Slot stays held.
  return new;
end;
$$;

-- Minimal public status for one unguessable search id. Returns the state and a
-- result count only: never the query, caller hash, account id or any secret.
create or replace function public.live_search_status(p_search_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status  text;
  v_outcome text;
  v_expires timestamptz;
  v_found   boolean := false;
  v_results integer := 0;
  v_state   text;
begin
  if p_search_id is null or length(p_search_id) < 8 or length(p_search_id) > 80 then
    return jsonb_build_object('state', 'not_found', 'results', 0);
  end if;

  select status, outcome, slot_expires_at
    into v_status, v_outcome, v_expires
    from public.live_search_admissions
   where search_id = p_search_id;
  v_found := found;

  -- Real results only: the completion marker is not a job.
  select count(*) into v_results
    from public.job_matches
   where search_id = p_search_id
     and not (job_title = 'No matching jobs found'
          and match_reason = 'Search complete'
          and coalesce(match_score, -1) = 0);

  if not v_found then
    v_state := case when v_results > 0 then 'complete' else 'unknown' end;
  elsif v_status in ('in_flight', 'dispatched') and v_expires >= now() then
    v_state := 'pending';
  elsif v_status in ('failed', 'expired') then
    v_state := 'failed';
  elsif v_status = 'completed' then
    if v_results > 0 then
      v_state := 'complete';
    elsif v_outcome like '%success%' then
      v_state := 'empty';
    else
      v_state := 'indeterminate';
    end if;
  else
    v_state := 'unknown';
  end if;

  return jsonb_build_object('state', v_state, 'results', v_results);
end;
$$;

revoke all on function public.live_search_status(text) from public;
revoke all on function public.live_search_status(text) from anon, authenticated;
grant execute on function public.live_search_status(text) to service_role;

revoke all on function public.live_search_mark_completed() from public;
revoke all on function public.live_search_mark_completed() from anon, authenticated;
grant execute on function public.live_search_mark_completed() to service_role;
