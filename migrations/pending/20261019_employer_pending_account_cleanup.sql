-- Apply after 20261018_employer_access_hardening.sql. Pending claims can coexist.
-- A departing pending claimant must not claim a real company's domain through
-- the account-deletion trigger's suspended state (which reserves a domain).
begin;
create or replace function public.employer_before_account_deleted()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare org uuid;
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
      perform public.employer_audit_log(null,'system',org,'org',org::text,'last_owner_account_deleted');
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
