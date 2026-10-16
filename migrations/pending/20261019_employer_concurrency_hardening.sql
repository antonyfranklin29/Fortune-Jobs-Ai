-- PENDING — NOT APPLIED. Concurrency hardening from the employer concurrency review
-- (docs/claude-employer-concurrency-review.md). Apply AFTER 20261018_employer_access_hardening;
-- it refuses to run without it. Signatures and grants are unchanged (CREATE OR REPLACE).
--
-- One lock order everywhere on every publication or status path:
--     auth.users (actor FOR SHARE; post creator and reviewer FOR KEY SHARE)
--       →  employer_orgs (FOR UPDATE)  →  employer_posts (FOR UPDATE)  →  pre_scraped_jobs
-- This matches the account-deletion trigger, which takes auth.users (DELETE) and then the
-- organisation rows. Before this migration the close and review paths took the post or the
-- job first, which deadlocked against publication, and the close paths acted on a job id read
-- before the lock, so a concurrent publish could leave a closed post with a live listing.
--
-- Fixes, each demonstrated by tests/employer-concurrency-db.mjs on the pending chain without
-- this file (see the review for the exact results):
--   1. An actor whose account is banned, deleted or unconfirmed while a publish is in flight
--      is refused. The actor row is share-locked before the organisation lock, so a ban that
--      commits later waits for the publish instead of slipping in front of it.
--   2. Owner close re-reads the post after taking the organisation lock and closes the job it
--      finds there. It also re-checks membership after the lock, so a removal that committed
--      first is honoured.
--   3. Operator close takes the same lock order, closes the current job, and withdraws the
--      approval (reviewed_revision = null). The owner can no longer re-open a takedown, and
--      any reinstatement needs a new revision reviewed by an operator.
--   4. Operator review takes the organisation lock before the post lock, which removes the
--      post-then-organisation deadlock with owner close and with account deletion.
--   5. Operator verification maps a concurrent domain collision to domain_already_claimed,
--      not the raw unique-violation text.

begin;

do $$
begin
  if to_regprocedure('public.employer_user_eligible(uuid)') is null
     or to_regprocedure('public.employer_caller()') is null then
    raise exception 'apply 20261018_employer_access_hardening.sql before 20261019_employer_concurrency_hardening.sql';
  end if;
end $$;

