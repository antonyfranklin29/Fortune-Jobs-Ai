-- Nationwide feed ingestion (e.g. every U.S. IT job from Adzuna, newest first),
-- classified into canonical role and state by the same rules as cell ingestion.
--
-- Additive: a feed tag on catalogue rows, a resumable cursor per feed, a close
-- function that only touches rows the feed itself ingested, and a coverage view
-- that keeps feed rows current for the 30-day window between full passes.

alter table public.pre_scraped_jobs add column if not exists ingest_feed text;
create index if not exists pre_scraped_jobs_feed_idx
  on public.pre_scraped_jobs (ingest_feed, last_seen_at) where ingest_feed is not null and closed_at is null;

-- One row per feed. A pass walks every page of the feed's window across as many
-- runs as the budget needs; next_page is where the pass resumes.
create table if not exists public.ingest_feeds (
  feed                   text primary key,
  source                 text not null,
  pass_started_at        timestamptz,
  next_page              integer not null default 1 check (next_page >= 1),
  watermark              timestamptz,
  last_count             integer,
  passes_completed       integer not null default 0,
  last_pass_completed_at timestamptz,
  last_success_at        timestamptz,
  last_failure_at        timestamptz,
  last_error             text,
  updated_at             timestamptz not null default now()
);
alter table public.ingest_feeds enable row level security;
revoke all on public.ingest_feeds from public, anon, authenticated;
grant select, insert, update on public.ingest_feeds to service_role;

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
      work_mode text, posted_at timestamptz, fetched_at timestamptz, attribution text, feed text)
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
        ingest_feed     = coalesce(p.ingest_feed, r.feed),
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
        is_remote, work_mode, posted_at, fetched_at, last_seen_at, scraped_at, attribution, ingest_feed, search_text)
      values (
        r.source, r.source_listing_id, r.canonical_role, coalesce(r.category, r.canonical_role), r.state_code,
        coalesce(r.country, 'us'), left(r.job_title, 300), r.company, r.location, r.salary, r.apply_url,
        r.source_url, r.job_description, r.employment_type, coalesce(r.is_remote, false), r.work_mode,
        r.posted_at, coalesce(r.fetched_at, now()), now(), now(), r.attribution, r.feed,
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

-- Close feed rows that a COMPLETE pass did not see. Only rows the feed itself
-- ingested are eligible, so listings from other sources or cell sweeps are never
-- touched. Refuses implausible mass closures (more than 40% of the feed's open
-- rows once it holds over 100), which is what a silently truncated provider
-- response would look like.
create or replace function public.ingest_close_feed_unseen(p_feed text, p_pass_started timestamptz)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n_open integer; n_close integer;
begin
  if p_pass_started is null or p_pass_started > now() or p_pass_started < now() - interval '45 days' then
    raise exception 'pass start must be within the last 45 days';
  end if;
  select count(*), count(*) filter (where last_seen_at < p_pass_started)
    into n_open, n_close
    from pre_scraped_jobs where ingest_feed = p_feed and closed_at is null;
  if n_open > 100 and n_close > n_open * 0.4 then
    raise exception 'refusing to close % of % open feed rows', n_close, n_open;
  end if;
  update pre_scraped_jobs set closed_at = now()
   where ingest_feed = p_feed and closed_at is null and last_seen_at < p_pass_started;
  get diagnostics n_close = row_count;
  return n_close;
end $$;

revoke all on function public.ingest_upsert_jobs(jsonb) from public, anon, authenticated;
revoke all on function public.ingest_close_feed_unseen(text, timestamptz) from public, anon, authenticated;
grant execute on function public.ingest_upsert_jobs(jsonb), public.ingest_close_feed_unseen(text, timestamptz) to service_role;

create or replace view public.ingest_coverage with (security_invoker = true) as
with eligible as (
  select canonical_role, state_code, source, posted_at, ingest_feed,
         lower(btrim(job_title)) || '|' || lower(btrim(coalesce(company, ''))) || '|' || lower(btrim(coalesce(location, ''))) as dk
    from public.pre_scraped_jobs
   where closed_at is null
     and canonical_role is not null and state_code is not null
     and posted_at is not null and posted_at >= now() - interval '30 days'
     and last_seen_at is not null
     -- Feed listings are re-confirmed by a full pass of the feed, which can take
     -- longer than a week on a small plan, so they stay current for the 30-day
     -- window unless a completed pass did not see them (then they are closed).
     and last_seen_at >= now() - case when ingest_feed is not null then interval '30 days' else interval '7 days' end
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
