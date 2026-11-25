-- FILE ONLY. Requires source-tracking and bot-protection migrations first.
begin;
alter table public.pre_scraped_jobs
 add column if not exists jobg8_sell_price numeric,
 add column if not exists jobg8_sell_price_currency text,
 add column if not exists jobg8_revenue_type text,
 add column if not exists jobg8_job_type text,
 add column if not exists jobg8_payload_hash text,
 add column if not exists source_metadata jsonb;
-- Preserve complete signed Jobg8 links when saved; all other bounds are unchanged.
alter table public.saved_jobs drop constraint if exists fj_saved_job_data_bounds;
alter table public.saved_jobs add constraint fj_saved_job_data_bounds check (
 coalesce(char_length(job_key),0)<=600 and coalesce(char_length(job_title),0)<=300
 and coalesce(char_length(company),0)<=300 and coalesce(char_length(location),0)<=300
 and coalesce(char_length(salary),0)<=300 and coalesce(char_length(apply_url),0)<=case when source='jobg8' then 4000 else 2000 end
 and coalesce(char_length(match_reason),0)<=2000 and coalesce(char_length(match_score),0)<=300
) not valid;
alter table public.ingest_runs add column if not exists mode text check (mode in ('qa','live'));
create table public.jobg8_feed_state (
 singleton boolean primary key default true check(singleton), last_modified text,
 token uuid, lease_until timestamptz, run_id bigint, gets timestamptz[] not null default '{}',
 ready boolean not null default false
);
insert into public.jobg8_feed_state(singleton) values(true);
create table public.jobg8_staging (
 run_id bigint not null references public.ingest_runs(id) on delete cascade,
 ref text not null, payload jsonb not null, published boolean not null default false, primary key(run_id,ref)
);
alter table public.jobg8_feed_state enable row level security;
alter table public.jobg8_staging enable row level security;
revoke all on public.jobg8_feed_state,public.jobg8_staging from public,anon,authenticated;

