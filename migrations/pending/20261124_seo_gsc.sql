begin;
create table public.seo_gsc_daily(
 date date not null, query text not null check(length(query) between 1 and 200),
 page text not null check(length(page)<=500 and page ~ '^https://fortunejobsai[.]com/' and page !~ '[?#@]'),
 clicks integer not null check(clicks>=0), impressions integer not null check(impressions>0 and clicks<=impressions),
 position double precision not null check(position>=1 and position<'Infinity'::float8),
 primary key(date,query,page)
);
create index seo_gsc_page_day on public.seo_gsc_daily(page,date);
create table public.seo_gsc_runs(
 date date primary key, fetched_at timestamptz not null default now(), stored_rows integer not null,
 provider_rows integer not null, bounded boolean not null
);
create table public.seo_index_status(
 url text primary key check(length(url)<=500 and url ~ '^https://fortunejobsai[.]com/' and url !~ '[?#@]'),
 inspected_at timestamptz not null, verdict text,coverage_state text,robots_txt_state text,indexing_state text,
 page_fetch_state text,last_crawl_time timestamptz,google_canonical text,user_canonical text,discovered_since timestamptz
);
create table public.seo_inspection_requests(
 day date not null,url text not null,claimed_at timestamptz not null default now(),primary key(day,url)
);
alter table public.seo_gsc_daily enable row level security;
alter table public.seo_gsc_runs enable row level security;
alter table public.seo_index_status enable row level security;
alter table public.seo_inspection_requests enable row level security;
revoke all on public.seo_gsc_daily,public.seo_gsc_runs,public.seo_index_status,public.seo_inspection_requests from public,anon,authenticated;
grant select on public.seo_gsc_daily,public.seo_gsc_runs,public.seo_inspection_requests to service_role;
grant select,insert,update on public.seo_index_status to service_role;

create function public.seo_replace_gsc_day(p_day date,p_rows jsonb,p_provider_rows integer,p_bounded boolean default false)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_day is null or p_day>current_date or p_day<current_date-interval '90 days'
  or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>50000
  or p_provider_rows is null or p_provider_rows<jsonb_array_length(p_rows) or p_provider_rows>50000
  or p_bounded is null then raise exception 'Invalid GSC day snapshot';end if;
 if exists(select 1 from jsonb_to_recordset(p_rows) r(date date,query text,page text,clicks integer,impressions integer,position double precision)
  where r.date is distinct from p_day or r.query is null or r.query ~ '[@[:cntrl:]]' or r.page is null or r.clicks is null or r.impressions is null or r.position is null)
 then raise exception 'Invalid GSC row';end if;
 -- Validate and replace atomically. A failed import preserves the previous day.
 perform pg_advisory_xact_lock(hashtextextended(p_day::text,724));
 delete from public.seo_gsc_daily where date=p_day;
 insert into public.seo_gsc_daily select r.* from jsonb_to_recordset(p_rows) r(date date,query text,page text,clicks integer,impressions integer,position double precision);
 get diagnostics n=row_count;
 insert into public.seo_gsc_runs(date,stored_rows,provider_rows,bounded) values(p_day,n,p_provider_rows,p_bounded)
 on conflict(date) do update set fetched_at=now(),stored_rows=excluded.stored_rows,provider_rows=excluded.provider_rows,bounded=excluded.bounded;
 return n;
end $$;
create function public.seo_claim_inspections(p_urls jsonb,p_limit integer default 300)
returns table(url text) language plpgsql security definer set search_path='' as $$
declare today date:=(now() at time zone 'UTC')::date; available integer;
begin
 if jsonb_typeof(p_urls) is distinct from 'array' or jsonb_array_length(p_urls)>3000 then raise exception 'Invalid sitemap URL list';end if;
 perform pg_advisory_xact_lock(hashtextextended(today::text,725));
 select greatest(0,least(300,coalesce(p_limit,0))-count(*)::int) into available from public.seo_inspection_requests r where r.day=today;
 return query with candidate as (
  select distinct j.value as candidate_url from jsonb_array_elements_text(p_urls) j(value)
  where length(j.value)<=500 and j.value ~ '^https://fortunejobsai[.]com/(jobs/|salaries/|h1b/|$|index[.]html$|find-jobs[.]html$|resume-(search|builder)[.]html$|application-tracker[.]html$|about[.]html$|contact[.]html$|privacy[.]html$|terms[.]html$)'
   and j.value !~ '[?#@]' and not exists(select 1 from public.seo_inspection_requests r where r.day=today and r.url=j.value)
 ), chosen as (
  select c.candidate_url from candidate c left join public.seo_index_status s on s.url=c.candidate_url
  order by s.inspected_at asc nulls first,c.candidate_url limit available
 ) insert into public.seo_inspection_requests(day,url) select today,candidate_url from chosen
 on conflict do nothing returning seo_inspection_requests.url;
end $$;
revoke all on function public.seo_replace_gsc_day(date,jsonb,integer,boolean),public.seo_claim_inspections(jsonb,integer) from public,anon,authenticated;
grant execute on function public.seo_replace_gsc_day(date,jsonb,integer,boolean),public.seo_claim_inspections(jsonb,integer) to service_role;
comment on table public.seo_inspection_requests is 'At most 300 claims per UTC day across reruns; failed or interrupted claims still consume that day allowance. No index-submission API.';
commit;
