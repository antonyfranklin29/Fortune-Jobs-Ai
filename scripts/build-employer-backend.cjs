// One atomic, reviewable first-install bundle. Does not connect to any database.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const files=['20261016_employer_feed_runs.sql','20261016_employer_submissions.sql',
 '20261017_employer_feed_registry_bridge.sql','20261017_employer_feed_publish_hardening.sql',
 '20261017_employer_domain_checks.sql','20261017_employer_account_deletion.sql',
 '20261017_employer_search_visibility.sql','20261018_employer_access_hardening.sql',
 '20261019_employer_pending_account_cleanup.sql','20261019_employer_concurrency_hardening.sql',
 '20261020_employer_post_actions.sql','20261021_employer_feed_concurrency_hardening.sql',
 '20261022_employer_paused_post_state.sql','20261023_employer_lease_selection_url_hardening.sql'];
function build(){
 const parts=files.map(name=>{const sql=fs.readFileSync(path.join(root,'migrations/pending',name),'utf8');
  return '-- '+name+' SHA256 '+crypto.createHash('sha256').update(sql).digest('hex')+'\n'+sql.replace(/^\s*(begin|commit);\s*$/gmi,'');});
 return `-- First install only. No employers, reviewers, jobs or entitlements are created.\nbegin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
 if to_regclass('public.employer_orgs') is not null then raise exception 'employer backend already present; review before applying'; end if;
 if to_regclass('public.ingest_roles') is null or to_regclass('public.ingest_regions') is null then raise exception 'missing ingest prerequisites'; end if;
end $$;\n${parts.join('\n\n')}
do $$ declare r record; begin
 for r in select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and c.relname like 'employer_%' loop
  if has_table_privilege('anon',r.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('authenticated',r.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'unexpected employer table grant'; end if;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
   and (p.proname like 'employer_%' or p.proname like 'operator_%')
   and p.proname<>'employer_public_listing_keys' and has_function_privilege('anon',p.oid,'EXECUTE')) then raise exception 'unexpected anonymous employer RPC'; end if;
 if not exists(select 1 from employer_billing_config where id and free_active_posts=15 and monthly_price_cents=1499
   and currency='USD' and not paid_publishing_enabled and paid_active_limit is null) then raise exception 'billing must stay disabled'; end if;
 if exists(select 1 from employer_operators) then raise exception 'no real reviewers should be granted by installation'; end if;
end $$;
notify pgrst,'reload schema';
commit;
select 'employer_backend_installed_payments_disabled' as result;\n`;
}
// Existing installations receive only the selected function updates, never
// the first-install DDL. No user/company/post row is changed by this transaction.
function buildUpgrade({feed=false}={}){
 const names=feed?['20261021_employer_feed_concurrency_hardening.sql','20261022_employer_paused_post_state.sql']
  :['20261019_employer_concurrency_hardening.sql','20261020_employer_post_actions.sql'];
 const parts=names.map(name=>{const sql=fs.readFileSync(path.join(root,'migrations/pending',name),'utf8');
  return '-- '+name+' SHA256 '+crypto.createHash('sha256').update(sql).digest('hex')+'\n'+sql.replace(/^\s*(begin|commit);\s*$/gmi,'');});
 return `begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
 ${feed?`if to_regprocedure('public.employer_lock_post_parties(uuid)') is null then raise exception 'employer concurrency baseline missing'; end if;
 if position('feed_closed_approver_deleted' in pg_get_functiondef('public.employer_before_account_deleted()'::regprocedure))>0 then raise exception 'feed upgrade already present; review before applying'; end if;`
 :`if to_regprocedure('public.employer_user_eligible(uuid)') is null then raise exception 'employer access baseline missing'; end if;
 if to_regprocedure('public.employer_lock_post_parties(uuid)') is not null then raise exception 'concurrency upgrade already present; review before applying'; end if;`}
end $$;
create temporary table employer_upgrade_acl on commit drop as
 select p.oid,p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname like 'employer_%' or p.proname like 'operator_%');
${parts.join('\n\n')}
do $$ declare helper text; r record; begin
 if exists(select 1 from employer_upgrade_acl a join pg_proc p on p.oid=a.oid where p.proacl::text is distinct from a.acl)
 then raise exception 'existing employer function grants changed'; end if;
 foreach helper in array array['public.employer_lock_actor(uuid)','public.employer_lock_post_parties(uuid)'] loop
  if has_function_privilege('anon',helper,'EXECUTE') or has_function_privilege('authenticated',helper,'EXECUTE')
     or has_function_privilege('service_role',helper,'EXECUTE') then raise exception 'new lock helper must stay private'; end if;
 end loop;
 for r in select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p') and c.relname like 'employer_%' loop
  if has_table_privilege('anon',r.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('authenticated',r.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'unexpected employer table grant'; end if;
 end loop;
 if not exists(select 1 from employer_billing_config where id and free_active_posts=15 and monthly_price_cents=1499
   and currency='USD' and not paid_publishing_enabled and paid_active_limit is null) then raise exception 'billing must remain disabled'; end if;
end $$;
notify pgrst,'reload schema';
commit;
select '${feed?'employer_feed_upgrade_applied_payments_disabled':'employer_concurrency_upgrade_applied_payments_disabled'}' as result;
`;
}
// Upgrade for an installation that already has 20261021 and 20261022 (production as of 2026-10-16).
// Refuses to run twice. Same ACL check as the feed upgrade; changes no rows.
function buildLeaseUpgrade(){
 const name='20261023_employer_lease_selection_url_hardening.sql';
 const sql=fs.readFileSync(path.join(root,'migrations/pending',name),'utf8');
 return `begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
 if position('feed_closed_approver_deleted' in pg_get_functiondef('public.employer_before_account_deleted()'::regprocedure))=0 then raise exception 'apply 20261021 and 20261022 first'; end if;
 if position('Lost a concurrent URL claim' in pg_get_functiondef('public.employer_publish_post_internal(uuid,uuid,text)'::regprocedure))>0 then raise exception 'lease and URL upgrade already present; review before applying'; end if;
end $$;
create temporary table employer_upgrade_acl on commit drop as
 select p.oid,p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname like 'employer_%' or p.proname like 'operator_%');
-- 20261023 SHA256 ${crypto.createHash('sha256').update(sql).digest('hex')}
${sql.replace(/^\s*(begin|commit);\s*$/gmi,'')}
do $$ begin
 if exists(select 1 from employer_upgrade_acl a join pg_proc p on p.oid=a.oid where p.proacl::text is distinct from a.acl)
 then raise exception 'existing employer function grants changed'; end if;
 if not exists(select 1 from employer_billing_config where id and free_active_posts=15 and monthly_price_cents=1499
   and currency='USD' and not paid_publishing_enabled and paid_active_limit is null) then raise exception 'billing must remain disabled'; end if;
end $$;
notify pgrst,'reload schema';
commit;
select 'employer_lease_selection_upgrade_applied_payments_disabled' as result;
`;
}
const buildFeedUpgrade=()=>buildUpgrade({feed:true});
module.exports={build,files,buildUpgrade,buildFeedUpgrade,buildLeaseUpgrade};
if(require.main===module)process.stdout.write(process.argv.includes('--lease-upgrade')?buildLeaseUpgrade():process.argv.includes('--feed-upgrade')?buildFeedUpgrade():process.argv.includes('--concurrency-upgrade')?buildUpgrade():build());
