-- Run in the SQL editor. Uses temporary synthetic rows only; always rolls back.
begin;
create temp table fj_bounds_test
  (like public.profiles including defaults including constraints) on commit drop;
alter table fj_bounds_test enable row level security;
insert into fj_bounds_test(id,years_experience)
  values ('b3333333-3333-4333-b333-333333333333',4.5);
do $$ begin
  begin
    insert into fj_bounds_test(id,resume_text)
      values ('b3333333-3333-4333-b333-333333333334',repeat('x',60001));
    raise exception 'Oversized resume incorrectly accepted';
  exception when check_violation then null;
  end;
  begin
    insert into fj_bounds_test(id,years_experience)
      values ('b3333333-3333-4333-b333-333333333335',61);
    raise exception 'Invalid experience incorrectly accepted';
  exception when check_violation then null;
  end;
  begin
    insert into fj_bounds_test(id,skills)
      values ('b3333333-3333-4333-b333-333333333336',array_fill('SQL'::text,array[31]));
    raise exception 'Too many skills incorrectly accepted';
  exception when check_violation then null;
  end;
end $$;
select jsonb_build_object(
  'fractional_years',(select years_experience from fj_bounds_test limit 1),
  'accepted_test_rows',(select count(*) from fj_bounds_test),
  'validated_production_constraints',(select count(*) from pg_constraint
    where conrelid in ('public.profiles'::regclass,'public.saved_jobs'::regclass,'public.search_history'::regclass)
    and conname in ('fj_profile_data_bounds','fj_saved_job_data_bounds','fj_history_data_bounds') and convalidated)
) as data_bounds_checks;
rollback;
