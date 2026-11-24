-- FILE ONLY. Employer-level public disclosure aggregates, not visa/job guarantees.
begin;
create table public.h1b_employer_stats (
 employer_key text not null,employer_name text not null,state_code text not null references public.ingest_regions(code),soc_code text not null,
 role_id text not null references public.ingest_roles(id),fiscal_year integer not null check(fiscal_year between 2000 and 2100),
 certified_lcas integer not null check(certified_lcas>0),median_wage_annual numeric check(median_wage_annual>0),updated_at timestamptz not null,
 primary key(employer_key,state_code,soc_code,role_id,fiscal_year),
 check(char_length(employer_key) between 1 and 300 and char_length(employer_name) between 1 and 300)
);
create index h1b_role_state_year on public.h1b_employer_stats(role_id,state_code,fiscal_year);
create index h1b_employer_year_role on public.h1b_employer_stats(employer_key,fiscal_year,role_id);
create table public.h1b_data_state(singleton boolean primary key default true check(singleton),latest_full_fy integer,current_fy integer,updated_at timestamptz,
 pages_ready boolean not null default false,provenance jsonb,token uuid,lease_until timestamptz,expected_rows integer,pending_metadata jsonb);
insert into public.h1b_data_state(singleton) values(true);
create table public.h1b_staging(token uuid not null,payload jsonb not null);
alter table public.h1b_employer_stats enable row level security;
alter table public.h1b_data_state enable row level security;
alter table public.h1b_staging enable row level security;
revoke all on public.h1b_employer_stats,public.h1b_data_state,public.h1b_staging from public,anon,authenticated;
grant select on public.h1b_employer_stats to anon,authenticated;
-- Publish only metadata, never the upload token or staging records.
grant select(singleton,latest_full_fy,current_fy,updated_at,pages_ready) on public.h1b_data_state to anon,authenticated;
create policy public_h1b_stats on public.h1b_employer_stats for select to anon,authenticated using(true);
create policy public_h1b_metadata on public.h1b_data_state for select to anon,authenticated using(true);

create function public.h1b_employer_key(p_name text) returns text language sql immutable parallel safe set search_path='' as $$
 select string_agg(case token when 'incorporated' then 'inc' when 'corporation' then 'corp' when 'limited' then 'ltd' else token end,' ' order by ordinal)
 from regexp_split_to_table(trim(regexp_replace(replace(lower(p_name),'&',' and '),'[^a-z0-9]+',' ','g')),' +') with ordinality as t(token,ordinal);
$$;

create function public.h1b_import_start(p_metadata jsonb,p_count integer) returns uuid language plpgsql security definer set search_path='' as $$
declare t uuid:=gen_random_uuid();s public.h1b_data_state;
begin
 select * into s from public.h1b_data_state where singleton for update;
 if s.lease_until>clock_timestamp() then raise exception 'h1b_import_busy'; end if;
 if p_count is null or p_count not between 1 and 500000 or coalesce((p_metadata->>'latest_full_fy')::integer,0) not between 2000 and 2100
  or p_metadata->>'source' is distinct from 'https://www.dol.gov/agencies/eta/foreign-labor/performance'
  or jsonb_typeof(p_metadata->'source_files') is distinct from 'array' or jsonb_array_length(p_metadata->'source_files')=0
  or coalesce((p_metadata->>'test_fixture')::boolean,false) then raise exception 'invalid_h1b_provenance'; end if;
 delete from public.h1b_staging;
 update public.h1b_data_state set token=t,lease_until=clock_timestamp()+interval '30 minutes',expected_rows=p_count,pending_metadata=p_metadata where singleton;
 return t;
end $$;
create function public.h1b_stage(p_token uuid,p_rows jsonb) returns integer language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.h1b_data_state where singleton and token=p_token and lease_until>clock_timestamp() for update;
 if not found then raise exception 'h1b_lease_lost'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>500 then raise exception 'invalid_batch'; end if;
 insert into public.h1b_staging select p_token,r from jsonb_array_elements(p_rows) r;
 return jsonb_array_length(p_rows);
end $$;
create function public.h1b_import_finish(p_token uuid) returns integer language plpgsql security definer set search_path='' as $$
declare s public.h1b_data_state;stamp timestamptz:=clock_timestamp();n integer;
begin
 select * into s from public.h1b_data_state where singleton for update;
 if p_token is null or s.token is distinct from p_token or coalesce(s.lease_until<=clock_timestamp(),true) then raise exception 'h1b_lease_lost'; end if;
 select count(*) into n from public.h1b_staging where token=p_token;
 if n<>s.expected_rows then raise exception 'h1b_incomplete_upload'; end if;
 delete from public.h1b_employer_stats;
 insert into public.h1b_employer_stats select r.employer_key,r.employer_name,r.state_code,r.soc_code,r.role_id,r.fiscal_year,r.certified_lcas,r.median_wage_annual,stamp
 from public.h1b_staging st cross join lateral jsonb_to_record(st.payload) r(employer_key text,employer_name text,state_code text,soc_code text,role_id text,fiscal_year integer,certified_lcas integer,median_wage_annual numeric)
 where st.token=p_token;
 if exists(select 1 from public.h1b_employer_stats where employer_key is distinct from public.h1b_employer_key(employer_name) or lower(employer_name)~'^jobg8($|[^a-z0-9])'
  or fiscal_year not in((s.pending_metadata->>'latest_full_fy')::integer,(s.pending_metadata->>'current_fy')::integer)) then raise exception 'invalid_aggregate'; end if;
 update public.h1b_data_state set latest_full_fy=(s.pending_metadata->>'latest_full_fy')::integer,current_fy=(s.pending_metadata->>'current_fy')::integer,
 updated_at=stamp,provenance=s.pending_metadata,pages_ready=false,token=null,lease_until=null,expected_rows=null,pending_metadata=null where singleton;
 delete from public.h1b_staging where token=p_token;
 return n;
