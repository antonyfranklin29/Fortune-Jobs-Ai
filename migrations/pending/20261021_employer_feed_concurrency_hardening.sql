-- PENDING — NOT APPLIED. Fixes for four baseline interleavings found by
-- tests/employer-feed-concurrency-db.mjs on PostgreSQL 17 (F07, F10, F11, F13).
-- Apply AFTER 20261020_employer_post_actions.sql. Additive: two functions are replaced with
-- unchanged signatures; no table, column, data, index or grant changes.
--
--   F07  keep-on-downgrade committed while a downgrade is between its count and its pause
--        was ignored: the employer's choice was paused anyway. The keep update now takes the
--        organisation lock that the downgrade holds, so it commits either before the count or
--        after the downgrade finishes.
--   F10  approver deletion demoted an approved source to pending and hid it, but left its open
--        feed listings open. They kept counting against the allowance and stayed open for a
--        source that is no longer authorised. They are now closed with the demotion.
--   F11  last-owner deletion suspended the org but left its open listings open (counted, and
--        hidden only by the org status). Suspension now closes them, as operator suspension does.
--   F13  because F11 left the listings open, re-verifying the org revived them without review.
--        Closing them on suspension removes the revival path.

begin;

do $$
begin
  if to_regprocedure('public.employer_lock_org(uuid)') is null
     or to_regprocedure('public.employer_before_account_deleted()') is null then
    raise exception 'apply 20261020_employer_post_actions.sql before 20261021_employer_feed_concurrency_hardening.sql';
  end if;
end $$;

-- ── F07: keep choice takes the organisation lock the downgrade holds ─────────────
create or replace function public.employer_set_keep_on_downgrade(p_post uuid, p_keep boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); p employer_posts;
begin
  select * into p from employer_posts where id = p_post;
  if not found or not public.employer_is_member(p.org_id, u) then raise exception 'post_not_found'; end if;
  perform public.employer_lock_org(p.org_id);
  select * into p from employer_posts where id = p_post for update;
  if not found or not public.employer_is_member(p.org_id, u) then raise exception 'post_not_found' using errcode = '42501'; end if;
  update employer_posts set keep_on_downgrade = p_keep, updated_at = now() where id = p.id;
end $$;

-- ── F10, F11, F13: account deletion closes the listings it takes away ────────────
-- Keeps every rule of 20261019_employer_pending_account_cleanup. Lock order is unchanged:
-- organisation row first, then the organisation's listings.
create or replace function public.employer_before_account_deleted()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare org uuid; n integer;
begin
  -- Serialize against publishing/status changes, in deterministic UUID order.
  -- Do not grant ownership to a colleague implicitly. If the last active owner
  -- leaves, suspend the org; another active owner keeps a shared company live.
  for org in select o.id from employer_orgs o
    where exists(select 1 from employer_org_members m where m.org_id=o.id and m.user_id=old.id and m.status='active' and m.role='owner')
       or exists(select 1 from employer_sources s where s.org_id=o.id and s.approved_by=old.id)
    order by o.id for update of o
  loop
    if exists(select 1 from employer_org_members where org_id=org and user_id=old.id and status='active' and role='owner')
       and not exists(select 1 from employer_org_members where org_id=org and user_id<>old.id and status='active' and role='owner') then
      update employer_orgs set status=case when status='pending' then 'rejected' else 'suspended' end,updated_at=now() where id=org and status in ('pending','verified');
      -- F11/F13: a suspended or rejected organisation's listings close with it, as operator suspension does.
      update pre_scraped_jobs set closed_at=now() where employer_org_id=org and closed_at is null;
      perform public.employer_audit_log(null,'system',org,'org',org::text,'last_owner_account_deleted');
    end if;
    -- F10: a source demoted below is hidden; its open feed listings close in the same transaction.
    update pre_scraped_jobs set closed_at=now()
     where employer_source_id in (select s.id from employer_sources s where s.org_id=org and s.approved_by=old.id and s.status='approved')
       and closed_at is null;
    get diagnostics n = row_count;
    if n > 0 then
      perform public.employer_audit_log(null,'system',org,'org',org::text,'feed_closed_approver_deleted',jsonb_build_object('closed',n));
    end if;
    -- Approved sources require an attributable reviewer by CHECK constraint.
    -- Safely pause for independent re-review before that attribution is erased.
    update employer_sources set status='pending',enabled=false,revision=revision+1,updated_at=now()
      where org_id=org and approved_by=old.id and status='approved';
  end loop;
  -- Membership/operator rows already cascade. No user UUID left in audit.actor.
  update employer_audit set actor=null where actor=old.id;
  return old;
end $$;
revoke all on function public.employer_before_account_deleted() from public,anon,authenticated,service_role;

commit;
