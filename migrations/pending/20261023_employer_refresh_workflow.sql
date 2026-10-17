-- Additive upgrade after 20261022. Disabled on installation; no provider calls,
-- reviewer grants, company records, catalogue changes or paid access are enabled.
begin;
set local lock_timeout='5s';
create table public.employer_refresh_control (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  max_requests integer not null default 6 check(max_requests between 1 and 6),
  active_ticket uuid,
  lease_until timestamptz
);
insert into public.employer_refresh_control(id) values(true);
create table public.employer_refresh_schedule (
  source_id text primary key references public.employer_sources(id) on delete cascade,
  next_due_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  failures integer not null default 0 check(failures>=0),
  empty_revision bigint,
  empty_seen_at timestamptz
);
create table public.employer_refresh_attempts (
  id uuid primary key,
  source_id text not null references public.employer_sources(id) on delete cascade,
  started_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz not null,
  finished_at timestamptz,
  run_id uuid references public.employer_feed_runs(id) on delete set null,
  status text not null check(status in ('claimed','complete','partial','degraded','failed','expired')),
  reason text,
  result jsonb
);
create index employer_refresh_attempts_recent on public.employer_refresh_attempts(started_at desc);
alter table public.employer_refresh_control enable row level security;
alter table public.employer_refresh_schedule enable row level security;
alter table public.employer_refresh_attempts enable row level security;
revoke all on public.employer_refresh_control,public.employer_refresh_schedule,public.employer_refresh_attempts from public,anon,authenticated;
grant select,insert,update,delete on public.employer_refresh_control,public.employer_refresh_schedule,public.employer_refresh_attempts to service_role;

