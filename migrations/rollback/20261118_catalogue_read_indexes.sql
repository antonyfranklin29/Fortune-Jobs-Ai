-- Run outside a transaction, one statement at a time, like the forward migration.
drop index concurrently if exists public.pre_scraped_jobs_open_source_id_idx;
drop index concurrently if exists public.pre_scraped_jobs_open_country_id_idx;