-- ── 1. actor eligibility under a share lock (taken before the organisation lock) ──
create or replace function public.employer_lock_actor(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare acct record;
begin
  select email_confirmed_at, deleted_at, banned_until into acct
    from auth.users where id = p_user for share;
  if not found then raise exception 'account_unavailable' using errcode = '42501'; end if;
  if acct.email_confirmed_at is null then raise exception 'email_not_confirmed' using errcode = '42501'; end if;
  if acct.deleted_at is not null then raise exception 'account_unavailable' using errcode = '42501'; end if;
  if acct.banned_until is not null and acct.banned_until > now() then
    raise exception 'account_banned' using errcode = '42501';
  end if;
end $$;
revoke all on function public.employer_lock_actor(uuid) from public, anon, authenticated, service_role;

-- The post's creator and reviewer rows are checked by the foreign keys on every post update,
-- and the foreign-key check takes FOR KEY SHARE on them. Account deletion takes those rows
-- exclusively before it locks the organisation, so the same rows must be locked here, before
-- the organisation lock, or an approval can hold the organisation and wait on the deleted
-- creator's row while the deletion holds that row and waits on the organisation.
create or replace function public.employer_lock_post_parties(p_post uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from auth.users a
   where a.id in (select created_by from employer_posts where id = p_post
                  union select reviewed_by from employer_posts where id = p_post)
   order by a.id for key share;
end $$;
revoke all on function public.employer_lock_post_parties(uuid) from public, anon, authenticated, service_role;

-- ── 2. publication core: actor lock, then organisation lock, then the post ──────
create or replace function public.employer_publish_post_internal(p_post uuid, p_actor uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p employer_posts; o employer_orgs; lim int; act int; jid bigint; org_name text; exp timestamptz;
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
  update employer_posts set status = 'published', published_job_id = jid, publish_state = null,
                            has_unreviewed_changes = false, updated_at = now() where id = p.id;
  perform public.employer_audit_log(p_actor, p_kind, o.id, 'post', p.id::text, 'published',
    jsonb_build_object('job_id', jid, 'revision', p.revision));
  return jsonb_build_object('id', p.id, 'published', true, 'job_id', jid);
end $$;

-- ── 3. owner re-activation and close: lock order, then fresh reads ───────────────
create or replace function public.employer_activate_post(p_post uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); p employer_posts;
begin
  select * into p from employer_posts where id = p_post;
  if not found or not public.employer_is_member(p.org_id, u) then raise exception 'post_not_found'; end if;
  if p.has_unreviewed_changes or p.reviewed_revision is distinct from p.revision then raise exception 'review_required'; end if;
  return public.employer_publish_post_internal(p_post, u, 'employer');
end $$;

create or replace function public.employer_close_post(p_post uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); p employer_posts; v_org uuid;
begin
  select org_id into v_org from employer_posts where id = p_post;
  if v_org is null or not public.employer_is_member(v_org, u) then raise exception 'post_not_found'; end if;
  perform public.employer_lock_actor(u);
  perform public.employer_lock_post_parties(p_post);
  perform public.employer_lock_org(v_org);
  select * into p from employer_posts where id = p_post for update;
  if not found or not public.employer_is_member(p.org_id, u) then raise exception 'post_not_found' using errcode = '42501'; end if;
  update pre_scraped_jobs set closed_at = now()
   where id = p.published_job_id and employer_post_id = p.id and closed_at is null;
  update employer_posts set status = case when status in ('draft','pending_review','rejected') then status else 'closed' end,
                            publish_state = null, updated_at = now() where id = p.id returning * into p;
  perform public.employer_audit_log(u, 'employer', p.org_id, 'post', p.id::text, 'closed');
  return jsonb_build_object('id', p.id, 'status', p.status);
end $$;

-- ── 4. operator review and close: organisation lock before post lock ─────────────
create or replace function public.operator_review_post(p_post uuid, p_revision integer, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p employer_posts; u uuid; v_org uuid;
begin
  select org_id into v_org from employer_posts where id = p_post;
  if v_org is null then raise exception 'post_not_found'; end if;
  u := public.employer_require_operator(v_org);
  perform public.employer_lock_actor(u);
  perform public.employer_lock_post_parties(p_post);
  perform public.employer_lock_org(v_org);
  select * into p from employer_posts where id = p_post for update;
  -- Approval binds to the exact revision the operator looked at.
  if p.revision <> p_revision then raise exception 'revision_changed'; end if;
  if not (p.status = 'pending_review' or p.has_unreviewed_changes) then raise exception 'not_awaiting_review'; end if;
  if p_decision = 'approve' then
    update employer_posts set reviewed_revision = p.revision, reviewed_by = u, reviewed_at = now(),
           review_note = left(p_note, 500),
           status = case when status in ('pending_review','draft') then 'approved' else status end
     where id = p.id;
    perform public.employer_audit_log(u, 'operator', p.org_id, 'post', p.id::text, 'approved', jsonb_build_object('revision', p.revision));
    -- Operator approval publishes (or updates the live version) under the quota.
    return public.employer_publish_post_internal(p.id, u, 'operator');
  elsif p_decision = 'reject' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'reason_required'; end if;
    update employer_posts set status = case when published_job_id is null then 'rejected' else status end,
           has_unreviewed_changes = false, review_note = left(p_note, 500), reviewed_by = u, reviewed_at = now()
     where id = p.id;
    perform public.employer_audit_log(u, 'operator', p.org_id, 'post', p.id::text, 'rejected', jsonb_build_object('revision', p.revision, 'note', left(p_note, 500)));
    return jsonb_build_object('id', p.id, 'rejected', true);
  end if;
  raise exception 'invalid_decision';
end $$;

create or replace function public.operator_close_post(p_post uuid, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p employer_posts; u uuid; v_org uuid;
begin
  select org_id into v_org from employer_posts where id = p_post;
  if v_org is null then raise exception 'post_not_found'; end if;
  u := public.employer_require_operator(v_org);
  perform public.employer_lock_actor(u);
  perform public.employer_lock_post_parties(p_post);
  perform public.employer_lock_org(v_org);
  select * into p from employer_posts where id = p_post for update;
  update pre_scraped_jobs set closed_at = now()
   where id = p.published_job_id and employer_post_id = p.id and closed_at is null;
  -- The takedown withdraws the approval, so the owner cannot re-activate the post.
  update employer_posts set status = 'closed', reviewed_revision = null, publish_state = null,
         review_note = left(p_note, 500), updated_at = now() where id = p.id;
  perform public.employer_audit_log(u, 'operator', p.org_id, 'post', p.id::text, 'closed_by_operator', jsonb_build_object('note', left(p_note, 500)));
end $$;

-- ── 5. operator verification: a concurrent domain collision gets a clean error ───
create or replace function public.operator_set_org_status(p_org uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_require_operator(p_org); o employer_orgs;
begin
  if p_status not in ('verified','rejected','suspended') then raise exception 'invalid_status'; end if;
  if p_status = 'verified' and coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  perform public.employer_lock_actor(u);
  o := public.employer_lock_org(p_org);
  if p_status = 'verified' and o.domain_verified_at is null then raise exception 'domain_not_verified'; end if;
  if p_status = 'verified' and exists (select 1 from employer_orgs x
        where x.primary_domain = o.primary_domain and x.id <> p_org and x.status in ('verified','suspended')) then
    raise exception 'domain_already_claimed';
  end if;
  begin
    update employer_orgs set status = p_status, verified_by = case when p_status = 'verified' then u else verified_by end,
           verified_at = case when p_status = 'verified' then now() else verified_at end, updated_at = now()
     where id = p_org;
  exception when unique_violation then
    -- Another operator verified the same domain between the check above and this update.
    raise exception 'domain_already_claimed';
  end;
  if p_status in ('rejected','suspended') then
    update pre_scraped_jobs set closed_at = now() where employer_org_id = p_org and closed_at is null;
    update employer_sources set enabled = false, status = case when status = 'approved' then 'revoked' else status end,
           revision = revision + 1, updated_at = now() where org_id = p_org and status in ('approved','pending');
  end if;
  perform public.employer_audit_log(u, 'operator', p_org, 'org', p_org::text, 'status_' || p_status, jsonb_build_object('note', left(p_note, 500)));
end $$;

commit;
