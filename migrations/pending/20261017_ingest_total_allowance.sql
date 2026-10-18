-- Lifetime request count for the Adzuna source, used by the job-ingest worker
-- when ADZUNA_LIMIT_TOTAL is set (a test plan's total allowance).
--
-- Additive: one new function, no table, column, data or existing-grant change.
--
-- APPLIED MANUALLY TO PRODUCTION on 2026-10-18. Effective privileges verified:
-- anon/authenticated denied, service_role allowed; current total was 10 calls.
-- Historical source stays in pending/ with the other manually applied SQL.
-- DO NOT replay automatically on the existing production project.

create or replace function public.ingest_total_used(p_source text)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(requests_used), 0)::bigint from public.ingest_runs where source = p_source;
$$;

revoke all on function public.ingest_total_used(text) from public, anon, authenticated;
grant execute on function public.ingest_total_used(text) to service_role;
