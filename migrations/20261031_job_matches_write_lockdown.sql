-- The browser reads Live Search results, but only Make's service_role may write
-- jobs and completion markers. Existing SELECT grants and policies are kept.
-- Applied in production on 2026-11-01; verified anon/authenticated retain
-- SELECT but have no write grants, while service_role retains write access.
drop policy if exists "pipeline can insert job matches" on public.job_matches;
revoke insert, update, delete, truncate, references, trigger
  on public.job_matches from public, anon, authenticated;

-- service_role bypasses RLS and already writes this table in production.
grant insert, update, delete on public.job_matches to service_role;
