-- PENDING — NOT APPLIED. Access hardening from the employer access review
-- (docs/claude-employer-access-review.md). Apply AFTER every 20261016/20261017
-- employer migration; it refuses to run if the search-visibility migration is missing.
--
-- Fixes, each with a test in tests/sql/employer-access.sql:
--   1. Banned and deleted accounts lose employer and reviewer access at once,
--      not when their existing session expires, including the DNS domain-proof RPCs. Uses auth.users.banned_until and
--      deleted_at, which production has (checked read-only on 2026-10-15).
--   2. A job seeker can no longer block a company by registering its domain or
--      Greenhouse/Lever board first. Pending claims may coexist; only a verified or
--      suspended organisation claims a domain, and only an approved source claims a
--      board. Ownership still requires DNS proof and operator approval, so a pending
--      claim gains nothing.
--   3. Operators must record why they verify an organisation (the identity check
--      that matches the company name to the domain), and cannot verify a second
--      organisation for a domain that is already claimed.
--   4. The read-only listing-visibility helper is no longer executable by anonymous
--      visitors or signed-in users. The catalogue policy uses
--      employer_public_listing_keys() instead, so nothing needs the old helper.
--
-- Not changed here (documented in the review): organisation name is free text, so
-- identity still depends on operator review; a colluding second account can act as
-- an independent reviewer; and the 3-organisations-per-account cap is per account.

begin;

-- ── 1. account eligibility ───────────────────────────────────────────────────
create or replace function public.employer_caller()
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); acct record;
begin
  if u is null then raise exception 'sign_in_required' using errcode = '42501'; end if;
  select email_confirmed_at, deleted_at, banned_until into acct from auth.users where id = u;
  if not found or acct.email_confirmed_at is null then
    raise exception 'email_not_confirmed' using errcode = '42501';
  end if;
  if acct.deleted_at is not null then
    raise exception 'account_unavailable' using errcode = '42501';
  end if;
  if acct.banned_until is not null and acct.banned_until > now() then
    raise exception 'account_banned' using errcode = '42501';
  end if;
  return u;
end $$;

-- The domain-proof RPCs (20261017_employer_domain_checks) are redefined with the same
-- account rules: confirmed, not deleted, not banned. Signatures and grants are unchanged.
create or replace function public.employer_user_eligible(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from auth.users a where a.id = p_user and a.email_confirmed_at is not null
    and a.deleted_at is null and (a.banned_until is null or a.banned_until <= now()));
$$;
revoke all on function public.employer_user_eligible(uuid) from public, anon, authenticated;

