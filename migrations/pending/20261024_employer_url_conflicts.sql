-- Integrates Claude's URL collision savepoints (8962a74), on top of the
-- deployed Codex refresh workflow. Staging is deliberately NOT replaced.
-- Closure stays behind clean/complete enumeration and empty-feed confirmation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
 if to_regclass('public.employer_refresh_control') is null then raise exception 'refresh baseline missing'; end if;
end $$;
create or replace function public.employer_publish_feed_jobs(p_source text,p_revision integer,p_provider_ids text[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.employer_sources; o public.employer_orgs; c record; lim integer; act integer; jid bigint;
  published integer:=0; updated integer:=0; blocked integer:=0; skipped jsonb:='[]'::jsonb;
  host text; path text; url text; exp timestamptz; posted timestamptz; was_active boolean;
  conflict_name text; conflict_table text; conflict_schema text;
begin
  if p_provider_ids is null or cardinality(p_provider_ids)>500 then raise exception 'invalid_ids'; end if;
  select * into s from public.employer_sources where id=p_source;
  if not found then raise exception 'source_not_found'; end if;
  o:=public.employer_lock_org(s.org_id);
  select * into s from public.employer_sources where id=p_source for update;
  if s.revision is distinct from p_revision or public.employer_source_for_worker(p_source) is null then
    raise exception 'source_not_publishable';
  end if;
  lim:=public.employer_active_limit(o.id);
  for c in select * from public.employer_feed_candidates
    where source_id=s.id and provider_post_id=any(p_provider_ids) order by provider_post_id for update loop
    if not c.selected then
      skipped:=skipped||jsonb_build_object('id',c.provider_post_id,'reason','not_selected');continue;
    end if;
    if c.revision is distinct from p_revision then
      skipped:=skipped||jsonb_build_object('id',c.provider_post_id,'reason','stale_candidate_revision');continue;
    end if;
    if c.staged_at <= now()-interval '7 days' or c.staged_at > now()+interval '1 minute' then
      skipped:=skipped||jsonb_build_object('id',c.provider_post_id,'reason','candidate_refresh_required');continue;
    end if;
    url:=c.payload->>'apply_url';host:=public.employer_url_host(url);
    if host is null or not host=any(s.allowed_apply_hosts) then
      skipped:=skipped||jsonb_build_object('id',c.provider_post_id,'reason','apply_host_not_allowed');continue;
    end if;
    path:=substring(url from '^https://[^/]+(/[^?#]*)');
    if (host in ('jobs.lever.co','jobs.eu.lever.co') and
         (s.adapter<>'lever' or path is null or path !~ ('^/'||s.board_token||'/'||c.provider_post_id||'(/|$)')))
      or (host in ('boards.greenhouse.io','job-boards.greenhouse.io') and
         (s.adapter<>'greenhouse' or path is null or path !~ ('^/'||s.board_token||'/jobs/'||c.provider_post_id||'(/|$)'))) then
      skipped:=skipped||jsonb_build_object('id',c.provider_post_id,'reason','apply_tenant_mismatch');continue;
    end if;
    if coalesce(c.payload->>'job_title','')='' or c.payload->>'job_title' ~ '[<>[:cntrl:]]'
       or public.ingest_classify_role(c.payload->>'job_title') is distinct from c.payload->>'canonical_role'
       or public.ingest_state_from_location(c.payload->>'location') is distinct from c.payload->>'state_code'
       or not exists(select 1 from public.ingest_roles where id=c.payload->>'canonical_role')
       or not exists(select 1 from public.ingest_regions where code=c.payload->>'state_code')
       or coalesce(c.payload->>'country','us')<>'us' then
      skipped:=skipped||jsonb_build_object('id',c.provider_post_id,'reason','invalid_listing_evidence');continue;
    end if;
    begin posted:=nullif(c.payload->>'posted_at','')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      skipped:=skipped||jsonb_build_object('id',c.provider_post_id,'reason','invalid_posting_date');continue;
    end;
    if posted > now()+interval '1 hour' then
      skipped:=skipped||jsonb_build_object('id',c.provider_post_id,'reason','invalid_posting_date');continue;
    end if;
    -- Permission expiry is not evidence that a vacancy stays open that long.
    exp:=least(s.authorization_expires_at,c.staged_at+interval '7 days');
    jid:=null;was_active:=false;
    select id,(closed_at is null and (expires_at is null or expires_at>now())) into jid,was_active
      from public.pre_scraped_jobs where source='employer_feed'
        and source_listing_id=s.id||':'||c.provider_post_id
        and employer_source_id=s.id and employer_org_id=o.id;
    if exists(select 1 from public.pre_scraped_jobs where apply_url=url and id is distinct from jid) then
      skipped:=skipped||jsonb_build_object('id',c.provider_post_id,'reason','apply_url_already_listed');continue;
    end if;
    if not coalesce(was_active,false) then
      act:=public.employer_active_count(o.id);
      if act>=lim then blocked:=blocked+1;continue;end if;
    end if;
    begin
      if jid is null then
        insert into public.pre_scraped_jobs(source,source_listing_id,category,canonical_role,job_title,company,location,
          state_code,country,apply_url,source_url,job_description,employment_type,work_mode,is_remote,posted_at,
          fetched_at,last_seen_at,scraped_at,attribution,search_text,employer_org_id,employer_source_id,expires_at)
        values('employer_feed',s.id||':'||c.provider_post_id,
          (select name from public.ingest_roles where id=c.payload->>'canonical_role'),c.payload->>'canonical_role',
          c.payload->>'job_title',s.employer_name,c.payload->>'location',c.payload->>'state_code','us',url,url,
          case when s.allow_description then c.payload->>'job_description' end,c.payload->>'employment_type',
          c.payload->>'work_mode',coalesce((c.payload->>'is_remote')::boolean,false),posted,
          now(),now(),now(),nullif(s.attribution_text,''),
          lower(coalesce(c.payload->>'job_title','')||' '||s.employer_name||' '||coalesce(c.payload->>'location','')),o.id,s.id,exp);
      else
        update public.pre_scraped_jobs set job_title=c.payload->>'job_title',company=s.employer_name,
          location=c.payload->>'location',state_code=c.payload->>'state_code',canonical_role=c.payload->>'canonical_role',
          category=(select name from public.ingest_roles where id=c.payload->>'canonical_role'),apply_url=url,source_url=url,
          job_description=case when s.allow_description then c.payload->>'job_description' end,
          employment_type=c.payload->>'employment_type',work_mode=c.payload->>'work_mode',
          is_remote=coalesce((c.payload->>'is_remote')::boolean,false),posted_at=coalesce(posted,posted_at),
          last_seen_at=now(),fetched_at=now(),scraped_at=now(),expires_at=exp,closed_at=null,
          attribution=nullif(s.attribution_text,''),
          search_text=lower(coalesce(c.payload->>'job_title','')||' '||s.employer_name||' '||coalesce(c.payload->>'location',''))
          where id=jid and employer_source_id=s.id and employer_org_id=o.id;
      end if;
    exception when unique_violation then
      -- Recover only the apply URL unique index; unrelated integrity errors must surface.
      get stacked diagnostics conflict_name=constraint_name, conflict_table=table_name, conflict_schema=schema_name;
      if conflict_schema is distinct from 'public' or conflict_table is distinct from 'pre_scraped_jobs' or not exists(
        select 1 from pg_index i join pg_class idx on idx.oid=i.indexrelid
        join pg_attribute a on a.attrelid=i.indrelid and a.attname='apply_url'
        where i.indrelid='public.pre_scraped_jobs'::regclass and idx.relname=conflict_name
          and i.indisunique and i.indisvalid and i.indnkeyatts=1 and i.indkey[0]=a.attnum
          and i.indpred is null and i.indexprs is null) then raise; end if;
      -- Another listing already holds this URL (a concurrent claim by any company). Only this candidate is skipped.
      skipped:=skipped||jsonb_build_object('id',c.provider_post_id,'reason','apply_url_already_listed');continue;
    end;
    if coalesce(was_active,false) then updated:=updated+1;else published:=published+1;end if;
  end loop;
  perform public.employer_audit_log(null,'service',o.id,'source',s.id,'feed_published',
    jsonb_build_object('published',published,'updated',updated,'blocked_quota',blocked,'skipped',jsonb_array_length(skipped)));
  return jsonb_build_object('published',published,'updated',updated,'blocked_quota',blocked,
    'state',case when blocked>0 then 'upgrade_required' end,'limit',lim,'skipped',skipped);
end $$;

create or replace function public.employer_publish_post_internal(p_post uuid, p_actor uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p employer_posts; o employer_orgs; lim int; act int; jid bigint; org_name text; exp timestamptz;
  conflict_name text; conflict_table text; conflict_schema text;
begin
  select * into p from employer_posts where id = p_post;
  if not found then raise exception 'post_not_found'; end if;
  if p_actor is not null then perform public.employer_lock_actor(p_actor); end if;
  perform public.employer_lock_post_parties(p_post);
  o := public.employer_lock_org(p.org_id);
  select * into p from employer_posts where id = p_post for update;
  if p_kind = 'employer' and not public.employer_is_member(p.org_id, p_actor) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if p.reviewed_revision is distinct from p.revision or p.status not in ('approved','paused','published','closed') then
    raise exception 'revision_not_approved';
  end if;
  if o.status <> 'verified' then
    update employer_posts set publish_state = 'org_not_verified' where id = p.id;
    return jsonb_build_object('id', p.id, 'published', false, 'state', 'org_not_verified');
  end if;
  exp := (p.closing_date + 1)::timestamptz;
  if exp <= now() then
    update employer_posts set publish_state = 'expired' where id = p.id;
    return jsonb_build_object('id', p.id, 'published', false, 'state', 'expired');
  end if;

  -- An already-live post being updated does not take another slot.
  if not (p.published_job_id is not null and exists (
            select 1 from pre_scraped_jobs where id = p.published_job_id and closed_at is null and (expires_at is null or expires_at > now()))) then
    lim := public.employer_active_limit(o.id);
    act := public.employer_active_count(o.id);
    if act >= lim then
      update employer_posts set publish_state = 'upgrade_required', status = case when status = 'published' then 'paused' else status end
       where id = p.id;
      perform public.employer_audit_log(p_actor, p_kind, o.id, 'post', p.id::text, 'publish_blocked_quota',
        jsonb_build_object('active', act, 'limit', lim));
      return jsonb_build_object('id', p.id, 'published', false, 'state', 'upgrade_required', 'active', act, 'limit', lim);
    end if;
  end if;

  -- Never take over another source's listing that shares the URL.
  if exists (select 1 from pre_scraped_jobs j where j.apply_url = p.apply_url
              and j.id is distinct from p.published_job_id) then
    update employer_posts set publish_state = 'apply_url_already_listed' where id = p.id;
    return jsonb_build_object('id', p.id, 'published', false, 'state', 'apply_url_already_listed');
  end if;

  org_name := o.name;
  begin
    if p.published_job_id is null then
      insert into pre_scraped_jobs (source, source_listing_id, category, canonical_role, job_title, company, location,
          state_code, country, apply_url, source_url, job_description, employment_type, work_mode, is_remote,
          posted_at, fetched_at, last_seen_at, scraped_at, attribution, search_text,
          employer_org_id, employer_post_id, expires_at)
      values ('employer_direct', p.id::text, (select name from ingest_roles where id = p.canonical_role), p.canonical_role,
          p.job_title, org_name, p.city || ', ' || p.state_code, p.state_code, 'us', p.apply_url, p.apply_url,
          p.description, p.employment_type, p.work_mode, p.work_mode = 'remote',
          p.posting_date::timestamptz, now(), now(), now(), null,
          lower(p.job_title || ' ' || org_name || ' ' || p.city || ', ' || p.state_code),
          o.id, p.id, exp)
      returning id into jid;
    else
      update pre_scraped_jobs set
          category = (select name from ingest_roles where id = p.canonical_role), canonical_role = p.canonical_role,
          job_title = p.job_title, company = org_name, location = p.city || ', ' || p.state_code, state_code = p.state_code,
          apply_url = p.apply_url, source_url = p.apply_url, job_description = p.description,
          employment_type = p.employment_type, work_mode = p.work_mode, is_remote = p.work_mode = 'remote',
          posted_at = p.posting_date::timestamptz, last_seen_at = now(), scraped_at = now(), closed_at = null,
          expires_at = exp,
          search_text = lower(p.job_title || ' ' || org_name || ' ' || p.city || ', ' || p.state_code)
       where id = p.published_job_id and employer_post_id = p.id and source = 'employer_direct'
       returning id into jid;
      if jid is null then raise exception 'published_row_mismatch'; end if;
    end if;
  exception when unique_violation then
      -- Recover only the apply URL unique index; unrelated integrity errors must surface.
      get stacked diagnostics conflict_name=constraint_name, conflict_table=table_name, conflict_schema=schema_name;
      if conflict_schema is distinct from 'public' or conflict_table is distinct from 'pre_scraped_jobs' or not exists(
        select 1 from pg_index i join pg_class idx on idx.oid=i.indexrelid
        join pg_attribute a on a.attrelid=i.indrelid and a.attname='apply_url'
        where i.indrelid='public.pre_scraped_jobs'::regclass and idx.relname=conflict_name
          and i.indisunique and i.indisvalid and i.indnkeyatts=1 and i.indkey[0]=a.attnum
          and i.indpred is null and i.indexprs is null) then raise; end if;
    -- Lost a concurrent URL claim (the duplicate check above ran before the other claim committed).
    update employer_posts set publish_state = 'apply_url_already_listed' where id = p.id;
    return jsonb_build_object('id', p.id, 'published', false, 'state', 'apply_url_already_listed');
  end;
  update employer_posts set status = 'published', published_job_id = jid, publish_state = null,
                            has_unreviewed_changes = false, updated_at = now() where id = p.id;
  perform public.employer_audit_log(p_actor, p_kind, o.id, 'post', p.id::text, 'published',
    jsonb_build_object('job_id', jid, 'revision', p.revision));
  return jsonb_build_object('id', p.id, 'published', true, 'job_id', jid);
end $$;
notify pgrst,'reload schema';
commit;
