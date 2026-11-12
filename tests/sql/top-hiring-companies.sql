-- Run against a disposable database with the hiring RPC and fixture catalogue installed.
-- The fixture catalogue has a boolean visible column and an owner-only policy.
begin;
insert into public.pre_scraped_jobs(company, country, closed_at, expires_at, visible) values
  ('Oracle', 'us', null, null, true),
  (' oracle ', 'us', null, null, true),
  ('Oracle', 'us', now(), null, true),
  ('Oracle', 'us', null, now() - interval '1 hour', true),
  ('Oracle', 'ca', null, null, true),
  ('Private Fixture', 'us', null, null, false),
  ('Example & Co.', 'us', null, null, true);
insert into public.pre_scraped_jobs(company, country)
select name, 'us' from unnest(array[
  'Indeed', 'Eliassen Group LLC', 'Insight Global', 'Robert Half', 'System One',
  'Kimmel & Associates', 'Bright Vision Technologies', 'DataAnnotation',
  'Acme Staffing', 'Acme Recruiting', 'Acme Talent'
]) as exclusions(name);

set local role anon;
do $$
begin
  if (select count(*) from public.top_hiring_companies(24)) <> 2 then
    raise exception 'Exclusions or row-level visibility did not apply';
  end if;
  if (select open_jobs from public.top_hiring_companies(1) where lower(company) = 'oracle') is distinct from 2::bigint then
    raise exception 'Ranking, grouping, or open U.S. filters are incorrect';
  end if;
  if exists (select from public.top_hiring_companies(0)) then
    raise exception 'Zero limit should return zero results';
  end if;
end $$;
rollback;
