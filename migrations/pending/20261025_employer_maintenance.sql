-- Private, bounded maintenance. Installation never purges anything.
-- Cleanup remains disabled; scheduled calls must use p_apply=false.
begin;
set local lock_timeout='5s';
create table public.employer_maintenance_control (
  id boolean primary key default true check(id),
  cleanup_enabled boolean not null default false,
  installed_at timestamptz not null default clock_timestamp(),
  last_checked_at timestamptz,
  last_cleanup_at timestamptz,
  last_status text,
  last_report jsonb,
  last_failure_at timestamptz
);
insert into public.employer_maintenance_control(id) values(true);
alter table public.employer_maintenance_control enable row level security;
revoke all on public.employer_maintenance_control from public,anon,authenticated;
grant select,insert,update on public.employer_maintenance_control to service_role;
create index employer_feed_runs_retention_idx on public.employer_feed_runs(finished_at,id) where status<>'collecting';

-- Internal predicate, not an RPC: never return permission snapshots or payloads.
create function public.employer_maintenance_candidates(p_at timestamptz,p_limit integer)
returns table(id uuid,source_id text,finished_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
  select r.id,r.source_id,r.finished_at from employer_feed_runs r
  where r.status<>'collecting' and r.finished_at<p_at-interval '7 days'
    and (r.source_snapshot<>'{}'::jsonb or exists(select 1 from employer_feed_staging st where st.run_id=r.id)
      or r.finished_at<p_at-interval '30 days')
    and not exists(select 1 from employer_feed_candidate_checkpoints ck where ck.last_run_id=r.id)
    and not exists(select 1 from employer_feed_leases l where l.source_id=r.source_id and l.expires_at>p_at)
    and not exists(select 1 from employer_refresh_control ctl join employer_refresh_attempts a on a.id=ctl.active_ticket
      where a.source_id=r.source_id and a.status='claimed')
  order by r.finished_at,r.id limit p_limit;
$$;
revoke all on function public.employer_maintenance_candidates(timestamptz,integer) from public,anon,authenticated,service_role;

create function public.employer_maintenance_plan(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare at_time timestamptz:=clock_timestamp(); report jsonb;
begin
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'invalid_limit'; end if;
  with eligible as materialized (select * from employer_maintenance_candidates(at_time,p_limit)),
    payloads as (select 1 from employer_feed_staging st join eligible e on e.id=st.run_id limit 1000)
  select jsonb_build_object('run_limit',p_limit,'payload_limit',1000,'payload_days',7,'summary_days',30,
    'payloads_eligible',(select count(*) from payloads),
    'snapshots_eligible',(select count(*) from eligible e join employer_feed_runs r on r.id=e.id where r.source_snapshot<>'{}'::jsonb),
    'runs_eligible',(select count(*) from eligible where finished_at<at_time-interval '30 days'),
    'protected_current_runs',(select count(*) from employer_feed_runs r where r.finished_at<at_time-interval '7 days'
      and exists(select 1 from employer_feed_candidate_checkpoints ck where ck.last_run_id=r.id)),
    'stale_collecting_runs',(select count(*) from employer_feed_runs r where r.status='collecting' and r.lease_expires_at<at_time-interval '1 day')) into report;
  return report;
end $$;

create function public.employer_maintenance_run(p_apply boolean default false,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctl public.employer_maintenance_control; refresh public.employer_refresh_control;
  at_time timestamptz:=clock_timestamp(); report jsonb; candidate record; locked_run employer_feed_runs;
  payloads integer:=0; snapshots integer:=0; runs integer:=0; leases integer:=0; changed integer;
begin
  if p_apply is null or p_limit is null or p_limit<1 or p_limit>50 then raise exception 'invalid_request'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('fortunejobsai/employer-maintenance/v1',0)) then
    return jsonb_build_object('status','busy'); end if;
  select * into ctl from employer_maintenance_control where id for update;
  if p_apply and not ctl.cleanup_enabled then return jsonb_build_object('status','blocked','reason','cleanup_not_approved'); end if;
  begin
    report:=employer_maintenance_plan(p_limit);
    if p_apply then
      -- Coordinator control -> lease -> run, matching the worker's lock order.
      -- Never compete with an admitted refresh or change any admission state.
      select * into refresh from employer_refresh_control where id for update;
      if refresh.active_ticket is not null then return jsonb_build_object('status','busy','reason','refresh_in_progress'); end if;
      for candidate in select * from employer_maintenance_candidates(at_time,p_limit) loop
        perform 1 from employer_feed_leases where source_id=candidate.source_id for update skip locked;
        if exists(select 1 from employer_feed_leases where source_id=candidate.source_id)
          and not found then continue; end if;
        select * into locked_run from employer_feed_runs where id=candidate.id for update skip locked;
        if not found then continue; end if;
        -- Repeat eligibility AFTER locks; a source may have staged a newer batch.
        if locked_run.status='collecting' or locked_run.finished_at>=at_time-interval '7 days'
          or exists(select 1 from employer_feed_candidate_checkpoints where last_run_id=locked_run.id)
          or exists(select 1 from employer_feed_leases where source_id=locked_run.source_id and expires_at>clock_timestamp())
          then continue; end if;
        if payloads<1000 then
          delete from employer_feed_staging where (run_id,source_listing_id) in (
            select st.run_id,st.source_listing_id from employer_feed_staging st where st.run_id=locked_run.id
              order by st.source_listing_id limit (1000-payloads));
          get diagnostics changed=row_count;payloads:=payloads+changed;
        end if;
        if locked_run.source_snapshot<>'{}'::jsonb then
          update employer_feed_runs set source_snapshot='{}'::jsonb where id=locked_run.id;
          snapshots:=snapshots+1;
        end if;
        if locked_run.finished_at<at_time-interval '30 days' and not exists(select 1 from employer_feed_staging where run_id=locked_run.id) then
          delete from employer_feed_leases where run_id=locked_run.id and expires_at<at_time-interval '7 days';
          get diagnostics changed=row_count;leases:=leases+changed;
          delete from employer_feed_runs where id=locked_run.id;
          runs:=runs+1;
        end if;
      end loop;
    end if;
    report:=report||jsonb_build_object('status',case when p_apply then 'cleaned' else 'dry_run' end,
      'payloads_removed',payloads,'snapshots_cleared',snapshots,'runs_removed',runs,'leases_removed',leases);
    update employer_maintenance_control set last_checked_at=clock_timestamp(),last_status=report->>'status',last_report=report,
      last_cleanup_at=case when p_apply then clock_timestamp() else last_cleanup_at end where id;
    return report;
  exception when others then
    -- The subtransaction rolls back every cleanup mutation before failure is logged.
    update employer_maintenance_control set last_status='failed',last_failure_at=clock_timestamp(),
      last_report=jsonb_build_object('status','failed','reason','maintenance_failed') where id;
    return jsonb_build_object('status','failed','reason','maintenance_failed');
  end;
end $$;

create function public.employer_maintenance_health()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare ctl public.employer_maintenance_control; cron_active boolean:=false; cron_status text; cron_at timestamptz;
  overdue boolean; plan jsonb;
begin
  select * into ctl from employer_maintenance_control where id;
  if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
    execute $q$select j.active,d.status,d.end_time from cron.job j
      left join lateral (select status,end_time from cron.job_run_details where jobid=j.jobid order by runid desc limit 1) d on true
      where j.jobname='fortunejobsai-employer-maintenance-dry-run' and j.database=current_database() and j.username=current_user$q$
      into cron_active,cron_status,cron_at;
  end if;
  plan:=employer_maintenance_plan(25);
  overdue:=coalesce(ctl.last_checked_at,ctl.installed_at)<clock_timestamp()-interval '36 hours';
  return jsonb_build_object('cleanup_enabled',ctl.cleanup_enabled,'last_checked_at',ctl.last_checked_at,
    'last_cleanup_at',ctl.last_cleanup_at,'last_status',ctl.last_status,'last_failure_at',ctl.last_failure_at,
    'overdue',overdue,'schedule_active',coalesce(cron_active,false),'last_cron_status',cron_status,'last_cron_finished_at',cron_at,
    'attention_required',overdue or coalesce(ctl.last_status='failed',false) or coalesce(cron_status='failed',false)
      or (plan->>'stale_collecting_runs')::integer>0 or (plan->>'protected_current_runs')::integer>0,
    'plan',plan);
end $$;

-- Existing private callers can no longer bypass the new approval gate with the
-- old unbounded entry point. The signature and service-only ACL are preserved.
create or replace function public.employer_feed_run_prune()
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select employer_maintenance_run(true,25);
$$;
revoke all on function public.employer_maintenance_plan(integer),public.employer_maintenance_run(boolean,integer),
  public.employer_maintenance_health() from public,anon,authenticated;
grant execute on function public.employer_maintenance_plan(integer),public.employer_maintenance_run(boolean,integer),
  public.employer_maintenance_health() to service_role;
notify pgrst,'reload schema';
commit;