create or replace function public.employer_domain_check_begin(p_org uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o employer_orgs; c employer_domain_challenges; a uuid := gen_random_uuid();
begin
  select * into o from employer_orgs where id = p_org for update;
  if not found or not public.employer_is_member(p_org, p_user) or not public.employer_user_eligible(p_user)
  then return jsonb_build_object('state','not_found'); end if;
  if o.status not in ('pending','verified') then return jsonb_build_object('state','inactive'); end if;
  if o.domain_verified_at is not null then return jsonb_build_object('state','verified'); end if;
  select * into c from employer_domain_challenges where org_id = p_org for update;
  if not found then return jsonb_build_object('state','not_found'); end if;
  if c.checked_at > clock_timestamp() - interval '1 minute' then return jsonb_build_object('state','rate_limited'); end if;
  update employer_domain_challenges set checked_at = clock_timestamp(), attempt_id = a, last_result = 'checking' where org_id = p_org;
  return jsonb_build_object('state','lookup','domain',o.primary_domain,'token',c.token,'attempt_id',a);
end $$;

create or replace function public.employer_domain_check_finish(p_org uuid, p_user uuid, p_attempt uuid, p_token text, p_matched boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o employer_orgs; c employer_domain_challenges;
begin
  select * into o from employer_orgs where id = p_org for update;
  if not found or o.status not in ('pending','verified') or not public.employer_is_member(p_org, p_user)
     or not public.employer_user_eligible(p_user)
  then return jsonb_build_object('state','invalidated'); end if;
  select * into c from employer_domain_challenges where org_id = p_org for update;
  if not found or p_attempt is null or c.checked_at is null or c.attempt_id is distinct from p_attempt or c.token is distinct from p_token
     or c.checked_at < clock_timestamp() - interval '2 minutes'
  then return jsonb_build_object('state','invalidated'); end if;
  update employer_domain_challenges set last_result = case when p_matched is true then 'match' else 'mismatch' end,
    attempt_id = null where org_id = p_org;
  if p_matched is true then
    update employer_orgs set domain_verified_at = coalesce(domain_verified_at, now()), domain_verify_method = 'dns_txt', updated_at = now() where id = p_org;
    perform public.employer_audit_log(p_user, 'employer', p_org, 'org', p_org::text, 'domain_verified_dns');
  end if;
  return jsonb_build_object('state','finished','verified', p_matched is true);
end $$;

-- ── 2. claims: a pending claim cannot block the company that owns it ─────────
drop index if exists public.employer_orgs_domain_uq;
create unique index if not exists employer_orgs_domain_claimed_uq
  on public.employer_orgs (primary_domain) where status in ('verified','suspended');

drop index if exists public.employer_sources_board_uq;
create unique index if not exists employer_sources_board_approved_uq
  on public.employer_sources (adapter, api_region, board_token) where status = 'approved';

create or replace function public.employer_register_org(p_name text, p_domain text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); d text := lower(btrim(p_domain)); o employer_orgs; email_domain text;
begin
  if (select count(*) from employer_org_members where user_id = u and status = 'active') >= 3 then
    raise exception 'too_many_organizations';
  end if;
  -- Only a verified or suspended organisation claims a domain. Pending registrations
  -- from anyone else are allowed; they cannot verify without DNS proof of the domain.
  if exists (select 1 from employer_orgs where primary_domain = d and status in ('verified','suspended')) then
    raise exception 'domain_already_registered';
  end if;
  insert into employer_orgs (name, primary_domain, created_by) values (btrim(p_name), d, u) returning * into o;
  insert into employer_org_members (org_id, user_id, role) values (o.id, u, 'owner');
  insert into employer_domain_challenges (org_id) values (o.id);
  select lower(split_part(email, '@', 2)) into email_domain from auth.users where id = u;
  perform public.employer_audit_log(u, 'employer', o.id, 'org', o.id::text, 'registered',
    jsonb_build_object('domain', d, 'email_domain_matches', email_domain = d or email_domain like '%.' || d));
  return jsonb_build_object('org_id', o.id, 'status', o.status,
    'dns_record', '_fortunejobsai.' || d,
    'dns_value', 'fortunejobsai-verify=' || (select token from employer_domain_challenges where org_id = o.id));
exception when unique_violation then
  raise exception 'domain_already_registered';
end $$;

-- ── 3. operator verification: a recorded reason, and one verified org per domain
create or replace function public.operator_set_org_status(p_org uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_require_operator(p_org); o employer_orgs;
begin
  if p_status not in ('verified','rejected','suspended') then raise exception 'invalid_status'; end if;
  if p_status = 'verified' and coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  o := public.employer_lock_org(p_org);
  if p_status = 'verified' and o.domain_verified_at is null then raise exception 'domain_not_verified'; end if;
  if p_status = 'verified' and exists (select 1 from employer_orgs x
        where x.primary_domain = o.primary_domain and x.id <> p_org and x.status in ('verified','suspended')) then
    raise exception 'domain_already_claimed';
  end if;
  update employer_orgs set status = p_status, verified_by = case when p_status = 'verified' then u else verified_by end,
         verified_at = case when p_status = 'verified' then now() else verified_at end, updated_at = now()
   where id = p_org;
  if p_status in ('rejected','suspended') then
    update pre_scraped_jobs set closed_at = now() where employer_org_id = p_org and closed_at is null;
    update employer_sources set enabled = false, status = case when status = 'approved' then 'revoked' else status end,
           revision = revision + 1, updated_at = now() where org_id = p_org and status in ('approved','pending');
  end if;
  perform public.employer_audit_log(u, 'operator', p_org, 'org', p_org::text, 'status_' || p_status, jsonb_build_object('note', left(p_note, 500)));
end $$;

-- ── 4. the read-only visibility helper is no longer public ───────────────────
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pre_scraped_jobs'
             and qual like '%employer_listing_visible%') then
    raise exception 'apply 20261017_employer_search_visibility.sql before 20261018_employer_access_hardening.sql';
  end if;
end $$;
revoke all on function public.employer_listing_visible(uuid, text) from public, anon, authenticated;

commit;
