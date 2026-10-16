-- Apply after employer_submissions. Employer audit/operational rows must not
-- prevent the existing authenticated self-deletion endpoint deleting auth.users.
-- Keep company/job history, unlink the departing person's attribution.
begin;
do $$
declare t text; c text; constraint_name text;
begin
  for t,c in select * from (values
    ('employer_orgs','created_by'),('employer_orgs','verified_by'),
    ('employer_sources','submitted_by'),('employer_sources','approved_by'),
    ('employer_source_evidence','attested_by'),('employer_feed_candidates','selected_by'),
    ('employer_posts','created_by'),('employer_posts','reviewed_by')) as refs(t,c)
  loop
    constraint_name := t || '_' || c || '_fkey';
    execute format('alter table public.%I alter column %I drop not null',t,c);
    execute format('alter table public.%I drop constraint %I',t,constraint_name);
    execute format('alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete set null',t,constraint_name,c);
    -- Account deletion should not require a full scan of every employer row.
    execute format('create index if not exists %I on public.%I (%I) where %I is not null',t||'_'||c||'_idx',t,c,c);
  end loop;
end $$;
create index if not exists employer_org_members_user_idx on public.employer_org_members(user_id);
create index if not exists employer_audit_actor_idx on public.employer_audit(actor) where actor is not null;

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
      update employer_orgs set status='suspended',updated_at=now() where id=org and status in ('pending','verified');
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
drop trigger if exists employer_account_deleted on auth.users;
create trigger employer_account_deleted before delete on auth.users
  for each row execute function public.employer_before_account_deleted();
commit;
