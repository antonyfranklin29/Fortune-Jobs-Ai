-- Provider-specific freshness for the Adzuna top-up planner. The existing
-- ingest_coverage view remains the all-source launch report.
create or replace view public.ingest_source_coverage with (security_invoker = true) as
select source,
       canonical_role as role_id,
       state_code as state,
       count(distinct lower(btrim(job_title)) || '|' || lower(btrim(coalesce(company, ''))) || '|' || lower(btrim(coalesce(location, ''))))::int as fresh_distinct
  from public.pre_scraped_jobs
 where closed_at is null
   and canonical_role is not null and state_code is not null
   and posted_at is not null and posted_at >= now() - interval '30 days'
   and last_seen_at is not null
   and last_seen_at >= now() - case when ingest_feed is not null then interval '30 days' else interval '7 days' end
 group by source, canonical_role, state_code;

revoke all on public.ingest_source_coverage from public, anon, authenticated;
grant select on public.ingest_source_coverage to service_role;
