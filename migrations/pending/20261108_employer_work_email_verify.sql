-- Employer verification by work email, checked afterwards (Franklin, 2026-11-07).
--
-- Before: every new company stayed "pending" until a reviewer verified it by hand.
-- Now: a company is verified when it is registered by a confirmed account whose email is at the
-- company's own domain (jane@acme.com registers acme.com; free-mail and other domains are still
-- refused by employer_register_org). Safety moves to afterwards:
--   * automatic post checks are unchanged (own-domain Apply link, dates, scam wording, 3 a day);
--   * until a reviewer confirms the company, it may keep at most 3 live jobs during its first 7 days;
--   * reviewers (reviews@fortunejobsai.com) get an email for every new company and every post that
--     needs a person, and can confirm or suspend from the Review queue;
--   * employers get an email when a reviewer approves or rejects a post or suspends the company.
-- Rollback is at the bottom.

alter table public.employer_orgs add column if not exists reviewer_confirmed_at timestamptz;
alter table public.employer_orgs drop constraint if exists employer_orgs_domain_verify_method_check;
alter table public.employer_orgs add constraint employer_orgs_domain_verify_method_check
  check (domain_verify_method = any (array['dns_txt','operator_manual','work_email']));
-- Companies a reviewer already verified count as confirmed.
update public.employer_orgs set reviewer_confirmed_at = coalesce(verified_at, now())
 where status = 'verified' and verified_by is not null and reviewer_confirmed_at is null;

