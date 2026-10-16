-- PENDING: apply after both 20261016 employer migrations. Private candidates
-- only; no public publishing, account entitlement or catalogue mutation here.
begin;
create table if not exists public.employer_feed_candidate_checkpoints (
  source_id text primary key references public.employer_sources(id) on delete cascade,
  last_run_id uuid not null,
  last_started_at timestamptz not null
);
alter table public.employer_feed_candidate_checkpoints enable row level security;
revoke all on public.employer_feed_candidate_checkpoints from public,anon,authenticated;
grant select,insert,update,delete on public.employer_feed_candidate_checkpoints to service_role;

create or replace function public.employer_feed_stage_registered_run(
  p_run_id uuid,p_token uuid,p_revision bigint,p_rows jsonb,p_summary jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.employer_feed_runs; source_org uuid; current_source jsonb; staged jsonb; n integer;
begin
  select * into r from public.employer_feed_runs where id=p_run_id;
  if not found then return jsonb_build_object('status','rejected','reason','stale_lease'); end if;
  select org_id into source_org from public.employer_sources where id=r.source_id;
  if source_org is null then return jsonb_build_object('status','rejected','reason','source_not_approved'); end if;
  -- Same organisation -> source order as Claude's source publication path.
  perform public.employer_lock_org(source_org);
  perform 1 from public.employer_sources where id=r.source_id for update;
  current_source := public.employer_source_for_worker(r.source_id);
  if current_source is null or current_source->>'revision' is distinct from p_revision::text
     or current_source->'source' is distinct from r.source_snapshot then
    return jsonb_build_object('status','rejected','reason','source_changed');
  end if;
  if exists(select 1 from public.employer_feed_candidate_checkpoints c
      where c.source_id=r.source_id and c.last_run_id<>r.id and c.last_started_at>=r.started_at) then
    return jsonb_build_object('status','rejected','reason','stale_batch');
  end if;
  staged := public.employer_feed_run_stage(p_run_id,p_token,p_revision,p_rows,p_summary);
  if staged->>'status' not in ('staged','partial','already_staged') then return staged; end if;
  -- The immutable stored batch is the source of truth even on a repeated call.
  if r.summary ? 'candidates_promoted' then
    return staged || jsonb_build_object('candidates_promoted',(r.summary->>'candidates_promoted')::integer);
  end if;
  n := public.employer_stage_feed_candidates(r.source_id,p_revision::integer,
    coalesce((select jsonb_agg(payload order by source_listing_id) from public.employer_feed_staging where run_id=p_run_id),'[]'::jsonb));
  update public.employer_feed_runs set summary=summary||jsonb_build_object('candidates_promoted',n) where id=p_run_id;
  insert into public.employer_feed_candidate_checkpoints(source_id,last_run_id,last_started_at)
    values(r.source_id,r.id,r.started_at)
    on conflict(source_id) do update set last_run_id=excluded.last_run_id,last_started_at=excluded.last_started_at;
  return staged || jsonb_build_object('candidates_promoted',n);
end $$;
revoke all on function public.employer_feed_stage_registered_run(uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.employer_feed_stage_registered_run(uuid,uuid,bigint,jsonb,jsonb) to service_role;
commit;
