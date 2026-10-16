-- PENDING integration hardening of Claude's service-only feed publisher.
-- Preserves the signature, organisation lock, quotas and original migration.
-- Apply after 20261016_employer_submissions.sql. No deployment in this change.
begin;
create or replace function public.employer_publish_feed_jobs(p_source text,p_revision integer,p_provider_ids text[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.employer_sources; o public.employer_orgs; c record; lim integer; act integer; jid bigint;
  published integer:=0; updated integer:=0; blocked integer:=0; skipped jsonb:='[]'::jsonb;
  host text; path text; url text; exp timestamptz; posted timestamptz; was_active boolean;
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
    if coalesce(was_active,false) then updated:=updated+1;else published:=published+1;end if;
  end loop;
  perform public.employer_audit_log(null,'service',o.id,'source',s.id,'feed_published',
    jsonb_build_object('published',published,'updated',updated,'blocked_quota',blocked,'skipped',jsonb_array_length(skipped)));
  return jsonb_build_object('published',published,'updated',updated,'blocked_quota',blocked,
    'state',case when blocked>0 then 'upgrade_required' end,'limit',lim,'skipped',skipped);
end $$;
revoke all on function public.employer_publish_feed_jobs(text,integer,text[]) from public,anon,authenticated;
grant execute on function public.employer_publish_feed_jobs(text,integer,text[]) to service_role;
commit;
