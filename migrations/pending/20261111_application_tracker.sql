begin;

alter table public.saved_jobs
  add column stage text not null default 'saved'
    check (stage in ('saved', 'applied', 'interview', 'offer', 'rejected')),
  add column application_note text check (char_length(application_note) <= 500),
  add column stage_changed_at timestamptz;

update public.saved_jobs set stage_changed_at = coalesce(created_at, now());

alter table public.saved_jobs
  alter column stage_changed_at set default now(),
  alter column stage_changed_at set not null;

create function public.set_saved_job_stage_date()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.stage := 'saved';
    new.stage_changed_at := coalesce(new.created_at, now());
  elsif new.stage is distinct from old.stage then
    new.stage_changed_at := clock_timestamp();
  else
    new.stage_changed_at := old.stage_changed_at;
  end if;
  return new;
end;
$$;

revoke execute on function public.set_saved_job_stage_date() from public, anon, authenticated;

create trigger saved_jobs_stage_date
before insert or update of stage, stage_changed_at on public.saved_jobs
for each row execute function public.set_saved_job_stage_date();

revoke update on public.saved_jobs from public, anon, authenticated;
grant update (stage, application_note) on public.saved_jobs to authenticated;

create policy saved_jobs_tracker_owner_guard on public.saved_jobs
  as restrictive for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy saved_jobs_tracker_owner_update on public.saved_jobs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