end $$;
create function public.h1b_pages_ready(p_ready boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_ready and (select count(distinct h.employer_key) from public.h1b_employer_stats h join public.h1b_data_state s on h.fiscal_year=s.latest_full_fy where s.singleton)<5 then raise exception 'h1b_data_missing'; end if;
 update public.h1b_data_state set pages_ready=p_ready where singleton;
end $$;

create function public.h1b_job_badges(p_pairs jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare full_fy integer;
begin
 if jsonb_typeof(p_pairs) is distinct from 'array' or jsonb_array_length(p_pairs)>100 then return '[]'::jsonb; end if;
 select latest_full_fy into full_fy from public.h1b_data_state where singleton and pages_ready;
 if full_fy is null or (select count(distinct employer_key) from public.h1b_employer_stats where fiscal_year=full_fy)<5 then return '[]'::jsonb; end if;
 return coalesce((select jsonb_agg(distinct jsonb_build_object('employer_key',s.employer_key,'role_id',s.role_id,'fiscal_year',s.fiscal_year))
  from public.h1b_employer_stats s join jsonb_to_recordset(p_pairs) p(company text,role_id text) on s.employer_key=public.h1b_employer_key(left(p.company,300)) and s.role_id=p.role_id where s.fiscal_year=full_fy),'[]'::jsonb);
end $$;
create function public.h1b_search_jobs(p_query text,p_filters jsonb default '{}',p_limit integer default 100)
returns setof public.pre_scraped_jobs language plpgsql stable security invoker set search_path='' as $$
declare fy integer;begin
 select latest_full_fy into fy from public.h1b_data_state where singleton and pages_ready;
 if fy is null then raise exception 'h1b_not_ready'; end if;
 return query select j.* from public.pre_scraped_jobs j where j.closed_at is null and j.country='us'
 and exists(select 1 from public.h1b_employer_stats h where h.employer_key=public.h1b_employer_key(j.company) and h.role_id=j.canonical_role and h.fiscal_year=fy)
 and (coalesce(p_query,'')='' or exists(select 1 from regexp_split_to_table(left(lower(p_query),120),' +') q where char_length(q)>=2 and j.search_text ilike '%'||q||'%'))
 and (coalesce(p_filters->>'country','us') in ('','us'))
 and (coalesce(p_filters->>'state','')='' or j.state_code=p_filters->>'state')
 and (coalesce(p_filters->>'city','')='' or j.location ilike '%'||(p_filters->>'city')||'%')
 and (coalesce(p_filters->>'company','')='' or j.company ilike '%'||(p_filters->>'company')||'%')
 and (coalesce(p_filters->>'category','')='' or j.category=p_filters->>'category')
 and (jsonb_typeof(p_filters->'roles') is distinct from 'array' or j.canonical_role in(select jsonb_array_elements_text(p_filters->'roles')))
 and (coalesce(p_filters->>'source','')='' or j.source=p_filters->>'source')
 and (coalesce(p_filters->>'exclude_source','')='' or j.source<>p_filters->>'exclude_source')
 and (coalesce(p_filters->>'work_mode','')='' or j.work_mode=p_filters->>'work_mode')
 and (coalesce(p_filters->>'posted_after','')='' or j.posted_at>=(p_filters->>'posted_after')::timestamptz)
 and (not coalesce((p_filters->>'salary_listed')::boolean,false) or j.salary is not null)
 order by j.posted_at desc nulls last limit least(100,greatest(1,p_limit));
end $$;
revoke all on function public.h1b_import_start(jsonb,integer),public.h1b_stage(uuid,jsonb),public.h1b_import_finish(uuid),public.h1b_pages_ready(boolean) from public,anon,authenticated;
grant execute on function public.h1b_import_start(jsonb,integer),public.h1b_stage(uuid,jsonb),public.h1b_import_finish(uuid),public.h1b_pages_ready(boolean) to service_role;
revoke all on function public.h1b_job_badges(jsonb),public.h1b_search_jobs(text,jsonb,integer),public.h1b_employer_key(text) from public;
grant execute on function public.h1b_job_badges(jsonb),public.h1b_search_jobs(text,jsonb,integer),public.h1b_employer_key(text) to anon,authenticated,service_role;
commit;