create function public.employer_refresh_claim(p_source text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctl public.employer_refresh_control; sid text; ticket uuid:=gen_random_uuid(); until_at timestamptz;
begin
  if p_source is not null and p_source !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'invalid_source'; end if;
  select * into ctl from public.employer_refresh_control where id for update;
  if not ctl.enabled then return jsonb_build_object('status','disabled'); end if;
  if ctl.lease_until>clock_timestamp() then return jsonb_build_object('status','busy'); end if;
  update public.employer_refresh_attempts set status='expired',reason='lease_expired',finished_at=clock_timestamp()
    where id=ctl.active_ticket and status='claimed';
  update public.employer_refresh_schedule set empty_seen_at=null,empty_revision=null
    where source_id=(select source_id from public.employer_refresh_attempts where id=ctl.active_ticket and status='expired');
  delete from public.employer_refresh_attempts where id in (select id from public.employer_refresh_attempts
    where started_at<clock_timestamp()-interval '30 days' and status<>'claimed' order by started_at limit 1000);
  update public.employer_refresh_control set active_ticket=null,lease_until=null where id;
  -- Registry eligibility is checked again by collection, staging and settlement.
  -- A revoked source cannot become publishable merely by having a schedule row.
  select s.id into sid from public.employer_sources s
    left join public.employer_refresh_schedule d on d.source_id=s.id
    where (p_source is null or s.id=p_source)
      and coalesce(d.next_due_at,'-infinity'::timestamptz)<=clock_timestamp()
      and public.employer_source_for_worker(s.id) is not null
    order by coalesce(d.last_attempt_at,'-infinity'::timestamptz),s.id limit 1;
  if sid is null then return jsonb_build_object('status','idle'); end if;
  until_at:=clock_timestamp()+interval '180 seconds';
  insert into public.employer_refresh_schedule(source_id,last_attempt_at,next_due_at)
    values(sid,clock_timestamp(),until_at+interval '15 minutes')
    on conflict(source_id) do update set last_attempt_at=excluded.last_attempt_at,next_due_at=excluded.next_due_at;
  insert into public.employer_refresh_attempts(id,source_id,lease_until,status) values(ticket,sid,until_at,'claimed');
  update public.employer_refresh_control set active_ticket=ticket,lease_until=until_at where id;
  return jsonb_build_object('status','claimed','ticket',ticket,'source_id',sid,'max_requests',ctl.max_requests);
end $$;

create function public.employer_refresh_fail(p_ticket uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.employer_refresh_attempts; v_result jsonb;
begin
  if p_reason is null or p_reason !~ '^[a-z_]{1,64}$' then raise exception 'invalid_reason'; end if;
  perform 1 from public.employer_refresh_control where id for update;
  select * into a from public.employer_refresh_attempts where id=p_ticket for update;
  if not found then return jsonb_build_object('status','rejected','reason','unknown_ticket'); end if;
  if a.status<>'claimed' then return coalesce(a.result,jsonb_build_object('status',a.status)); end if;
  v_result:=jsonb_build_object('status','failed','reason',p_reason,'published',0,'closed',0);
  update public.employer_refresh_attempts set status='failed',reason=p_reason,result=v_result,finished_at=clock_timestamp() where id=p_ticket;
  update public.employer_refresh_schedule set failures=least(failures+1,1000),
    empty_seen_at=null,empty_revision=null,
    next_due_at=clock_timestamp()+make_interval(mins=>least(360,15*(1<<least(failures,5)))) where source_id=a.source_id;
  update public.employer_refresh_control set active_ticket=null,lease_until=null where id and active_ticket=p_ticket;
  return v_result;
end $$;

create function public.employer_refresh_finish(p_ticket uuid,p_run uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctl public.employer_refresh_control; a public.employer_refresh_attempts; r public.employer_feed_runs;
  d public.employer_refresh_schedule; s public.employer_sources; current_source jsonb;
  clean boolean; reconcile boolean; ids text[]; closed_count integer:=0; pub jsonb; outcome text; v_result jsonb;
begin
  -- Global coordinator -> organisation -> source -> lease -> run -> candidates.
  -- Existing publishers/revocation use the same organisation-first order.
  select * into ctl from public.employer_refresh_control where id for update;
  select * into a from public.employer_refresh_attempts where id=p_ticket for update;
  if not found then raise exception 'unknown_ticket'; end if;
  if a.status<>'claimed' then return coalesce(a.result,jsonb_build_object('status',a.status)); end if;
  if not ctl.enabled or ctl.active_ticket is distinct from p_ticket or a.lease_until<=clock_timestamp() then raise exception 'stale_ticket'; end if;
  select * into s from public.employer_sources where id=a.source_id;
  if not found then raise exception 'source_changed'; end if;
  perform public.employer_lock_org(s.org_id);
  select * into s from public.employer_sources where id=a.source_id for update;
  perform 1 from public.employer_feed_leases where source_id=s.id for update;
  select * into r from public.employer_feed_runs where id=p_run for update;
  current_source:=public.employer_source_for_worker(s.id);
  if r.id is null or r.source_id<>s.id or r.status not in ('staged','partial')
    or r.started_at<a.started_at or r.finished_at is null
    or current_source is null or current_source->>'revision' is distinct from r.source_revision::text
    or current_source->'source' is distinct from r.source_snapshot
    or not exists(select 1 from public.employer_feed_candidate_checkpoints where source_id=s.id and last_run_id=r.id)
    or not exists(select 1 from public.employer_feed_leases where source_id=s.id and run_id=r.id)
    then raise exception 'stale_batch'; end if;
  perform 1 from public.employer_feed_candidates where source_id=s.id order by provider_post_id for update;
  -- Fence AFTER all potentially blocking locks, using wall clock rather than tx time.
  if a.lease_until<=clock_timestamp() then raise exception 'stale_ticket'; end if;
  if exists(select 1 from public.employer_feed_staging st
    left join public.employer_feed_candidates c on c.source_id=s.id and s.id||':'||c.provider_post_id=st.source_listing_id
    where st.run_id=r.id and (c.provider_post_id is null or c.revision<>r.source_revision or c.payload<>st.payload))
    or (select count(*) from public.employer_feed_staging where run_id=r.id)<>r.accepted
    then raise exception 'candidate_batch_changed'; end if;
  clean:=r.status='staged' and r.summary->>'enumeration_complete'='true'
    and r.summary->'rejected'='{}'::jsonb and (r.summary->>'received')::integer=r.accepted;
  reconcile:=clean;
  select * into d from public.employer_refresh_schedule where source_id=s.id for update;
  -- Two clean empty enumerations, >=5 minutes apart, under the same permission.
  if clean and r.accepted=0 then
    reconcile:=d.empty_revision=r.source_revision and d.empty_seen_at<=clock_timestamp()-interval '5 minutes';
    update public.employer_refresh_schedule set empty_revision=r.source_revision,
      empty_seen_at=case when empty_revision=r.source_revision then coalesce(empty_seen_at,clock_timestamp()) else clock_timestamp() end
      where source_id=s.id;
  else
    update public.employer_refresh_schedule set empty_revision=null,empty_seen_at=null where source_id=s.id;
  end if;
  if coalesce(reconcile,false) then
    update public.pre_scraped_jobs j set closed_at=clock_timestamp()
      where j.source='employer_feed' and j.employer_source_id=s.id and j.employer_org_id=s.org_id and j.closed_at is null
      and not exists(select 1 from public.employer_feed_staging st
        join public.employer_feed_candidates c on c.source_id=s.id and s.id||':'||c.provider_post_id=st.source_listing_id and c.selected
        where st.run_id=r.id and j.source_listing_id=st.source_listing_id);
    get diagnostics closed_count=row_count;
  end if;
  select coalesce(array_agg(c.provider_post_id order by c.provider_post_id),array[]::text[]) into ids
    from public.employer_feed_candidates c join public.employer_feed_staging st
      on st.run_id=r.id and st.source_listing_id=s.id||':'||c.provider_post_id
    where c.source_id=s.id and c.selected and c.revision=r.source_revision;
  -- Same transaction as closure: an unexpected publisher error rolls everything back.
  pub:=public.employer_publish_feed_jobs(s.id,r.source_revision::integer,ids);
  outcome:=case when r.status='partial' then 'partial'
    when not clean or (r.accepted=0 and not coalesce(reconcile,false)) or jsonb_array_length(pub->'skipped')>0 then 'degraded'
    else 'complete' end;
  v_result:=jsonb_build_object('status',outcome,'run_id',r.id,'accepted',r.accepted,
    'requests_used',r.summary->'requests_used','published',pub->'published','updated',pub->'updated',
    'blocked_quota',pub->'blocked_quota','skipped',jsonb_array_length(pub->'skipped'),'closed',closed_count,
    'reconciled',coalesce(reconcile,false),'reason',case when clean and r.accepted=0 and not coalesce(reconcile,false) then 'empty_confirmation_required' end);
  update public.employer_refresh_attempts set status=outcome,run_id=r.id,finished_at=clock_timestamp(),result=v_result where id=p_ticket;
  update public.employer_refresh_schedule set failures=case when outcome='complete' then 0 else least(failures+1,1000) end,
    last_success_at=case when outcome='complete' then clock_timestamp() else last_success_at end,
    next_due_at=clock_timestamp()+case when outcome='complete' then interval '6 hours' else interval '15 minutes' end where source_id=s.id;
  update public.employer_refresh_control set active_ticket=null,lease_until=null where id;
  perform public.employer_audit_log(null,'service',s.org_id,'source',s.id,'feed_refreshed',v_result);
  return v_result;
end $$;

create function public.employer_refresh_health()
returns jsonb language sql security definer set search_path=public,pg_temp as $$
select jsonb_build_object('enabled',c.enabled,'busy',coalesce(c.lease_until>clock_timestamp(),false),
  'expired_claim',c.active_ticket is not null and c.lease_until<=clock_timestamp(),
  'eligible_sources',(select count(*) from employer_sources s where employer_source_for_worker(s.id) is not null),
  'overdue_sources',(select count(*) from employer_sources s left join employer_refresh_schedule d on d.source_id=s.id
     where employer_source_for_worker(s.id) is not null and coalesce(d.next_due_at,'-infinity')<clock_timestamp()-interval '1 hour'),
  'failed_24h',(select count(*) from employer_refresh_attempts where started_at>clock_timestamp()-interval '24 hours' and status in ('failed','expired')),
  'degraded_24h',(select count(*) from employer_refresh_attempts where started_at>clock_timestamp()-interval '24 hours' and status in ('partial','degraded')),
  'last_success_at',(select max(last_success_at) from employer_refresh_schedule)) from employer_refresh_control c where c.id;
$$;

-- A new choice wakes the existing queue; it does not itself bypass publisher checks.
create function public.employer_refresh_selection_changed()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.selected is distinct from old.selected then
    insert into public.employer_refresh_schedule(source_id,next_due_at) values(new.source_id,clock_timestamp())
      on conflict(source_id) do update set next_due_at=least(employer_refresh_schedule.next_due_at,
        greatest(clock_timestamp(),coalesce(employer_refresh_schedule.last_attempt_at,'-infinity')+interval '5 minutes'));
  end if;
  return new;
end $$;
create trigger employer_refresh_selection_changed after update of selected on public.employer_feed_candidates
  for each row execute function public.employer_refresh_selection_changed();

-- Existing toggle callers and the new atomic chooser share publication's org
-- lock. Acquire the acting auth row first, matching account deletion lock order.
create or replace function public.employer_select_feed_jobs(p_source text,p_ids text[],p_selected boolean)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=public.employer_caller(); org uuid; n integer;
begin
  if p_ids is null or cardinality(p_ids)>500 or p_selected is null then raise exception 'invalid_ids'; end if;
  perform public.employer_lock_actor(u);
  select org_id into org from employer_sources where id=p_source;
  if org is null then raise exception 'source_not_found'; end if;
  perform public.employer_lock_org(org);
  if not public.employer_is_member(org,u) then raise exception 'source_not_found'; end if;
  update employer_feed_candidates set selected=p_selected,selected_by=u,selected_at=clock_timestamp()
    where source_id=p_source and provider_post_id=any(p_ids);
  get diagnostics n=row_count;
  perform public.employer_audit_log(u,'employer',org,'source',p_source,case when p_selected then 'selected' else 'deselected' end,jsonb_build_object('count',n));
  return n;
end $$;

create function public.employer_replace_feed_selection(p_source text,p_ids text[])
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=public.employer_caller(); org uuid; n integer;
begin
  if p_ids is null or cardinality(p_ids)>500 or exists(select 1 from unnest(p_ids) x where x is null or x !~ '^[a-zA-Z0-9_-]{1,120}$')
    then raise exception 'invalid_ids'; end if;
  perform public.employer_lock_actor(u);
  select org_id into org from employer_sources where id=p_source;
  if org is null then raise exception 'source_not_found'; end if;
  perform public.employer_lock_org(org);
  if not public.employer_is_member(org,u) then raise exception 'source_not_found'; end if;
  if public.employer_source_for_worker(p_source) is null then raise exception 'source_not_publishable'; end if;
  if exists(select 1 from unnest(p_ids) x where not exists(
    select 1 from employer_feed_candidates c join employer_sources s on s.id=c.source_id and s.revision=c.revision
      join employer_feed_candidate_checkpoints ck on ck.source_id=s.id
      join employer_feed_staging st on st.run_id=ck.last_run_id and st.source_listing_id=s.id||':'||c.provider_post_id
      where c.source_id=p_source and c.provider_post_id=x)) then raise exception 'candidate_list_changed'; end if;
  update employer_feed_candidates set selected=provider_post_id=any(p_ids),selected_by=u,selected_at=clock_timestamp()
    where source_id=p_source and selected is distinct from (provider_post_id=any(p_ids));
  select count(*)::integer into n from employer_feed_candidates where source_id=p_source and selected;
  perform public.employer_audit_log(u,'employer',org,'source',p_source,'selection_replaced',jsonb_build_object('count',n));
  return n;
end $$;
revoke all on function public.employer_replace_feed_selection(text,text[]) from public,anon;
grant execute on function public.employer_replace_feed_selection(text,text[]) to authenticated;
-- No backend caller needs the user-scoped choice API.
revoke all on function public.employer_replace_feed_selection(text,text[]) from service_role;

-- Historical candidates remain private for audit; employers choose only from
-- the latest registered batch under the currently approved source revision.
create or replace function public.employer_list_feed_candidates(p_source text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u uuid:=public.employer_caller(); org uuid;
begin
  select org_id into org from employer_sources where id=p_source;
  if org is null or not public.employer_is_member(org,u) then raise exception 'source_not_found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('provider_post_id',c.provider_post_id,'selected',c.selected,
    'job_title',c.payload->>'job_title','location',c.payload->>'location','state_code',c.payload->>'state_code') order by c.provider_post_id)
    from employer_feed_candidates c join employer_sources s on s.id=c.source_id and s.revision=c.revision
    join employer_feed_candidate_checkpoints ck on ck.source_id=s.id
    join employer_feed_staging st on st.run_id=ck.last_run_id and st.source_listing_id=s.id||':'||c.provider_post_id
    where c.source_id=p_source and employer_source_for_worker(s.id) is not null),'[]'::jsonb);
end $$;

revoke all on function public.employer_refresh_claim(text),public.employer_refresh_fail(uuid,text),
  public.employer_refresh_finish(uuid,uuid),public.employer_refresh_health(),public.employer_refresh_selection_changed() from public,anon,authenticated;
grant execute on function public.employer_refresh_claim(text),public.employer_refresh_fail(uuid,text),
  public.employer_refresh_finish(uuid,uuid),public.employer_refresh_health() to service_role;
-- Trigger helpers are not RPCs, even to service_role.
revoke all on function public.employer_refresh_selection_changed() from service_role;
notify pgrst,'reload schema';
commit;

