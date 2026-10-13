-- Live Search: release a concurrency slot when the backend actually reports
-- results, instead of relying on the time-to-live.
--
-- Before this change a slot was freed by its TTL, which could hand capacity to a
-- new search while the previous scraper was still running. The TTL is now only a
-- backstop for a search that never reports at all, so it is lengthened.

alter table public.live_search_limits
  alter column slot_seconds set default 300;

update public.live_search_limits set slot_seconds = 300 where slot_seconds < 300;

create or replace function public.live_search_mark_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.search_id is not null then
    update public.live_search_admissions
       set status     = 'completed',
           settled_at = now(),
           outcome    = coalesce(outcome, 'results_received')
     where search_id = new.search_id
       and status in ('in_flight', 'dispatched');
  end if;
  return new;
end;
$$;

-- `create or replace trigger` keeps this re-runnable without dropping anything.
create or replace trigger live_search_release_slot
after insert on public.job_matches
for each row execute function public.live_search_mark_completed();
