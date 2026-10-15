-- Durable job ingestion: provenance, freshness, run log, per-cell checkpoints,
-- backend-only writes and the state-by-role coverage report.
--
-- Additive and compatible with Quick Match: existing columns, the unique
-- apply_url index and the anon SELECT grant are unchanged; anon reads now hide
-- listings the worker has positively confirmed closed.

-- ── provenance and freshness on the catalogue ────────────────────────────────
alter table public.pre_scraped_jobs
  add column if not exists canonical_role    text,
  add column if not exists state_code        text,
  add column if not exists source_listing_id text,
  add column if not exists source_url        text,
  add column if not exists attribution       text,
  add column if not exists fetched_at        timestamptz,
  add column if not exists last_seen_at      timestamptz,
  add column if not exists closed_at         timestamptz;

create unique index if not exists pre_scraped_jobs_source_listing_uq
  on public.pre_scraped_jobs (source, source_listing_id) where source_listing_id is not null;
create index if not exists pre_scraped_jobs_role_state_idx
  on public.pre_scraped_jobs (canonical_role, state_code, posted_at desc) where closed_at is null;

-- Legacy rows: role and state come from the title and location they already
-- carry (title-verified, so a Data Engineer filed under "Data Analyst" is
-- reclassified rather than counted). last_seen_at is when we actually last saw
-- them — the original scrape — which is the honest value.
update public.pre_scraped_jobs
   set canonical_role = public.ingest_classify_role(job_title),
       state_code     = public.ingest_state_from_location(location),
       fetched_at     = coalesce(fetched_at, scraped_at),
       last_seen_at   = coalesce(last_seen_at, scraped_at)
 where last_seen_at is null;

-- Visitors never see a listing the worker has positively confirmed closed.
alter policy "public can read pre-scraped jobs" on public.pre_scraped_jobs using (closed_at is null);

-- ── run log and per-cell checkpoints ─────────────────────────────────────────
create table if not exists public.ingest_runs (
  id            bigint generated always as identity primary key,
  source        text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running'
                check (status in ('running','succeeded','partial','failed','blocked')),
  requests_used integer not null default 0,
  fetched       integer not null default 0,
  inserted      integer not null default 0,
  updated       integer not null default 0,
  closed        integer not null default 0,
  rejected      jsonb   not null default '{}'::jsonb,
  deferred_cells integer not null default 0,
  note          text
);
create index if not exists ingest_runs_source_started_idx on public.ingest_runs (source, started_at desc);

create table if not exists public.ingest_cells (
  source               text not null,
  canonical_role       text not null references public.ingest_roles(id),
  state_code           text not null references public.ingest_regions(code),
  last_attempt_at      timestamptz,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  last_error           text,
  consecutive_failures integer not null default 0,
  next_due_at          timestamptz,
  primary key (source, canonical_role, state_code)
);

alter table public.ingest_runs  enable row level security;
alter table public.ingest_cells enable row level security;
revoke all on public.ingest_runs, public.ingest_cells from public, anon, authenticated;
grant select, insert, update on public.ingest_runs, public.ingest_cells to service_role;

-- ── backend-only writes ──────────────────────────────────────────────────────
-- Upsert by (source, source_listing_id), falling back to the canonical
-- application URL, so a repost refreshes the existing row instead of
-- duplicating it. Every row is re-validated here regardless of what the worker
-- checked: https apply URL, a known region, a known role, and a title that the
-- shared taxonomy actually assigns to that role. A known posting date is never
-- overwritten with null; a newer one replaces an older one.
create or replace function public.ingest_upsert_jobs(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record; c integer;
  n_ins integer := 0; n_upd integer := 0; n_rej integer := 0; n_conf integer := 0;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'p_rows must be a JSON array of at most 500 rows';
  end if;

  for r in select * from jsonb_to_recordset(p_rows) as x(
      source text, source_listing_id text, canonical_role text, category text, state_code text,
      country text, job_title text, company text, location text, salary text, apply_url text,
      source_url text, job_description text, employment_type text, is_remote boolean,
      work_mode text, posted_at timestamptz, fetched_at timestamptz, attribution text)
  loop
    if r.source is null or r.source_listing_id is null or r.job_title is null
       or coalesce(r.apply_url, '') !~ '^https://[^/[:space:]]+\.[^/[:space:]]+'
       or not exists (select 1 from ingest_regions where code = r.state_code)
       or not exists (select 1 from ingest_roles   where id   = r.canonical_role)
       or ingest_classify_role(r.job_title) is distinct from r.canonical_role
       or (r.posted_at is not null and r.posted_at > now() + interval '1 hour') then
      n_rej := n_rej + 1;
      continue;
    end if;

    begin
      update pre_scraped_jobs p set
        job_title       = left(r.job_title, 300),
        company         = coalesce(r.company, p.company),
        location        = coalesce(r.location, p.location),
        salary          = coalesce(r.salary, p.salary),
        job_description = coalesce(r.job_description, p.job_description),
        employment_type = coalesce(r.employment_type, p.employment_type),
        work_mode       = coalesce(r.work_mode, p.work_mode),
        is_remote       = coalesce(r.is_remote, p.is_remote),
        posted_at       = greatest(r.posted_at, p.posted_at),
        canonical_role  = r.canonical_role,
        category        = coalesce(r.category, p.category),
        state_code      = r.state_code,
        source          = r.source,
        source_listing_id = r.source_listing_id,
        source_url      = coalesce(r.source_url, p.source_url),
        attribution     = coalesce(r.attribution, p.attribution),
        fetched_at      = coalesce(r.fetched_at, now()),
        last_seen_at    = now(),
        closed_at       = null,
        scraped_at      = now(),
        search_text     = lower(r.job_title || ' ' || coalesce(r.company, p.company, '') || ' ' || coalesce(r.location, p.location, ''))
      where (p.source = r.source and p.source_listing_id = r.source_listing_id)
         or p.apply_url = r.apply_url;
      get diagnostics c = row_count;
      if c > 0 then n_upd := n_upd + 1; continue; end if;

      insert into pre_scraped_jobs (
        source, source_listing_id, canonical_role, category, state_code, country, job_title,
        company, location, salary, apply_url, source_url, job_description, employment_type,
        is_remote, work_mode, posted_at, fetched_at, last_seen_at, scraped_at, attribution, search_text)
      values (
        r.source, r.source_listing_id, r.canonical_role, coalesce(r.category, r.canonical_role), r.state_code,
        coalesce(r.country, 'us'), left(r.job_title, 300), r.company, r.location, r.salary, r.apply_url,
        r.source_url, r.job_description, r.employment_type, coalesce(r.is_remote, false), r.work_mode,
        r.posted_at, coalesce(r.fetched_at, now()), now(), now(), r.attribution,
        lower(r.job_title || ' ' || coalesce(r.company, '') || ' ' || coalesce(r.location, '')));
      n_ins := n_ins + 1;
    exception when unique_violation then
      -- The listing's id and its URL point at two different existing rows.
      -- Leave both as they are rather than guess which one is right.
      n_conf := n_conf + 1;
    end;
  end loop;

  return jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'rejected', n_rej, 'conflicts', n_conf);
