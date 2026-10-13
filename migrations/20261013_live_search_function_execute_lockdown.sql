-- Gateway functions must be callable by the trusted backend only.
--
-- Codex found that live_search_mark_unconfirmed was still executable with the
-- site's publishable key: an anonymous RPC probe returned 200. The cause is that
-- "revoke ... from anon, authenticated" does not remove EXECUTE inherited from
-- PUBLIC, which Postgres grants on every new function by default. PUBLIC has to
-- be revoked explicitly.
--
-- This is the authoritative grant state for all four gateway functions.

revoke all on function public.live_search_mark_unconfirmed(text) from public;
revoke all on function public.live_search_mark_unconfirmed(text) from anon, authenticated;
grant execute on function public.live_search_mark_unconfirmed(text) to service_role;

revoke all on function public.live_search_mark_completed() from public;
revoke all on function public.live_search_mark_completed() from anon, authenticated;
grant execute on function public.live_search_mark_completed() to service_role;

revoke all on function public.live_search_try_admit(text, text, uuid, text) from public;
revoke all on function public.live_search_try_admit(text, text, uuid, text) from anon, authenticated;
grant execute on function public.live_search_try_admit(text, text, uuid, text) to service_role;

revoke all on function public.live_search_settle(text, text, text) from public;
revoke all on function public.live_search_settle(text, text, text) from anon, authenticated;
grant execute on function public.live_search_settle(text, text, text) to service_role;

-- Verify with:
--   select p.proname, p.proacl,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname like 'live_search%';
-- Expected: acl shows postgres and service_role only, with no leading "=X/"
-- PUBLIC entry, and anon_exec false for every row.
--
-- This migration changes function EXECUTE only. The table write grants revoked
-- by the October 11 lockdown on job_matches and pre_scraped_jobs are left
-- exactly as they are.
