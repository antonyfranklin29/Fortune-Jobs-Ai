-- Run each statement outside a transaction. CREATE INDEX CONCURRENTLY cannot
-- run inside BEGIN/COMMIT or a migration runner that wraps files in a transaction.
create index concurrently if not exists pre_scraped_jobs_open_source_id_idx
  on public.pre_scraped_jobs (source, id) where closed_at is null;

create index concurrently if not exists pre_scraped_jobs_open_country_id_idx
  on public.pre_scraped_jobs (country, id) where closed_at is null;
