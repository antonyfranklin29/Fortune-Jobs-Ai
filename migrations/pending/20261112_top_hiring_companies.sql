begin;

-- Keep the public catalogue's row-level visibility rules, including employer revocations.
create function public.top_hiring_companies("limit" integer default 24)
returns table(company text, open_jobs bigint)
language sql stable security invoker set search_path = ''
as $$
  with exclusions as (
    select array['indeed', 'eliassen group', 'insight global', 'robert half',
      'system one', 'kimmel associates', 'bright vision technologies', 'dataannotation']::text[] as names,
      '(staffing|recruit|talent)'::text as pattern
  ), names as (
    select btrim(regexp_replace(j.company, '[[:space:]]+', ' ', 'g')) as display
    from public.pre_scraped_jobs j
    where j.country = 'us' and j.closed_at is null
      and (j.expires_at is null or j.expires_at > now())
      and j.company is not null and char_length(j.company) <= 200
  ), normalized as (
    select display, lower(display) as grouping,
      btrim(regexp_replace(lower(display), '[^[:alnum:]]+', ' ', 'g')) as lookup
    from names
  )
  select min(n.display) as company, count(*) as open_jobs
  from normalized n cross join exclusions e
  where n.lookup <> '' and n.lookup !~ e.pattern
    and not exists (select from unnest(e.names) as excluded(name)
      where n.lookup = excluded.name or starts_with(n.lookup, excluded.name || ' '))
  group by n.grouping
  order by open_jobs desc, company asc
  limit greatest(0, least(coalesce($1, 24), 24))
$$;

revoke all on function public.top_hiring_companies(integer) from public;
grant execute on function public.top_hiring_companies(integer) to anon, authenticated;

commit;