-- First-week limit for companies verified by work email and not yet confirmed by a reviewer.
create or replace function public.employer_active_limit(p_org uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when o.reviewer_confirmed_at is null and o.domain_verify_method = 'work_email'
         and o.created_at > now() - interval '7 days'
      then least(3, base.lim)
    else base.lim end
  from (select case
          when c.paid_publishing_enabled and c.paid_active_limit is not null and exists (
            select 1 from employer_entitlements e
             where e.org_id = p_org and e.plan_code = c.paid_plan_code
               and e.status in ('active','canceled','past_due') and e.paid_through > now())
          then c.paid_active_limit
          else c.free_active_posts end as lim
        from employer_billing_config c where c.id) base
  left join employer_orgs o on o.id = p_org;
$$;

-- Registration: verified at once by the matching, confirmed work email.
create or replace function public.employer_register_org(p_name text, p_domain text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); d text := lower(btrim(p_domain)); o employer_orgs; email_domain text;
begin
  if (select count(*) from employer_org_members where user_id = u and status = 'active') >= 3 then
    raise exception 'too_many_organizations';
  end if;
  select lower(split_part(email, '@', 2)) into email_domain from auth.users where id = u;
  if email_domain is null or email_domain = '' or public.employer_free_email_domain(email_domain) then
    raise exception 'company_email_required';
  end if;
  if public.employer_free_email_domain(d) then raise exception 'free_email_domain_not_allowed'; end if;
  if not (email_domain = d or email_domain like '%.' || d) then raise exception 'email_domain_mismatch'; end if;
  if exists (select 1 from employer_orgs where primary_domain = d and status in ('verified','suspended')) then
    raise exception 'domain_already_registered';
  end if;
  -- employer_caller() has already required a confirmed email address, so the address is proven.
  insert into employer_orgs (name, primary_domain, created_by, status, domain_verified_at, domain_verify_method, verified_at)
  values (btrim(p_name), d, u, 'verified', now(), 'work_email', now()) returning * into o;
  insert into employer_org_members (org_id, user_id, role) values (o.id, u, 'owner');
  insert into employer_domain_challenges (org_id) values (o.id);
  perform public.employer_audit_log(u, 'employer', o.id, 'org', o.id::text, 'registered',
    jsonb_build_object('domain', d, 'email_domain_matches', true, 'verified_by', 'work_email'));
  return jsonb_build_object('org_id', o.id, 'status', o.status, 'verified_by', 'work_email',
    'first_week_limit', public.employer_active_limit(o.id));
exception when unique_violation then
  raise exception 'domain_already_registered';
end $$;

-- Automatic post review: a work-email-verified company qualifies like a reviewer-verified one.
create or replace function public.employer_submit_post(p_post uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.employer_caller();
  v_org uuid;
  p public.employer_posts;
  o public.employer_orgs;
  host text;
  automatic boolean := false;
  outcome jsonb;
begin
  select org_id into v_org from public.employer_posts where id = p_post;
  if v_org is null then raise exception 'post_not_found'; end if;
  perform public.employer_lock_actor(u);
  perform public.employer_lock_post_parties(p_post);
  o := public.employer_lock_org(v_org);
  select * into p from public.employer_posts where id = p_post for update;
  if not found or not public.employer_is_member(v_org, u) then raise exception 'post_not_found'; end if;

  if p.status = 'draft' then
    update public.employer_posts set status = 'pending_review', updated_at = now()
      where id = p.id returning * into p;
  elsif not p.has_unreviewed_changes then
    raise exception 'nothing_to_submit';
  end if;

  perform public.employer_audit_log(u, 'employer', v_org, 'post', p.id::text,
    'submitted', jsonb_build_object('revision', p.revision));

  host := lower(substring(p.apply_url from '^https://([^/?#]+)'));
  automatic := o.status = 'verified'
    and o.domain_verified_at is not null
    and (o.verified_by is not null or o.domain_verify_method = 'work_email')
    and exists (select 1 from public.employer_org_members m
                where m.org_id = v_org and m.user_id = u and m.role = 'owner' and m.status = 'active')
    and (host = o.primary_domain or host like '%.' || o.primary_domain)
    and p.posting_date between current_date - 1 and current_date + 1
    and p.closing_date <= current_date + 60
    and p.description !~* '(https?://|www[.]|[[:alnum:]_.+-]+@[[:alnum:].-]+[.][a-z]{2,}|application[[:space:]]+fee|training[[:space:]]+fee|gift[[:space:]]+card|wire[[:space:]]+transfer|bank[[:space:]]+account|social[[:space:]]+security[[:space:]]+number|\mssn\M|whatsapp|telegram|crypto)'
    and (select count(*) from public.employer_audit a
         where a.org_id = v_org and a.action = 'auto_approved'
           and a.at >= now() - interval '24 hours') < 3;

  if not automatic then
    return jsonb_build_object('id', p.id, 'status', p.status, 'published', false, 'review', 'manual');
  end if;

  update public.employer_posts
     set reviewed_revision = p.revision, reviewed_by = null,
         reviewed_at = now(), review_note = null,
         status = case when status = 'pending_review' then 'approved' else status end
   where id = p.id;
  perform public.employer_audit_log(null, 'system', v_org, 'post', p.id::text,
    'auto_approved', jsonb_build_object('revision', p.revision, 'rule', 'verified_owner_first_party_v1'));
  outcome := public.employer_publish_post_internal(p.id, u, 'employer');
  return outcome || jsonb_build_object('review', 'automatic');
end $$;

-- Reviewer decisions: "verified" on a work-email company records the reviewer's confirmation.
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
    update employer_orgs set status = p_status,
           verified_by = case when p_status = 'verified' then u else verified_by end,
           verified_at = case when p_status = 'verified' then coalesce(verified_at, now()) else verified_at end,
           reviewer_confirmed_at = case when p_status = 'verified' then now() else reviewer_confirmed_at end,
           updated_at = now()
     where id = p_org;
  exception when unique_violation then
    raise exception 'domain_already_claimed';
  end;
  if p_status in ('rejected','suspended') then
    update pre_scraped_jobs set closed_at = now() where employer_org_id = p_org and closed_at is null;
    update employer_sources set enabled = false, status = case when status = 'approved' then 'revoked' else status end,
           revision = revision + 1, updated_at = now() where org_id = p_org and status in ('approved','pending');
  end if;
  perform public.employer_audit_log(u, 'operator', p_org, 'org', p_org::text, 'status_' || p_status, jsonb_build_object('note', left(p_note, 500)));
end $$;

-- Review queue: pending companies plus work-email companies a reviewer has not yet confirmed.
create or replace function public.operator_queue()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_require_operator(null);
begin
  return jsonb_build_object(
    'orgs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'domain', o.primary_domain,
        'status', o.status, 'domain_verified', o.domain_verified_at is not null,
        'auto_verified', o.status = 'verified' and o.domain_verify_method = 'work_email',
        'active_posts', public.employer_active_count(o.id),
        'registrant_email', a.email, 'created_at', o.created_at) order by o.created_at)
      from public.employer_orgs o
      join auth.users a on a.id = o.created_by
      where (o.status = 'pending' or (o.status = 'verified' and o.reviewer_confirmed_at is null))
        and not public.employer_is_member(o.id, u)), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'org', o.name, 'org_domain', o.primary_domain,
        'org_status', o.status, 'job_title', p.job_title,
        'canonical_role', p.canonical_role, 'description', p.description,
        'city', p.city, 'state_code', p.state_code,
        'work_mode', p.work_mode, 'employment_type', p.employment_type,
        'posting_date', p.posting_date, 'closing_date', p.closing_date,
        'apply_url', p.apply_url, 'revision', p.revision,
        'status', p.status, 'changes', p.has_unreviewed_changes))
      from public.employer_posts p
      join public.employer_orgs o on o.id = p.org_id
      where (p.status = 'pending_review' or p.has_unreviewed_changes)
        and not public.employer_is_member(o.id, u)), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'org', o.name, 'adapter', s.adapter,
        'board_token', s.board_token,
        'requested_apply_hosts', s.requested_apply_hosts))
      from public.employer_sources s
      join public.employer_orgs o on o.id = s.org_id
      where s.status = 'pending' and not public.employer_is_member(o.id, u)), '[]'::jsonb));
