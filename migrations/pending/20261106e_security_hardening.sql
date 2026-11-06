-- Security hardening (Franklin approved "Fix security first", Nov 6).
-- 1. Profile photos: the avatars bucket becomes private. The site shows photos through
--    short-lived signed links (react/src/account/components.jsx). Owner-only policies stay.
update storage.buckets set public = false where id = 'avatars';

-- 2. job_matches (old Live Search results; Live Search is paused): no public or account
--    access. The live-search Edge Function uses the service role and is unaffected.
drop policy if exists "public can read job matches" on public.job_matches;
revoke all on public.job_matches from anon, authenticated;

-- 3. Fixed search_path on the functions the security advisor flagged.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('fja_norm_mode','fja_fmt_num','fja_url','fja_norm_emp','fja_insert_batch','fja_norm_salary','employer_free_email_domain')
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;

-- Check: avatars_public = false, job_matches_anon = false, unfixed_functions = 0
select (select public from storage.buckets where id = 'avatars') as avatars_public,
       has_table_privilege('anon', 'public.job_matches', 'select') as job_matches_anon,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('fja_norm_mode','fja_fmt_num','fja_url','fja_norm_emp','fja_insert_batch','fja_norm_salary','employer_free_email_domain')
           and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) as unfixed_functions;

-- Rollback:
--   update storage.buckets set public = true where id = 'avatars';
--   create policy "public can read job matches" on public.job_matches for select using (true); grant select on public.job_matches to anon, authenticated;
--   alter function <each> reset search_path;
