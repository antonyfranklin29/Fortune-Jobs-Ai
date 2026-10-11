-- Job listings are written by the trusted backend, never by browser visitors.
-- SELECT is preserved for the existing Quick Match and Live Search clients.
-- Apply only with a bounded live check and verify Make uses a backend credential.
begin;
do $$
begin
  if not has_table_privilege('service_role','public.job_matches','INSERT') then
    raise exception 'Trusted backend INSERT permission must exist before lockdown';
  end if;
end $$;
revoke insert, update, delete, truncate, references, trigger
  on public.job_matches, public.pre_scraped_jobs from anon, authenticated;
commit;
