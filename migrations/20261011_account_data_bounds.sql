-- Add server-side bounds; preserve existing records and fractional experience.
begin;
alter table public.profiles alter column years_experience type numeric(4,1)
  using years_experience::numeric(4,1);
do $$ begin
  if not exists (select 1 from pg_constraint where conname='fj_profile_data_bounds' and conrelid='public.profiles'::regclass) then
    alter table public.profiles add constraint fj_profile_data_bounds check (
      coalesce(char_length(full_name),0)<=120 and coalesce(char_length(current_title),0)<=120
      and (years_experience is null or years_experience between 0 and 60)
      and coalesce(cardinality(skills),0)<=30 and coalesce(char_length(array_to_string(skills,',')),0)<=2430
      and coalesce(cardinality(preferred_locations),0)<=10 and coalesce(char_length(array_to_string(preferred_locations,',')),0)<=1610
      and coalesce(cardinality(job_types),0)<=5
      and coalesce(char_length(resume_text),0)<=60000 and coalesce(char_length(resume_name),0)<=200
      and coalesce(char_length(resume_path),0)<=1024 and coalesce(char_length(avatar_url),0)<=4000
      and coalesce(octet_length(saved_filters::text),0)<=16384
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='fj_saved_job_data_bounds' and conrelid='public.saved_jobs'::regclass) then
    alter table public.saved_jobs add constraint fj_saved_job_data_bounds check (
      coalesce(char_length(job_key),0)<=600 and coalesce(char_length(job_title),0)<=300
      and coalesce(char_length(company),0)<=300 and coalesce(char_length(location),0)<=300
      and coalesce(char_length(salary),0)<=300 and coalesce(char_length(apply_url),0)<=2000
      and coalesce(char_length(match_reason),0)<=2000 and coalesce(char_length(match_score),0)<=300
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='fj_history_data_bounds' and conrelid='public.search_history'::regclass) then
    alter table public.search_history add constraint fj_history_data_bounds check (
      coalesce(char_length(query),0)<=200 and coalesce(char_length(mode),0)<=20
      and coalesce(octet_length(filters::text),0)<=16384
    ) not valid;
  end if;
end $$;
-- Validation is transactional: incompatible old data rolls back the entire batch.
alter table public.profiles validate constraint fj_profile_data_bounds;
alter table public.saved_jobs validate constraint fj_saved_job_data_bounds;
alter table public.search_history validate constraint fj_history_data_bounds;
commit;