create function public.jobg8_start(p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.jobg8_feed_state; r bigint; t uuid := gen_random_uuid();
begin
 if p_mode is null or p_mode not in ('qa','live') then raise exception 'invalid_mode'; end if;
 select * into s from public.jobg8_feed_state where singleton for update;
 if s.lease_until > clock_timestamp() then
   insert into public.ingest_runs(source,status,mode,finished_at,note) values('jobg8','blocked',p_mode,now(),'busy');
   return jsonb_build_object('status','busy');
 end if;
 -- Fence expired workers. Their staged rows can never finish or close jobs.
 update public.ingest_runs set status='failed',finished_at=now(),note='lease_expired' where id=s.run_id and status='running';
 delete from public.jobg8_staging where run_id in (select id from public.ingest_runs where source='jobg8' and status<>'running');
 insert into public.ingest_runs(source,mode) values('jobg8',p_mode) returning id into r;
 update public.jobg8_feed_state set token=t,lease_until=clock_timestamp()+interval '10 minutes',run_id=r,ready=false where singleton;
 return jsonb_build_object('status','started','run_id',r,'token',t,'last_modified',s.last_modified);
end $$;

create function public.jobg8_assert(p_run bigint,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.jobg8_feed_state where singleton and run_id=p_run and token=p_token and lease_until>clock_timestamp() for update;
 if not found then raise exception 'lease_lost'; end if;
end $$;

create function public.jobg8_get(p_run bigint,p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform public.jobg8_assert(p_run,p_token);
 update public.jobg8_feed_state set gets=array(select x from unnest(gets) x where x>clock_timestamp()-interval '10 minutes') where singleton;
 select cardinality(gets) into n from public.jobg8_feed_state where singleton;
 if n>=2 then return false; end if;
 update public.jobg8_feed_state set gets=array_append(gets,clock_timestamp()) where singleton;
 update public.ingest_runs set requests_used=requests_used+1 where id=p_run;
 return true;
end $$;

create function public.jobg8_stage(p_run bigint,p_token uuid,p_rows jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare r jsonb; n integer := 0;
begin
 perform public.jobg8_assert(p_run,p_token);
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>500 then raise exception 'invalid_batch'; end if;
 for r in select * from jsonb_array_elements(p_rows) loop
  if coalesce(r->>'source_listing_id','')='' or coalesce(r->>'job_title','')='' or coalesce(r->>'company','')='' or lower(r->>'company')~'^jobg8($|[^a-z0-9])'
   or r->>'country' is distinct from 'us' or coalesce(r->>'apply_url','')!~'^https://[^/[:space:]]+\.[^/[:space:]]+'
   or not exists(select 1 from public.ingest_regions where code=r->>'state_code') then raise exception 'invalid_job'; end if;
  insert into public.jobg8_staging(run_id,ref,payload) values(p_run,r->>'source_listing_id',r); n:=n+1;
 end loop;
 update public.ingest_runs set fetched=fetched+n where id=p_run;
 return n;
end $$;

create function public.jobg8_ready(p_run bigint,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.jobg8_assert(p_run,p_token);
 update public.jobg8_feed_state set ready=true where singleton;
end $$;

create function public.jobg8_publish(p_run bigint,p_token uuid,p_after text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare rec record; r jsonb; old public.pre_scraped_jobs; ni integer:=0; nu integer:=0; nc integer:=0; last_ref text:=p_after; n integer:=0; stamp timestamptz; qa boolean;
begin
 perform public.jobg8_assert(p_run,p_token);
 if not (select ready from public.jobg8_feed_state where singleton) then raise exception 'snapshot_incomplete'; end if;
 -- QA (test) mode: rows are stored but kept closed, so no page, search, alert or count shows them.
 -- The first live-mode run reopens every row it sees.
 select started_at, coalesce(mode,'qa')='qa' into stamp, qa from public.ingest_runs where id=p_run;
 for rec in select ref,payload from public.jobg8_staging where run_id=p_run and not published and ref>p_after order by ref limit 500 loop
  r:=rec.payload; last_ref:=rec.ref; n:=n+1;
  select * into old from public.pre_scraped_jobs where source='jobg8' and source_listing_id=rec.ref for update;
  begin
   if found then
    -- Every seen row stays fresh; first-seen posted_at is deliberately unchanged.
    update public.pre_scraped_jobs set last_seen_at=stamp,fetched_at=stamp,closed_at=case when qa then stamp else null end where id=old.id;
    if old.jobg8_payload_hash is distinct from md5(r::text) then
     update public.pre_scraped_jobs set job_title=r->>'job_title',company=r->>'company',location=r->>'location',state_code=r->>'state_code',
      canonical_role=r->>'canonical_role',category=r->>'category',salary=r->>'salary',apply_url=r->>'apply_url',job_description=r->>'job_description',
      employment_type=r->>'employment_type',source_metadata=r->'source_metadata',jobg8_payload_hash=md5(r::text),
      jobg8_sell_price=(r->>'jobg8_sell_price')::numeric,jobg8_sell_price_currency=r->>'jobg8_sell_price_currency',
      jobg8_revenue_type=r->>'jobg8_revenue_type',jobg8_job_type=r->>'jobg8_job_type',
      search_text=lower(concat_ws(' ',r->>'job_title',r->>'company',r->>'location')) where id=old.id;
     nu:=nu+1;
    end if;
   else
    insert into public.pre_scraped_jobs(source,source_listing_id,country,job_title,company,location,state_code,canonical_role,category,salary,apply_url,job_description,
     employment_type,source_metadata,posted_at,scraped_at,fetched_at,last_seen_at,search_text,jobg8_payload_hash,
     jobg8_sell_price,jobg8_sell_price_currency,jobg8_revenue_type,jobg8_job_type,closed_at)
    values('jobg8',rec.ref,'us',r->>'job_title',r->>'company',r->>'location',r->>'state_code',r->>'canonical_role',r->>'category',r->>'salary',r->>'apply_url',r->>'job_description',
     r->>'employment_type',r->'source_metadata',stamp,stamp,stamp,stamp,lower(concat_ws(' ',r->>'job_title',r->>'company',r->>'location')),md5(r::text),
     (r->>'jobg8_sell_price')::numeric,r->>'jobg8_sell_price_currency',r->>'jobg8_revenue_type',r->>'jobg8_job_type',case when qa then stamp else null end);
    ni:=ni+1;
   end if;
  exception when unique_violation then nc:=nc+1; -- Never take over another source's apply URL.
  end;
  update public.jobg8_staging set published=true where run_id=p_run and ref=rec.ref;
 end loop;
 update public.ingest_runs set inserted=inserted+ni,updated=updated+nu,rejected=rejected||jsonb_build_object('conflicts',coalesce((rejected->>'conflicts')::integer,0)+nc) where id=p_run;
 return jsonb_build_object('processed',n,'after',last_ref,'inserted',ni,'updated',nu,'conflicts',nc);
end $$;

create function public.jobg8_finish(p_run bigint,p_token uuid,p_modified text,p_ok boolean,p_note text default null) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer:=0;
begin
 perform public.jobg8_assert(p_run,p_token);
 if p_ok and (select ready from public.jobg8_feed_state where singleton) then
  -- Close only after the entire valid archive has been parsed and every batch published.
  if exists(select 1 from public.jobg8_staging where run_id=p_run and not published) then raise exception 'unpublished_jobs'; end if;
  update public.pre_scraped_jobs set closed_at=clock_timestamp() where source='jobg8' and closed_at is null
   and not exists(select 1 from public.jobg8_staging where run_id=p_run and ref=source_listing_id);
  get diagnostics n=row_count;
  update public.jobg8_feed_state set last_modified=p_modified where singleton;
 end if;
 update public.ingest_runs set status=case when p_ok then 'succeeded' else 'failed' end,finished_at=clock_timestamp(),closed=n,note=left(p_note,100) where id=p_run;
 delete from public.jobg8_staging where run_id=p_run;
 update public.jobg8_feed_state set token=null,lease_until=null,run_id=null,ready=false where singleton;
 return n;
end $$;

revoke all on function public.jobg8_start(text),public.jobg8_assert(bigint,uuid),public.jobg8_get(bigint,uuid),
 public.jobg8_stage(bigint,uuid,jsonb),public.jobg8_ready(bigint,uuid),public.jobg8_publish(bigint,uuid,text),public.jobg8_finish(bigint,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.jobg8_start(text),public.jobg8_get(bigint,uuid),public.jobg8_stage(bigint,uuid,jsonb),
 public.jobg8_ready(bigint,uuid),public.jobg8_publish(bigint,uuid,text),public.jobg8_finish(bigint,uuid,text,boolean,text) to service_role;
grant execute on function public.log_partner_click(text,text,text,text,text,text) to service_role;
commit;
