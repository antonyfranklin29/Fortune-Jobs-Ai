-- PENDING — NOT APPLIED. Employer domain rule (decided by the owner on 2026-10-17:
-- "Company domain and subdomains"). Apply AFTER every 20261016–20261025 employer migration.
--
-- An organisation can be registered only by someone whose sign-in email is at the company
-- domain or a subdomain of it (username@organisation.com, or username@team.organisation.com).
-- Free-mail providers never qualify, either as the registrant's address or as the company
-- domain. Google sign-in is allowed, but only a Google account whose email is at the company
-- domain passes this check, so a personal Gmail account cannot claim a company.
--
-- Registration is the only path that creates an organisation or its first owner, so this
-- check covers every way a company is claimed. Verification (DNS proof and operator review)
-- still applies on top of it.
--
-- Replaces employer_register_org from 20261018. Only the function body changes; its signature,
-- grants and the domain-claim rules are kept.

create or replace function public.employer_free_email_domain(p_domain text)
returns boolean language sql immutable as $$
  select exists (
    select 1
    from unnest(array[
      'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
      'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'aol.com',
      'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me', 'pm.me',
      'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'zoho.com', 'tutanota.com',
      'hey.com', 'fastmail.com', 'qq.com', '163.com', '126.com'
    ]) as free(domain)
    where lower(p_domain) = free.domain or lower(p_domain) like '%.' || free.domain
  );
$$;
revoke all on function public.employer_free_email_domain(text) from public, anon, authenticated;

create or replace function public.employer_register_org(p_name text, p_domain text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); d text := lower(btrim(p_domain)); o employer_orgs; email_domain text;
begin
  if (select count(*) from employer_org_members where user_id = u and status = 'active') >= 3 then
    raise exception 'too_many_organizations';
  end if;

  -- The registrant must sign in with an address at the company's domain or a subdomain.
  select lower(split_part(email, '@', 2)) into email_domain from auth.users where id = u;
  if email_domain is null or email_domain = '' or public.employer_free_email_domain(email_domain) then
    raise exception 'company_email_required';
  end if;
  if public.employer_free_email_domain(d) then
    raise exception 'free_email_domain_not_allowed';
  end if;
  if not (email_domain = d or email_domain like '%.' || d) then
    raise exception 'email_domain_mismatch';
  end if;

  -- Only a verified or suspended organisation claims a domain. Pending registrations
  -- from anyone else are allowed; they cannot verify without DNS proof of the domain.
  if exists (select 1 from employer_orgs where primary_domain = d and status in ('verified','suspended')) then
    raise exception 'domain_already_registered';
  end if;
  insert into employer_orgs (name, primary_domain, created_by) values (btrim(p_name), d, u) returning * into o;
  insert into employer_org_members (org_id, user_id, role) values (o.id, u, 'owner');
  insert into employer_domain_challenges (org_id) values (o.id);
  perform public.employer_audit_log(u, 'employer', o.id, 'org', o.id::text, 'registered',
    jsonb_build_object('domain', d, 'email_domain_matches', true));
  return jsonb_build_object('org_id', o.id, 'status', o.status,
    'dns_record', '_fortunejobsai.' || d,
    'dns_value', 'fortunejobsai-verify=' || (select token from employer_domain_challenges where org_id = o.id));
exception when unique_violation then
  raise exception 'domain_already_registered';
end $$;
