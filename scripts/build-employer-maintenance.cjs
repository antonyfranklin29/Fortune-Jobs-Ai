// Generates reviewed SQL only. Never connects or activates destructive cleanup.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function buildUpgrade(){
 const sql=fs.readFileSync(path.join(root,'migrations/pending/20261025_employer_maintenance.sql'),'utf8').replace(/^\s*(begin|commit);\s*$/gmi,'');
 return `begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$ begin
 if to_regclass('public.employer_refresh_control') is null then raise exception 'refresh baseline missing'; end if;
 if to_regclass('public.employer_maintenance_control') is not null then raise exception 'maintenance already installed'; end if;
end $$;
create temporary table maintenance_previous_functions on commit drop as
 select oid,proname,proacl::text acl,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace
   and (proname like 'employer_%' or proname like 'operator_%');
${sql}
do $$ begin
 if exists(select 1 from maintenance_previous_functions a join pg_proc p on p.oid=a.oid where p.proacl::text is distinct from a.acl)
   then raise exception 'existing grants changed'; end if;
 if exists(select 1 from maintenance_previous_functions a join pg_proc p on p.oid=a.oid where a.proname<>'employer_feed_run_prune' and pg_get_functiondef(p.oid)<>a.definition)
   then raise exception 'unrelated function changed'; end if;
 if (select cleanup_enabled from employer_maintenance_control) then raise exception 'cleanup must remain disabled'; end if;
 if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname like 'employer_maintenance_%'
   and (has_function_privilege('anon',oid,'EXECUTE') or has_function_privilege('authenticated',oid,'EXECUTE')))
   then raise exception 'unexpected ordinary-role maintenance access'; end if;
end $$;
notify pgrst,'reload schema';commit;
select employer_maintenance_run(false,25) as maintenance_preview;
`;
}
function buildSchedule({installExtension=false}={}){
 return `begin;
set local lock_timeout='5s';set local statement_timeout='30s';
${installExtension?'create extension if not exists pg_cron;':''}
do $$ begin
 if to_regprocedure('cron.schedule(text,text,text)') is null then raise exception 'pg_cron is not installed'; end if;
 if to_regprocedure('public.employer_maintenance_run(boolean,integer)') is null then raise exception 'maintenance baseline missing'; end if;
 if exists(select 1 from public.employer_maintenance_control where cleanup_enabled) then raise exception 'cleanup must remain disabled'; end if;
 if exists(select 1 from cron.job where jobname='fortunejobsai-employer-maintenance-dry-run' and username=current_user
   and (database<>current_database() or command<>'select public.employer_maintenance_run(false,25);')) then raise exception 'maintenance schedule conflict'; end if;
end $$;
-- Cron is backend-only. No new scheduler access is given to visitors or users.
-- Managed extension functions can retain owner-controlled PUBLIC EXECUTE.
-- Removing schema USAGE is the effective gate to every qualified cron call.
revoke all on schema cron from public,anon,authenticated;
revoke all on all functions in schema cron from public,anon,authenticated;
revoke all on all tables in schema cron from public,anon,authenticated;
do $$ begin
 if has_schema_privilege('anon','cron','USAGE') or has_schema_privilege('authenticated','cron','USAGE')
   then raise exception 'unexpected ordinary-role scheduler access'; end if;
end $$;
select cron.schedule('fortunejobsai-employer-maintenance-dry-run','15 8 * * *','select public.employer_maintenance_run(false,25);');
commit;
select employer_maintenance_health() as maintenance_schedule;
`;
}
module.exports={buildUpgrade,buildSchedule};
if(require.main===module)process.stdout.write(process.argv.includes('--schedule')?buildSchedule({installExtension:process.argv.includes('--install-extension')}):buildUpgrade());
