-- The browser reads Live Search results, but only Make's service_role may write
-- jobs and completion markers. Existing SELECT grants and policies are kept.
-- Apply before enabling the public gateway path.
revoke insert, update, delete, truncate, references, trigger
  on public.job_matches from public, anon, authenticated;

-- service_role bypasses RLS and already writes this table in production.
grant insert, update, delete on public.job_matches to service_role;
