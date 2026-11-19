-- Nov 19 2026: index for the homepage "recent jobs" list (closed_at is null, newest first).
-- Applied directly on production by Claude after the Supabase Pro upgrade (Franklin approved the search fix).
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
create index concurrently if not exists pre_scraped_jobs_open_posted_idx
  on public.pre_scraped_jobs (posted_at desc nulls last)
  where closed_at is null;
