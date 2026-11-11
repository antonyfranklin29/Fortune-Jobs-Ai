begin;

alter table public.pre_scraped_jobs
  add column sponsorship text check (sponsorship in ('sponsors', 'opt_friendly', 'no_sponsorship', 'unknown'));

create function public.classify_job_sponsorship(title text, description text)
returns text language sql immutable parallel safe set search_path = '' as $$
  with listing as (
    select lower(regexp_replace(regexp_replace(
      translate(concat_ws(' ', title, description), '‐‑‒–—', '-----'),
      '<[^>]*>|&nbsp;|&#160;', ' ', 'gi'), '[[:space:]]+', ' ', 'g')) as body
  )
  select case
    when body ~ '\m(no|without|not eligible for|not offer|not provide|not support|cannot provide|cannot offer) (employment |work |immigration |visa |h-?1b )*sponsorship\M'
      or body ~ '\m(visa |h-?1b |employment |work |immigration )*sponsorship (is |will be )?(not (available|offered|provided|supported|considered|be provided|be offered)|unavailable)\M'
      or body ~ '\m(will not|do not|does not|can not|cannot|can''t|won''t|unable to|not able to) (be able to )?sponsor\M'
      or body ~ '\m(visa |h-?1b )?sponsorship will not be (available|provided|offered|supported)\M'
      or body ~ '\m(u\.?s\.?|united states) citizen(ship|s)?( is)? (only|required)\M|\monly u\.?s\.? citizens\M|\mmust be a u\.?s\.? citizen\M|\msecurity clearance (is )?required\M|\mrequires (an? |active )?security clearance\M'
      or body ~ '\m(no|not accepting|cannot accept|do not accept) (candidates (on|with) )?(stem[- ]?)?(opt|cpt)( candidates| students| applicants| status| visa)?([ ,/]|$)'
      then 'no_sponsorship'
    when body ~ '\m(visa|h-?1b|employment visa|work visa|immigration) sponsorship (is )?(available|provided|offered|supported|considered)\M'
      or body ~ '\m(we will|we can|we do|employer will|company will) sponsor( eligible| qualified)?( candidates| applicants| visas?| h-?1b)?\M'
      or body ~ '\mwill sponsor (work|employment|visa|h-?1b|eligible candidates|qualified candidates|candidates|applicants)\M'
      or body ~ '\m(offers?|provides?|supports?) (employment |work )?visa sponsorship\M'
      then 'sponsors'
    when body ~ '\m(stem[- ]?)?(opt|cpt)([ /]+(opt|cpt))? (candidates |students |applicants )?(are )?(welcome|accepted|eligible|encouraged|supported)\M'
      or body ~ '\m(accepts?|welcomes?|supports?) (candidates (on|with) )?(f-?1 )?(stem[- ]?)?(opt|cpt)([ /]+(opt|cpt))?\M'
      or body ~ '\mf-?1 (visa )?students (are )?(welcome|eligible|encouraged)\M'
      or body ~ '\m(stem[- ]opt|optional practical training|curricular practical training)\M'
      or body ~ '\mopt */ *cpt\M|\mcpt */ *opt\M'
      then 'opt_friendly'
    else 'unknown'
  end from listing
$$;

create function public.set_job_sponsorship()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.sponsorship := public.classify_job_sponsorship(new.job_title, new.job_description);
  return new;
end;
$$;

create trigger pre_scraped_jobs_sponsorship
before insert or update of job_title, job_description on public.pre_scraped_jobs
for each row execute function public.set_job_sponsorship();

create function public.backfill_job_sponsorship()
returns bigint language plpgsql set search_path = '' as $$
declare
  changed bigint;
begin
  with classified as materialized (
    select id, public.classify_job_sponsorship(job_title, job_description) as status
    from public.pre_scraped_jobs
  )
  update public.pre_scraped_jobs as job set sponsorship = classified.status
  from classified
  where job.id = classified.id and job.sponsorship is distinct from classified.status;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke execute on function public.classify_job_sponsorship(text, text) from public, anon, authenticated;
grant execute on function public.classify_job_sponsorship(text, text) to service_role;
revoke execute on function public.set_job_sponsorship() from public, anon, authenticated;
revoke execute on function public.backfill_job_sponsorship() from public, anon, authenticated;
grant execute on function public.backfill_job_sponsorship() to service_role;

-- After this transaction commits, a database operator can run
-- select public.backfill_job_sponsorship();
-- Backfilling separately avoids holding the DDL lock while classifying rows.

commit;