end $$;

-- Close listings a COMPLETE sweep of one cell did not see. Only the worker calls
-- this, and only after enumerating every page the source reported. A failed or
-- truncated sweep never closes anything, so a source outage cannot empty the
-- catalogue. The sweep must be recent, which stops a stale timestamp from
-- closing listings seen since.
create or replace function public.ingest_close_unseen(
  p_source text, p_role text, p_state text, p_sweep_started timestamptz)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare c integer;
begin
  if p_sweep_started is null or p_sweep_started < now() - interval '6 hours' or p_sweep_started > now() then
    raise exception 'sweep start must be within the last six hours';
  end if;
  update pre_scraped_jobs set closed_at = now()
   where source = p_source and canonical_role = p_role and state_code = p_state
     and closed_at is null and last_seen_at < p_sweep_started;
  get diagnostics c = row_count;
  return c;
end $$;

-- Requests already spent against a source in the provider's windows. The worker
-- refuses to exceed any of them, across runs.
create or replace function public.ingest_budget_used(p_source text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'minute', coalesce(sum(requests_used) filter (where started_at > now() - interval '1 minute'), 0),
    'day',    coalesce(sum(requests_used) filter (where started_at > now() - interval '1 day'), 0),
    'week',   coalesce(sum(requests_used) filter (where started_at > now() - interval '7 days'), 0),
    'month',  coalesce(sum(requests_used) filter (where started_at > now() - interval '30 days'), 0))
  from ingest_runs where source = p_source;
$$;

revoke all on function public.ingest_upsert_jobs(jsonb) from public, anon, authenticated;
revoke all on function public.ingest_close_unseen(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.ingest_budget_used(text) from public, anon, authenticated;
grant execute on function public.ingest_upsert_jobs(jsonb),
                          public.ingest_close_unseen(text, text, text, timestamptz),
                          public.ingest_budget_used(text) to service_role;

-- ── coverage report ──────────────────────────────────────────────────────────
-- One row per canonical role × region. A cell passes only with 100 eligible
-- DISTINCT listings: open, a real posting date within 30 days, seen within 7.
-- Distinct means title + company + location, so reposts and multiple tracking
-- URLs for one opening count once. Fetched counts and duplicates never count.
create or replace view public.ingest_coverage with (security_invoker = true) as
with eligible as (
  select canonical_role, state_code, source, posted_at,
         lower(btrim(job_title)) || '|' || lower(btrim(coalesce(company, ''))) || '|' || lower(btrim(coalesce(location, ''))) as dk
    from public.pre_scraped_jobs
   where closed_at is null
     and canonical_role is not null and state_code is not null
     and posted_at is not null and posted_at >= now() - interval '30 days'
     and last_seen_at is not null and last_seen_at >= now() - interval '7 days'
)
select ro.id as role_id, ro.name as role, ro.review, ro.sort,
       rg.code as state, rg.name as state_name, rg.separate as separate_region,
       count(distinct e.dk)::int                      as fresh_distinct,
       100                                            as target,
       greatest(0, 100 - count(distinct e.dk))::int   as shortage,
       count(distinct e.dk) >= 100                    as passes,
       max(e.posted_at)                               as newest_posted,
       min(e.posted_at)                               as oldest_posted,
       string_agg(distinct e.source, ',')             as sources,
       max(c.last_success_at)                         as last_successful_refresh,
       max(c.last_failure_at)                         as last_failure,
       max(c.last_error)                              as last_error
  from public.ingest_roles ro
  cross join public.ingest_regions rg
  left join eligible e on e.canonical_role = ro.id and e.state_code = rg.code
  left join public.ingest_cells c on c.canonical_role = ro.id and c.state_code = rg.code
 group by ro.id, ro.name, ro.review, ro.sort, rg.code, rg.name, rg.separate;

revoke all on public.ingest_coverage from public, anon, authenticated;
grant select on public.ingest_coverage to service_role;

-- A cell's last complete re-sweep. The planner forces a full sweep before this
-- is older than seen_within_days, so open listings are re-confirmed in time.
alter table public.ingest_cells add column if not exists last_full_sweep_at timestamptz;
