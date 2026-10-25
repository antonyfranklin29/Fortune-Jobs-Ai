-- APPLIED TO PRODUCTION on 2026-10-24 (migration ledger 20261025002938) after Make's
-- Supabase "Create a Row" module was confirmed to store source_metadata as text: its existing
-- mapping passes a structured Apify item and Supabase still receives a JSON string. A rolled-back
-- rehearsal on production preceded the apply. Kept here because tests read this path.
--
-- Make maps job_matches.source_metadata as text, so PostgREST stores what Make sends as a
-- JSON *string* ("{\"signal\":\"success\"}"). Both the release trigger and the results page
-- read source_metadata->>'signal', which is null for a string, so a string-encoded signal
-- would be reported as "indeterminate" exactly like an unsigned marker.
--
-- This BEFORE INSERT trigger converts that one case into a real object, on the completion
-- marker row only. Job rows are left exactly as Make writes them, and the signal is not
-- invented: only a string that parses as an object holding a string "signal" equal to
-- success or failure is converted. It runs before the AFTER INSERT release trigger, so
-- live_search_mark_completed() sees the object.

create or replace function public.live_search_normalize_marker_signal()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if new.source_metadata is null or jsonb_typeof(new.source_metadata) <> 'string' then
    return new;
  end if;
  if not (new.job_title = 'No matching jobs found'
      and new.match_reason = 'Search complete'
      and coalesce(new.match_score, -1) = 0) then
    return new;   -- a job row: leave Make's metadata untouched
  end if;
  begin
    v := (new.source_metadata #>> '{}')::jsonb;
  exception when others then
    return new;   -- not JSON inside the string: keep it, it will read as unsigned
  end;
  if jsonb_typeof(v) = 'object' and jsonb_typeof(v->'signal') = 'string'
     and lower(v->>'signal') in ('success', 'failure') then
    new.source_metadata := v;
  end if;
  return new;
end;
$$;

revoke all on function public.live_search_normalize_marker_signal() from public, anon, authenticated;

drop trigger if exists live_search_normalize_marker_signal on public.job_matches;
create trigger live_search_normalize_marker_signal
before insert on public.job_matches
for each row execute function public.live_search_normalize_marker_signal();
