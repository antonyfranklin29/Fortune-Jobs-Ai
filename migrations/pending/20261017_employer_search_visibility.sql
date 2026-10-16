-- Compute a permission set once per statement (hashed RLS subplan), rather
-- than one SECURITY DEFINER call per employer catalogue row. Returns ONLY
-- org/source keys already readable on eligible public catalogue listings.
-- No permission evidence, private registry-only source IDs or company data.
begin;
create or replace function public.employer_public_listing_keys()
returns setof text language sql stable security definer set search_path=public,pg_temp as $$
  select distinct j.employer_org_id::text || ':' || coalesce(j.employer_source_id,'')
    from pre_scraped_jobs j join employer_orgs o on o.id=j.employer_org_id
    left join employer_sources s on s.id=j.employer_source_id and s.org_id=o.id
   where j.closed_at is null and (j.expires_at is null or j.expires_at>now())
     and o.status='verified'
     and (j.employer_source_id is null or (s.status='approved' and s.enabled
          and s.allow_display and s.authorization_expires_at>now()));
$$;
revoke all on function public.employer_public_listing_keys() from public,anon,authenticated;
grant execute on function public.employer_public_listing_keys() to anon,authenticated,service_role;

alter policy "public can read pre-scraped jobs" on public.pre_scraped_jobs
  using (closed_at is null and (expires_at is null or expires_at>now())
    and (employer_org_id is null or
      (employer_org_id::text || ':' || coalesce(employer_source_id,'')) in
        (select public.employer_public_listing_keys())));

commit;
