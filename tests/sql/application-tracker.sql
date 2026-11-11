-- Run only in a disposable database after the pending migration.
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.saved_jobs (user_id, job_title, apply_url, created_at)
values ('00000000-0000-0000-0000-000000000001', 'Engineer', 'https://example.com/1', '2026-01-01'),
       ('00000000-0000-0000-0000-000000000002', 'Analyst', 'https://example.com/2', '2026-01-02');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
declare
  stamp timestamptz;
  touched int;
begin
  if (select count(*) from public.saved_jobs) <> 1 then raise exception 'Owner SELECT failed'; end if;
  if (select stage from public.saved_jobs) <> 'saved' then raise exception 'Invalid initial stage'; end if;
  if (select stage_changed_at from public.saved_jobs) <> '2026-01-01'::timestamptz then
    raise exception 'Saved stage should use original saved date';
  end if;
  update public.saved_jobs set stage = 'applied', application_note = 'Follow up' where apply_url = 'https://example.com/1'
    returning stage_changed_at into stamp;
  if stamp is null or stamp <= '2026-01-01'::timestamptz then raise exception 'Stage date did not advance'; end if;
  update public.saved_jobs set application_note = repeat('x', 500);
  if (select stage_changed_at from public.saved_jobs) is distinct from stamp then raise exception 'Note changed the stage date'; end if;
  update public.saved_jobs set stage = 'offer' where apply_url = 'https://example.com/2';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'Cross-user update allowed'; end if;
  begin
    update public.saved_jobs set stage = 'invalid';
    raise exception 'Invalid stage accepted';
  exception when check_violation then null;
  end;
  begin
    update public.saved_jobs set application_note = repeat('x', 501);
    raise exception 'Oversized note accepted';
  exception when check_violation then null;
  end;
  begin
    update public.saved_jobs set job_title = 'Changed';
    raise exception 'Listing title editable';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.saved_jobs set stage_changed_at = now();
    raise exception 'Stage timestamp editable';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role anon;
do $$ begin
  begin
    update public.saved_jobs set stage = 'offer';
    raise exception 'Anonymous update allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