end $$;

-- ── Review emails ────────────────────────────────────────────────────────────────────────
alter table public.account_emails drop constraint if exists account_emails_kind_check;
alter table public.account_emails add constraint account_emails_kind_check check (kind in (
  'welcome','pro_started','pro_payment_failed','pro_cancelled','account_deleted',
  'review_company','review_post','post_approved','post_rejected','company_suspended'));

-- Calls account-email in the background after the transaction commits; never blocks the caller.
create or replace function public.employer_send_email(p_kind text, p_user uuid, p_key text, p_data jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_user is null then return; end if;
  perform net.http_post(
    url := 'https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/account-email',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret')),
    body := jsonb_build_object('kind', p_kind, 'user_id', p_user, 'key', p_key, 'data', p_data),
    timeout_milliseconds := 20000);
exception when others then null;
end $$;
revoke all on function public.employer_send_email(text, uuid, text, jsonb) from public, anon, authenticated;

-- New company: tell every reviewer.
create or replace function public.employer_notify_new_org() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; reg text;
begin
  select email into reg from auth.users where id = new.created_by;
  for r in select user_id from employer_operators loop
    perform public.employer_send_email('review_company', r.user_id, 'org:' || new.id,
      jsonb_build_object('company', new.name, 'domain', new.primary_domain, 'registrant', reg,
                         'auto_verified', new.status = 'verified'));
  end loop;
  return null;
end $$;
drop trigger if exists employer_orgs_notify_new on public.employer_orgs;
create trigger employer_orgs_notify_new after insert on public.employer_orgs
  for each row execute function public.employer_notify_new_org();

-- Company suspended or rejected: tell the people who registered and own it.
create or replace function public.employer_notify_org_status() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; note text;
begin
  if new.status in ('suspended','rejected') and old.status is distinct from new.status then
    select a.detail->>'note' into note from employer_audit a
     where a.org_id = new.id and a.action = 'status_' || new.status order by a.at desc limit 1;
    for r in select user_id from employer_org_members where org_id = new.id and status = 'active' loop
      perform public.employer_send_email('company_suspended', r.user_id, new.status || ':' || new.id || ':' || extract(epoch from now())::bigint,
        jsonb_build_object('company', new.name, 'status', new.status, 'note', note));
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists employer_orgs_notify_status on public.employer_orgs;
create trigger employer_orgs_notify_status after update of status on public.employer_orgs
  for each row execute function public.employer_notify_org_status();

-- Posts: decided at commit time (deferred), so a post the automatic rule published in the same
-- transaction is not reported as waiting.
create or replace function public.employer_notify_post() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare p employer_posts; o employer_orgs; r record; guard text;
begin
  select * into p from employer_posts where id = new.id;
  if not found then return null; end if;
  -- Several changes to one post in a transaction queue several checks; act once per revision.
  guard := 'fj.notified_' || md5(p.id::text || ':' || p.revision || ':' || p.status || ':' || coalesce(p.reviewed_revision, -1));
  if current_setting(guard, true) = '1' then return null; end if;
  perform set_config(guard, '1', true);
  select * into o from employer_orgs where id = p.org_id;
  -- Waiting for a person.
  if (p.status = 'pending_review' or p.has_unreviewed_changes) and (p.reviewed_revision is distinct from p.revision) then
    for r in select user_id from employer_operators where not public.employer_is_member(p.org_id, user_id) loop
      perform public.employer_send_email('review_post', r.user_id, 'post:' || p.id || ':' || p.revision,
        jsonb_build_object('company', o.name, 'domain', o.primary_domain, 'title', p.job_title, 'apply_url', p.apply_url,
                           'edit', p.has_unreviewed_changes));
    end loop;
  -- A reviewer decided (a rejection leaves a note and keeps any live version; an approval clears it).
  elsif p.reviewed_by is not null and p.reviewed_at > now() - interval '1 minute' and not p.has_unreviewed_changes
        and (p.review_note is not null or p.reviewed_revision = p.revision) then
    perform public.employer_send_email(
      case when p.review_note is not null then 'post_rejected' else 'post_approved' end,
      p.created_by, 'decision:' || p.id || ':' || p.revision,
      jsonb_build_object('company', o.name, 'title', p.job_title, 'note', p.review_note,
                         'live', p.status = 'published'));
  end if;
  return null;
end $$;
drop trigger if exists employer_posts_notify on public.employer_posts;
create constraint trigger employer_posts_notify after insert or update on public.employer_posts
  deferrable initially deferred for each row execute function public.employer_notify_post();

revoke all on function public.employer_notify_new_org(), public.employer_notify_org_status(), public.employer_notify_post() from public, anon, authenticated;

-- The company registered under info@ before this change matches its domain: verify it the same way.
update public.employer_orgs o set status = 'verified', domain_verified_at = coalesce(domain_verified_at, now()),
       domain_verify_method = 'work_email', verified_at = coalesce(verified_at, now()), updated_at = now()
 where o.status = 'pending'
   and exists (select 1 from auth.users a where a.id = o.created_by and a.email_confirmed_at is not null
               and (lower(split_part(a.email, '@', 2)) = o.primary_domain or lower(split_part(a.email, '@', 2)) like '%.' || o.primary_domain))
   and not exists (select 1 from employer_orgs x where x.primary_domain = o.primary_domain and x.id <> o.id and x.status in ('verified','suspended'));

-- ── Rollback ─────────────────────────────────────────────────────────────────────────────
-- drop trigger employer_posts_notify on public.employer_posts;
-- drop trigger employer_orgs_notify_status on public.employer_orgs;
-- drop trigger employer_orgs_notify_new on public.employer_orgs;
-- then re-apply employer_register_org / employer_submit_post / operator_set_org_status /
-- operator_queue / employer_active_limit from migrations/pending/20261024* and 20261016*.
