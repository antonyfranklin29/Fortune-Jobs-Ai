drop trigger if exists pre_scraped_jobs_location on public.pre_scraped_jobs;
drop function if exists public.normalize_job_location();
-- Rewritten locations are not restored (the county name was display-only).
