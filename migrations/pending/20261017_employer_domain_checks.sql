-- Apply after employer_submissions. No production changes made by this file.
-- Claim DNS work under the same organization lock used for status changes.
begin;
alter table public.employer_domain_challenges add column if not exists attempt_id uuid;

create or replace function public.employer_domain_check_begin(p_org uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o employer_orgs; c employer_domain_challenges; a uuid := gen_random_uuid();
begin
  select * into o from employer_orgs where id = p_org for update;
  if not found or not public.employer_is_member(p_org, p_user)
     or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null)
  then return jsonb_build_object('state','not_found'); end if;
  if o.status not in ('pending','verified') then return jsonb_build_object('state','inactive'); end if;
  if o.domain_verified_at is not null then return jsonb_build_object('state','verified'); end if;
  select * into c from employer_domain_challenges where org_id=p_org for update;
  if not found then return jsonb_build_object('state','not_found'); end if;
  if c.checked_at > clock_timestamp()-interval '1 minute' then return jsonb_build_object('state','rate_limited'); end if;
  update employer_domain_challenges set checked_at=clock_timestamp(),attempt_id=a,last_result='checking' where org_id=p_org;
  return jsonb_build_object('state','lookup','domain',o.primary_domain,'token',c.token,'attempt_id',a);
end $$;

create or replace function public.employer_domain_check_finish(p_org uuid, p_user uuid, p_attempt uuid, p_token text, p_matched boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o employer_orgs; c employer_domain_challenges;
begin
  select * into o from employer_orgs where id=p_org for update;
  if not found or o.status not in ('pending','verified') or not public.employer_is_member(p_org,p_user)
  then return jsonb_build_object('state','invalidated'); end if;
  select * into c from employer_domain_challenges where org_id=p_org for update;
  if not found or p_attempt is null or c.checked_at is null or c.attempt_id is distinct from p_attempt or c.token is distinct from p_token
     or c.checked_at < clock_timestamp()-interval '2 minutes'
  then return jsonb_build_object('state','invalidated'); end if;
  update employer_domain_challenges set last_result=case when p_matched is true then 'match' else 'mismatch' end,
    attempt_id=null where org_id=p_org;
  if p_matched is true then
    update employer_orgs set domain_verified_at=coalesce(domain_verified_at,now()),domain_verify_method='dns_txt',updated_at=now() where id=p_org;
    perform public.employer_audit_log(p_user,'employer',p_org,'org',p_org::text,'domain_verified_dns');
  end if;
  return jsonb_build_object('state','finished','verified',p_matched is true);
end $$;

-- Legacy backend helper also must not report successful verification of a
-- suspended/rejected org. Retained for existing service tooling/tests.
create or replace function public.employer_mark_domain_verified(p_org uuid,p_token text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare o employer_orgs;
begin
  select * into o from employer_orgs where id=p_org for update;
  if not found or o.status not in ('pending','verified') then return false; end if;
  update employer_domain_challenges set checked_at=now(),attempt_id=null,
    last_result=case when token=p_token then 'match' else 'mismatch' end where org_id=p_org;
  if not exists(select 1 from employer_domain_challenges where org_id=p_org and token=p_token) then return false; end if;
  update employer_orgs set domain_verified_at=coalesce(domain_verified_at,now()),domain_verify_method='dns_txt',updated_at=now() where id=p_org;
  perform public.employer_audit_log(null,'service',p_org,'org',p_org::text,'domain_verified_dns');
  return true;
end $$;

revoke all on function public.employer_domain_check_begin(uuid,uuid), public.employer_domain_check_finish(uuid,uuid,uuid,text,boolean), public.employer_mark_domain_verified(uuid,text) from public,anon,authenticated;
grant execute on function public.employer_domain_check_begin(uuid,uuid), public.employer_domain_check_finish(uuid,uuid,uuid,text,boolean), public.employer_mark_domain_verified(uuid,text) to service_role;
commit;
