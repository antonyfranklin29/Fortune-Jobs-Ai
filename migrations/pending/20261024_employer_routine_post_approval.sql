-- Apply after the employer concurrency and URL-conflict migrations.
-- Company verification remains a separate, one-time human decision. Once verified,
-- an owner may publish a low-risk, first-party direct post without another reviewer.
-- Everything else stays in the existing review queue. No client-supplied approval
-- field is trusted; the decision and the quota check both run in the database.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$ begin
  if to_regprocedure('public.employer_lock_post_parties(uuid)') is null
     or to_regprocedure('public.employer_publish_post_internal(uuid,uuid,text)') is null then
    raise exception 'apply employer concurrency and publication migrations first';
  end if;
end $$;

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
    and o.verified_by is not null
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
    return jsonb_build_object('id', p.id, 'status', p.status,
      'published', false, 'review', 'manual');
  end if;

  -- The row and organisation locks bind the automatic decision to this exact
  -- revision and serialize the per-company daily limit and active-post quota.
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

revoke all on function public.employer_submit_post(uuid) from public, anon, authenticated;
grant execute on function public.employer_submit_post(uuid) to authenticated, service_role;
commit;
