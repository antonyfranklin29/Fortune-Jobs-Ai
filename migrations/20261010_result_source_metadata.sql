-- Applied through the authenticated Supabase SQL editor on October 10, 2026.
-- Preserve source evidence without changing existing result or completion fields.
alter table public.job_matches add column if not exists source_metadata jsonb;
