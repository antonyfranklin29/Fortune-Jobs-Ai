-- Backend-only private staging. Does not publish, close or alter catalogue jobs.
-- Independent of Claude's registry schema; the worker loads that registry through
-- employer_feed_source_snapshot(text). Publication must revalidate it separately.
begin;

create table if not exists public.employer_feed_runs (
  id uuid primary key,
  source_id text not null check (source_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  source_revision bigint not null check (source_revision > 0),
  source_snapshot jsonb not null,
  status text not null check (status in ('collecting','staged','partial','failed','expired')),
  started_at timestamptz not null default clock_timestamp(),
  lease_expires_at timestamptz not null,
  finished_at timestamptz,
  accepted integer not null default 0 check (accepted between 0 and 500),
  summary jsonb not null default '{}'::jsonb,
  failure_reason text
);
create index if not exists employer_feed_runs_source_idx on public.employer_feed_runs(source_id, started_at desc);

create table if not exists public.employer_feed_leases (
  source_id text primary key,
  run_id uuid not null,
  token uuid not null,
  expires_at timestamptz not null
);
create table if not exists public.employer_feed_staging (
  run_id uuid not null references public.employer_feed_runs(id) on delete cascade,
  source_listing_id text not null,
  payload jsonb not null,
  primary key (run_id, source_listing_id)
);

alter table public.employer_feed_runs enable row level security;
alter table public.employer_feed_leases enable row level security;
alter table public.employer_feed_staging enable row level security;
revoke all on public.employer_feed_runs, public.employer_feed_leases, public.employer_feed_staging from public, anon, authenticated;
grant select, insert, update, delete on public.employer_feed_runs, public.employer_feed_leases, public.employer_feed_staging to service_role;

create or replace function public.employer_feed_run_begin(
  p_source_id text, p_revision bigint, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_run uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
  v_expiry timestamptz;
  v_claim uuid;
begin
  if p_source_id is null or p_source_id !~ '^[a-zA-Z0-9_-]{1,100}$' or p_revision is null or p_revision < 1
     or jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text) > 16384
     or (p_snapshot->>'id') is distinct from p_source_id
     or (p_snapshot->>'status') is distinct from 'approved'
     or (p_snapshot->'enabled') is distinct from 'true'::jsonb then
    return jsonb_build_object('status','rejected','reason','invalid_snapshot');
  end if;
  begin
    v_expiry := least(clock_timestamp() + interval '180 seconds',
      (p_snapshot->>'authorization_expires_at')::timestamptz);
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('status','rejected','reason','invalid_snapshot');
  end;
  if p_snapshot->>'authorization_expires_at' is null or v_expiry <= clock_timestamp() then
    return jsonb_build_object('status','rejected','reason','source_not_approved');
  end if;

  -- ON CONFLICT locks the one source row. A competing caller can replace the
  -- lease only after expiry; never use a read-count-then-insert admission check.
  insert into public.employer_feed_leases(source_id,run_id,token,expires_at)
    values(p_source_id,v_run,v_token,v_expiry)
  on conflict(source_id) do update
    set run_id=excluded.run_id, token=excluded.token, expires_at=excluded.expires_at
    where employer_feed_leases.expires_at <= clock_timestamp()
  returning run_id into v_claim;
  if v_claim is null then return jsonb_build_object('status','busy'); end if;

  update public.employer_feed_runs set status='expired',finished_at=clock_timestamp()
    where source_id=p_source_id and status='collecting' and lease_expires_at <= clock_timestamp();
  insert into public.employer_feed_runs(id,source_id,source_revision,source_snapshot,status,lease_expires_at)
    values(v_run,p_source_id,p_revision,p_snapshot,'collecting',v_expiry);
  return jsonb_build_object('status','claimed','run_id',v_run,'lease_token',v_token,'expires_at',v_expiry);
end $$;

create or replace function public.employer_feed_run_stage(
  p_run_id uuid, p_token uuid, p_revision bigint, p_rows jsonb, p_summary jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run record; v_n integer; v_status text;
begin
  select r.*, l.expires_at as current_expiry into v_run
    from public.employer_feed_runs r join public.employer_feed_leases l on l.source_id=r.source_id
    where r.id=p_run_id and l.run_id=r.id and l.token=p_token
    for update of r,l;
  if not found or v_run.source_revision is distinct from p_revision then
    return jsonb_build_object('status','rejected','reason','stale_lease');
  end if;
  if v_run.status in ('staged','partial') then
    return jsonb_build_object('status','already_staged','accepted',v_run.accepted);
  end if;
  if v_run.status <> 'collecting' or v_run.current_expiry <= clock_timestamp() then
    return jsonb_build_object('status','rejected','reason','stale_lease');
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or octet_length(p_rows::text) > 4194304
     or jsonb_typeof(p_summary) is distinct from 'object' or octet_length(p_summary::text) > 8192 then
    return jsonb_build_object('status','rejected','reason','invalid_batch');
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 500 or jsonb_typeof(p_summary->'enumeration_complete') is distinct from 'boolean'
     or p_summary->>'source_id' is distinct from v_run.source_id
     or p_summary->>'source_revision' is distinct from p_revision::text
     or p_summary->>'accepted' is distinct from v_n::text
     or coalesce(p_summary->>'requests_used','') !~ '^[1-6]$'
     or (case when coalesce(p_summary->>'received','') ~ '^[0-9]{1,3}$'
          then (p_summary->>'received')::integer not between v_n and 500 else true end)
     or jsonb_typeof(p_summary->'rejected') is distinct from 'object'
     or exists(select 1 from jsonb_array_elements(p_rows) x
       where jsonb_typeof(x) is distinct from 'object'
          or x->>'source' is distinct from 'employer_feed'
          or x->>'employer_source_id' is distinct from v_run.source_id
          or coalesce(x->>'source_listing_id','') !~ ('^' || v_run.source_id || ':[a-zA-Z0-9_-]{1,100}$'))
     or (select count(distinct x->>'source_listing_id') from jsonb_array_elements(p_rows) x) <> v_n then
    return jsonb_build_object('status','rejected','reason','invalid_batch');
  end if;
  insert into public.employer_feed_staging(run_id,source_listing_id,payload)
    select p_run_id,x->>'source_listing_id',x from jsonb_array_elements(p_rows) x;
  v_status := case when p_summary->'enumeration_complete'='true'::jsonb then 'staged' else 'partial' end;
  update public.employer_feed_runs set status=v_status,accepted=v_n,summary=p_summary,finished_at=clock_timestamp()
    where id=p_run_id;
  update public.employer_feed_leases set expires_at=clock_timestamp()
    where source_id=v_run.source_id and run_id=p_run_id and token=p_token;
  return jsonb_build_object('status',v_status,'accepted',v_n);
end $$;

create or replace function public.employer_feed_run_fail(p_run_id uuid,p_token uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source text;
begin
  if p_reason is null or p_reason !~ '^[a-z_]{1,64}$' then
    return jsonb_build_object('status','rejected','reason','invalid_reason');
  end if;
  select r.source_id into v_source from public.employer_feed_runs r
    join public.employer_feed_leases l on l.source_id=r.source_id
    where r.id=p_run_id and l.run_id=r.id and l.token=p_token and r.status='collecting'
    for update of r,l;
  if not found then return jsonb_build_object('status','rejected','reason','stale_lease'); end if;
  update public.employer_feed_runs set status='failed',failure_reason=p_reason,finished_at=clock_timestamp() where id=p_run_id;
  update public.employer_feed_leases set expires_at=clock_timestamp()
    where source_id=v_source and run_id=p_run_id and token=p_token;
  return jsonb_build_object('status','failed');
end $$;

-- Call daily from an authorized backend job after deployment. Fixed retention:
-- payloads/config snapshots 7 days; aggregate run records 30 days. Never touches
-- catalogue jobs, permission evidence in the registry, or employer accounts.
create or replace function public.employer_feed_run_prune()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n_payloads integer; n_runs integer;
begin
  update public.employer_feed_runs set status='expired',finished_at=clock_timestamp()
    where status='collecting' and lease_expires_at <= clock_timestamp();
  delete from public.employer_feed_staging s using public.employer_feed_runs r
    where r.id=s.run_id and r.status <> 'collecting' and r.finished_at < clock_timestamp()-interval '7 days';
  get diagnostics n_payloads = row_count;
  update public.employer_feed_runs set source_snapshot='{}'::jsonb
    where status <> 'collecting' and finished_at < clock_timestamp()-interval '7 days' and source_snapshot <> '{}'::jsonb;
  delete from public.employer_feed_leases where expires_at < clock_timestamp()-interval '7 days';
  delete from public.employer_feed_runs
    where status <> 'collecting' and finished_at < clock_timestamp()-interval '30 days';
  get diagnostics n_runs = row_count;
  return jsonb_build_object('payloads_removed',n_payloads,'runs_removed',n_runs);
end $$;

revoke all on function public.employer_feed_run_begin(text,bigint,jsonb),
  public.employer_feed_run_stage(uuid,uuid,bigint,jsonb,jsonb),
  public.employer_feed_run_fail(uuid,uuid,text),public.employer_feed_run_prune() from public,anon,authenticated;
grant execute on function public.employer_feed_run_begin(text,bigint,jsonb),
  public.employer_feed_run_stage(uuid,uuid,bigint,jsonb,jsonb),
  public.employer_feed_run_fail(uuid,uuid,text),public.employer_feed_run_prune() to service_role;
commit;
