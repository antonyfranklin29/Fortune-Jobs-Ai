-- State-by-role coverage matrix. Run as service_role (SQL editor or MCP).
-- A cell passes only with 100 eligible DISTINCT listings: open, a real posting
-- date within 30 days, seen within 7. Unreviewed roles are reported but must not
-- be presented as covered.
select role, review, state, state_name, separate_region,
       fresh_distinct, target, shortage, passes,
       newest_posted::date, oldest_posted::date, sources,
       last_successful_refresh, last_failure, last_error
  from public.ingest_coverage
 order by sort, separate_region, state;
