-- Nov 19 2026 (Franklin: "No need of counties ... fix that"):
-- Adzuna stores locations as "City, Some County". Show "City, ST" instead, using state_code.
create or replace function public.normalize_job_location() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.location ~* ',\s*[^,]*\mcounty\s*$' and new.state_code ~ '^[A-Z]{2}$' then
    new.location := btrim(split_part(new.location, ',', 1)) || ', ' || new.state_code;
  end if;
  return new;
end $$;

drop trigger if exists pre_scraped_jobs_location on public.pre_scraped_jobs;
create trigger pre_scraped_jobs_location
  before insert or update of location, state_code on public.pre_scraped_jobs
  for each row execute function public.normalize_job_location();

-- Backfill existing rows (run in batches on production):
-- update public.pre_scraped_jobs set location = location
--   where id in (select id from public.pre_scraped_jobs where location ~* ',\s*[^,]*\mcounty\s*$' limit 2000);
