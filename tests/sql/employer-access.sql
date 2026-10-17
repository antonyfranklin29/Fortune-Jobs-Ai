-- Access-control review for the employer backend (docs/claude-employer-access-review.md).
-- Adversarial checks run AS THE ACTUAL ROLES (anon, authenticated, service_role)
-- against the full pending chain on a DISPOSABLE database. Everything is rolled back.
-- Run by tests/employer-access-db.mjs, which creates the database and applies:
--   shim, ingest migrations, every pending employer migration in dependency order.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
begin;

create schema t;
grant usage on schema t to anon, authenticated, service_role;
create table t.ids (name text primary key, id uuid not null);
create table t.fx (k text primary key, v text);
grant select on t.ids, t.fx to anon, authenticated, service_role;
grant insert, update on t.fx to anon, authenticated, service_role;

create function t.id(n text) returns uuid language sql stable as $$ select id from t.ids where name = n $$;
create function t.get(p_k text) returns text language sql stable as $$ select v from t.fx where k = p_k $$;
create function t.put(p_k text, p_v text) returns void language sql as $$
  insert into t.fx values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create function t.as(n text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce((select id::text from t.ids where name = n), ''), false) $$;
create function t.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', msg; end if; end $$;
-- Runs sql and requires it to fail with a message matching pattern.
create function t.fails(sql text, pattern text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if sqlerrm !~* pattern then raise exception 'FAIL: % failed with "%" instead of /%/', sql, sqlerrm, pattern; end if;
    return;
  end;
  raise exception 'FAIL: expected % to fail with /%/', sql, pattern;
end $$;
create function t.post(f jsonb default '{}'::jsonb) returns jsonb language sql volatile as $$
  select jsonb_build_object('job_title', 'Data Analyst', 'canonical_role', 'data-analyst', 'state_code', 'nc',
    'city', 'Raleigh', 'description', repeat('Analyse data and build reports for the finance team. ', 3),
    'apply_url', 'https://careers.acme-a.com/jobs/' || md5(random()::text),
    'posting_date', current_date::text, 'closing_date', (current_date + 30)::text) || f $$;
create function t.active(o uuid) returns int language sql security definer as $$ select public.employer_active_count(o) $$;
create function t.lim(o uuid) returns int language sql security definer as $$ select public.employer_active_limit(o) $$;
create function t.anon_count(o uuid) returns int language sql stable as $$
  select count(*)::int from public.pre_scraped_jobs where employer_org_id = o $$;
-- A live (approved and published) post owned by `owner`, approved by the operator.
create function t.live_post(owner text, org uuid, title text) returns uuid language plpgsql as $$
declare pid uuid;
begin
  perform set_config('request.jwt.claim.sub', (select id::text from t.ids where name = owner), false);
  pid := (public.employer_save_post(org, null, t.post(jsonb_build_object('job_title', title)))->>'id')::uuid;
  perform public.employer_submit_post(pid);
  perform set_config('request.jwt.claim.sub', (select id::text from t.ids where name = 'OP'), false);
  perform public.operator_review_post(pid, 1, 'approve', null);
  return pid;
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;
grant select on all tables in schema t to public;

-- ── fixtures ─────────────────────────────────────────────────────────────────
insert into t.ids values ('A', gen_random_uuid()), ('M', gen_random_uuid()), ('B', gen_random_uuid()),
  ('OP', gen_random_uuid()), ('JS', gen_random_uuid()), ('JSU', gen_random_uuid()), ('T', gen_random_uuid()),
  ('JSC', gen_random_uuid()), ('SUB', gen_random_uuid());
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  (t.id('A'),  'owner@acme-a.com', now(), '{}'),
  (t.id('M'),  'member@acme-a.com', now(), '{}'),
  (t.id('B'),  'owner@beta-b.com', now(), '{}'),
  (t.id('OP'), 'ops@fortunejobsai.com', now(), '{}'),
  -- A job seeker who CLAIMS operator and employer status in metadata. No code may read it.
  (t.id('JS'), 'seeker@gmail.com', now(), '{"role":"employer","is_operator":true,"roles":["operator"],"employer":true}'),
  (t.id('JSU'), 'unconfirmed@gmail.com', null, '{}'),
  (t.id('T'),  'owner@targetco.com', now(), '{}'),
  -- A company employee who may register their own company (matching address).
  (t.id('JSC'), 'recruiter@js-corp.com', now(), '{}'),
  -- An address in a subdomain of newco-s.com may claim the parent company domain.
  (t.id('SUB'), 'sam@staff.newco-s.com', now(), '{}');
insert into public.employer_operators (user_id) values (t.id('OP'));

-- ── 1. catalogue: nothing the public can reach ───────────────────────────────
do $$ declare tb text; n int; begin
  foreach tb in array array['employer_orgs','employer_org_members','employer_domain_challenges','employer_operators',
    'employer_billing_config','employer_entitlements','employer_sources','employer_source_evidence',
    'employer_feed_candidates','employer_posts','employer_audit','employer_feed_runs','employer_feed_leases',
    'employer_feed_staging','employer_feed_candidate_checkpoints'] loop
    select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public' and c.relname = tb and c.relrowsecurity;
    if n <> 1 then raise exception 'FAIL: RLS not enabled on %', tb; end if;
    select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace, lateral aclexplode(c.relacl) a
     where s.nspname = 'public' and c.relname = tb
       and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated')));
    if n <> 0 then raise exception 'FAIL: % is granted to PUBLIC, anon or authenticated', tb; end if;
  end loop;
end $$;
select t.ok(not has_table_privilege('authenticated', 'public.pre_scraped_jobs', 'insert,update,delete'),
  'catalogue table is read-only to signed-in users');
select t.ok(not has_table_privilege('anon', 'public.pre_scraped_jobs', 'insert,update,delete'),
  'catalogue table is read-only to anonymous visitors');

-- ── 2. functions: exactly the reviewed set is callable by each role ──────────
do $$ declare bad text; begin
  -- No employer/operator function is executable by PUBLIC, whatever the role.
  select string_agg(p.proname, ',') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace,
     lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where s.nspname = 'public' and (p.proname like 'employer\_%' or p.proname like 'operator\_%')
     and a.privilege_type = 'EXECUTE' and a.grantee = 0;
  if bad is not null then raise exception 'FAIL: PUBLIC can execute %', bad; end if;
end $$;
with got as (
  select p.proname as name from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and (p.proname like 'employer\_%' or p.proname like 'operator\_%')
     and has_function_privilege('authenticated', p.oid, 'execute')),
want(name) as (select unnest(array[
  'employer_activate_post','employer_close_post','employer_list_feed_candidates','employer_my_state',
  'employer_register_org','employer_save_post','employer_select_feed_jobs','employer_set_keep_on_downgrade',
  'employer_submit_post','employer_submit_source','operator_close_post','operator_queue','operator_review_post',
  'operator_review_source','operator_revoke_source','operator_set_org_status','operator_verify_domain',
  'employer_public_listing_keys']) union select 'employer_replace_feed_selection'
    where to_regprocedure('public.employer_replace_feed_selection(text,text[])') is not null)
select t.ok(not exists (select name from got except select name from want)
        and not exists (select name from want except select name from got),
  'signed-in functions are exactly the reviewed set (no service function is granted to users)');
with anon_got as (
  select p.proname as name from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and (p.proname like 'employer\_%' or p.proname like 'operator\_%')
     and has_function_privilege('anon', p.oid, 'execute'))
select t.ok(not exists (select name from anon_got except select 'employer_public_listing_keys')
        and exists (select 1 from anon_got where name = 'employer_public_listing_keys'),
  'anonymous visitors may run only the read-only listing-keys helper');
select t.ok(not exists (
  select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
     and pg_get_function_identity_arguments(p.oid) ~ '\m(p_user|p_actor|p_uid|p_owner|p_role|p_operator|p_caller)\M'),
  'no signed-in function accepts a caller or user identity argument');

-- ── 3. anonymous visitor ─────────────────────────────────────────────────────
set role anon;
select t.fails($q$select public.employer_my_state()$q$, 'permission denied');
select t.fails($q$select public.employer_register_org('Evil', 'evil.com')$q$, 'permission denied');
select t.fails($q$select public.operator_queue()$q$, 'permission denied');
select t.fails($q$select * from public.employer_posts$q$, 'permission denied');
select t.fails($q$select * from public.employer_orgs$q$, 'permission denied');
reset role;

-- ── 4. organisation A: verified through DNS proof and operator review ───────
set role authenticated;
select t.as('A');
select t.put('orgA', (public.employer_register_org('Acme Analytics', 'acme-a.com')->>'org_id'));
reset role;
select t.put('tokA', (select token from public.employer_domain_challenges where org_id = t.get('orgA')::uuid));
set role service_role;
select public.employer_mark_domain_verified(t.get('orgA')::uuid, t.get('tokA'));
reset role;
set role authenticated;
select t.as('OP');
select public.operator_set_org_status(t.get('orgA')::uuid, 'verified', 'Checked: Acme Analytics owns acme-a.com');
reset role;
insert into public.employer_org_members (org_id, user_id, role) values (t.get('orgA')::uuid, t.id('M'), 'member');
-- Organisation B: registered by someone else, not verified.
set role authenticated; select t.as('B');
select t.put('orgB', (public.employer_register_org('Beta Labs', 'beta-b.com')->>'org_id'));
reset role;
-- A's first live post (quota 1 of 15), and a board source waiting for review.
select t.put('postA1', t.live_post('A', t.get('orgA')::uuid, 'Analyst 1')::text);
set role authenticated; select t.as('A');
select t.put('srcA', public.employer_submit_source(t.get('orgA')::uuid, 'greenhouse', 'global', 'acme-board',
  '{careers.acme-a.com}', '{"display":true,"refresh":true,"description":false}', 'v1')->>'id');
reset role;

-- ── 5. signed-in job seeker, with metadata claiming operator/employer ───────
set role authenticated;
select t.as('JS');
select t.ok(jsonb_array_length(public.employer_my_state()->'orgs') = 0,
  'job seeker sees no employer organisations');
do $$ declare tb text; begin
  foreach tb in array array['employer_orgs','employer_org_members','employer_domain_challenges','employer_operators',
    'employer_billing_config','employer_entitlements','employer_sources','employer_source_evidence',
    'employer_feed_candidates','employer_posts','employer_audit','employer_feed_runs','employer_feed_leases',
    'employer_feed_staging','employer_feed_candidate_checkpoints'] loop
    begin
      execute format('select 1 from public.%I limit 1', tb);
      raise exception 'FAIL: % readable by a signed-in job seeker', tb;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
select t.fails($q$insert into public.employer_operators (user_id) values (auth.uid())$q$, 'permission denied');
select t.fails(format($q$insert into public.employer_org_members (org_id, user_id, role) values (%L, auth.uid(), 'owner')$q$,
  t.get('orgA')), 'permission denied');
select t.fails($q$update public.pre_scraped_jobs set job_title = 'Hijacked'$q$, 'permission denied');
select t.fails($q$update public.employer_billing_config set paid_publishing_enabled = true$q$, 'permission denied');
select t.fails($q$insert into public.employer_entitlements (org_id, plan_code, status, paid_through, verified_event_at)
  values (gen_random_uuid(), 'employer_plus', 'active', now() + interval '1 year', now())$q$, 'permission denied');
-- Operator actions, even with the metadata claim.
select t.fails($q$select public.operator_queue()$q$, 'operator_only');
select t.fails(format($q$select public.operator_set_org_status(%L, 'verified', 'x')$q$, t.get('orgA')), 'operator_only');
select t.fails(format($q$select public.operator_verify_domain(%L, 'x')$q$, t.get('orgA')), 'operator_only');
select t.fails(format($q$select public.operator_review_post(%L, 1, 'approve', null)$q$, t.get('postA1')), 'operator_only');
select t.fails(format($q$select public.operator_close_post(%L, 'x')$q$, t.get('postA1')), 'operator_only');
select t.fails(format($q$select public.operator_review_source(%L, 1, 'approve', '{careers.acme-a.com}', '', false,
  now() + interval '30 days', 'ref', 'n')$q$, t.get('srcA')), 'operator_only');
select t.fails(format($q$select public.operator_revoke_source(%L, 'x')$q$, t.get('srcA')), 'operator_only');
-- Writes to another company, by any route.
select t.fails(format($q$select public.employer_save_post(%L, null, '{}'::jsonb)$q$, t.get('orgA')), 'not_a_member');
select t.fails(format($q$select public.employer_save_post(%L, %L, '{"job_title":"Hijacked title"}'::jsonb)$q$,
  t.get('orgA'), t.get('postA1')), 'not_a_member');
select t.fails(format($q$select public.employer_submit_source(%L, 'greenhouse', 'global', 'evil-board', '{evil.com}',
  '{"display":true,"refresh":true}', 'v1')$q$, t.get('orgA')), 'not_a_member');
select t.fails(format($q$select public.employer_submit_post(%L)$q$, t.get('postA1')), 'post_not_found');
select t.fails(format($q$select public.employer_activate_post(%L)$q$, t.get('postA1')), 'post_not_found');
select t.fails(format($q$select public.employer_close_post(%L)$q$, t.get('postA1')), 'post_not_found');
select t.fails(format($q$select public.employer_set_keep_on_downgrade(%L, true)$q$, t.get('postA1')), 'post_not_found');
select t.fails(format($q$select public.employer_select_feed_jobs(%L, '{x}', true)$q$, t.get('srcA')), 'source_not_found');
select t.fails(format($q$select public.employer_list_feed_candidates(%L)$q$, t.get('srcA')), 'source_not_found');
-- A job seeker on a personal address cannot claim a company, whatever name they give.
select t.fails($q$select public.employer_register_org('Js Corp', 'js-corp.com')$q$, 'company_email_required');
-- A company employee registers their own company: pending, and it cannot publish.
select t.as('JSC');
select t.put('orgC', (public.employer_register_org('Js Corp', 'js-corp.com')->>'org_id'));
select t.ok(jsonb_array_length(public.employer_my_state()->'orgs') = 1
  and (public.employer_my_state()->'orgs'->0->>'id') = t.get('orgC'),
  'job seeker sees only their own new organisation');
select t.put('postC', (public.employer_save_post(t.get('orgC')::uuid, null, t.post(jsonb_build_object(
  'status', 'approved', 'reviewed_revision', 1, 'has_unreviewed_changes', false, 'published_job_id', 999999,
  'org_id', t.get('orgA'), 'employer_org_id', t.get('orgA'), 'revision', 99, 'domain_verified', true)))->>'id'));
select public.employer_submit_post(t.get('postC')::uuid);
reset role;
select t.ok((select status from public.employer_posts where id = t.get('postC')::uuid) = 'pending_review'
  and (select reviewed_revision from public.employer_posts where id = t.get('postC')::uuid) is null
  and (select published_job_id from public.employer_posts where id = t.get('postC')::uuid) is null
  and (select org_id from public.employer_posts where id = t.get('postC')::uuid) = t.get('orgC')::uuid,
  'client-supplied status, approval, org and job fields are ignored');
set role authenticated; select t.as('JSC');
select t.fails(format($q$select public.employer_activate_post(%L)$q$, t.get('postC')), 'review_required');
reset role;
select t.as('OP');
set role authenticated;
select t.ok((public.operator_review_post(t.get('postC')::uuid, 1, 'approve', null)->>'state') = 'org_not_verified',
  'an unverified company cannot publish even after review');
reset role;
select t.ok(not exists (select 1 from public.pre_scraped_jobs where employer_org_id = t.get('orgC')::uuid),
  'no listing exists for the unverified company');

-- ── 6. member identity: removal, unconfirmed email, banned account ──────────
set role authenticated; select t.as('M');
select t.ok(jsonb_array_length(public.employer_my_state()->'orgs') = 1, 'active member sees the organisation');
select t.put('postM', (public.employer_save_post(t.get('orgA')::uuid, null, t.post())->>'id'));
reset role;
update public.employer_org_members set status = 'removed' where user_id = t.id('M');
set role authenticated; select t.as('M');
select t.ok(jsonb_array_length(public.employer_my_state()->'orgs') = 0, 'removed member loses the organisation');
select t.fails(format($q$select public.employer_save_post(%L, null, '{}'::jsonb)$q$, t.get('orgA')), 'not_a_member');
select t.fails(format($q$select public.employer_submit_post(%L)$q$, t.get('postM')), 'post_not_found');
reset role;
update public.employer_org_members set status = 'active' where user_id = t.id('M');
update auth.users set email_confirmed_at = null where id = t.id('M');
set role authenticated; select t.as('M');
select t.fails($q$select public.employer_my_state()$q$, 'email_not_confirmed');
select t.fails(format($q$select public.employer_save_post(%L, null, '{}'::jsonb)$q$, t.get('orgA')), 'email_not_confirmed');
reset role;
update auth.users set email_confirmed_at = now() where id = t.id('M');
update auth.users set banned_until = now() + interval '1 day' where id = t.id('A');
set role authenticated; select t.as('A');
select t.fails($q$select public.employer_my_state()$q$, 'account_banned');
select t.fails(format($q$select public.employer_save_post(%L, null, '{}'::jsonb)$q$, t.get('orgA')), 'account_banned');
reset role;
update auth.users set banned_until = null where id = t.id('A');
-- The domain-proof path obeys the same account rules (service RPCs called by the edge function).
update auth.users set banned_until = now() + interval '1 day' where id = t.id('B');
set role service_role;
select t.ok((public.employer_domain_check_begin(t.get('orgB')::uuid, t.id('B'))->>'state') = 'not_found',
  'a banned owner cannot start a domain proof');
reset role;
update auth.users set banned_until = null where id = t.id('B');
set role service_role;
select t.ok((public.employer_domain_check_begin(t.get('orgB')::uuid, t.id('B'))->>'state') = 'lookup',
  'an eligible owner can start a domain proof');
reset role;

-- ── 7. reviewer rules ────────────────────────────────────────────────────────
set role authenticated; select t.as('OP');
select t.fails(format($q$select public.operator_set_org_status(%L, 'verified', '')$q$, t.get('orgA')), 'note_required');
select t.put('orgO', (public.employer_register_org('Ops Co', 'fortunejobsai.com')->>'org_id'));
select t.put('postO', (public.employer_save_post(t.get('orgO')::uuid, null, t.post())->>'id'));
select public.employer_submit_post(t.get('postO')::uuid);
select t.fails(format($q$select public.operator_review_post(%L, 1, 'approve', null)$q$, t.get('postO')),
  'cannot_review_own_organization');
select t.fails(format($q$select public.operator_set_org_status(%L, 'verified', 'self')$q$, t.get('orgO')),
  'cannot_review_own_organization');
reset role;
-- A stale approval: the operator approved revision 1, the employer then edited to revision 2.
set role authenticated; select t.as('A');
select t.put('postS', (public.employer_save_post(t.get('orgA')::uuid, null, t.post())->>'id'));
select public.employer_submit_post(t.get('postS')::uuid);
select public.employer_save_post(t.get('orgA')::uuid, t.get('postS')::uuid, '{"job_title":"Analyst (edited)"}'::jsonb);
select t.put('postD', (public.employer_save_post(t.get('orgA')::uuid, null, t.post())->>'id'));
reset role;
set role authenticated; select t.as('OP');
select t.fails(format($q$select public.operator_review_post(%L, 1, 'approve', null)$q$, t.get('postS')), 'revision_changed');
select t.fails(format($q$select public.operator_review_post(%L, 1, 'approve', null)$q$, t.get('postD')), 'not_awaiting_review');
reset role;

-- ── 8. quota: 15 active posts per organisation, whoever asks ────────────────
do $$ begin
  for i in 2..15 loop
    perform t.live_post('A', t.get('orgA')::uuid, 'Analyst ' || i);
  end loop;
end $$;
select t.ok(t.active(t.get('orgA')::uuid) = 15 and t.lim(t.get('orgA')::uuid) = 15, 'fifteen live posts, limit 15');
set role authenticated; select t.as('A');
select t.put('post16', (public.employer_save_post(t.get('orgA')::uuid, null, t.post())->>'id'));
select public.employer_submit_post(t.get('post16')::uuid);
reset role;
select t.as('OP');
set role authenticated;
select t.ok((public.operator_review_post(t.get('post16')::uuid, 1, 'approve', null)->>'state') = 'upgrade_required',
  'the sixteenth approved post is blocked by the quota');
reset role;
select t.ok(t.active(t.get('orgA')::uuid) = 15, 'quota blocked post did not publish');
-- Editing a live post takes no new slot and stays live until re-reviewed.
set role authenticated; select t.as('A');
select public.employer_save_post(t.get('orgA')::uuid, t.get('postA1')::uuid, '{"job_title":"Analyst 1 (edited)"}'::jsonb);
reset role;
select t.ok(t.active(t.get('orgA')::uuid) = 15, 'editing a live post takes no extra slot');
-- Closing frees a slot; reactivation takes one again; a new post cannot exceed 15.
select t.put('postA2', (select id::text from public.employer_posts where job_title = 'Analyst 2'));
set role authenticated; select t.as('A');
select public.employer_close_post(t.get('postA2')::uuid);
reset role;
select t.ok(t.active(t.get('orgA')::uuid) = 14, 'closing a live post frees a slot');
select t.put('postNew', t.live_post('A', t.get('orgA')::uuid, 'Analyst fresh')::text);
select t.ok(t.active(t.get('orgA')::uuid) = 15, 'a new approved post takes the freed slot');
set role authenticated; select t.as('A');
select t.ok((public.employer_activate_post(t.get('postA2')::uuid)->>'state') = 'upgrade_required',
  'reactivating a closed post at the limit is refused');
reset role;
select t.ok(t.active(t.get('orgA')::uuid) = 15, 'refused reactivation took no slot');
-- Billing cannot be opened from the browser, and a service-written entitlement is inert while billing is off.
set role authenticated; select t.as('A');
select t.fails($q$update public.employer_billing_config set paid_active_limit = 100$q$, 'permission denied');
reset role;
insert into public.employer_entitlements (org_id, plan_code, status, paid_through, verified_event_at)
  values (t.get('orgA')::uuid, 'employer_plus', 'active', now() + interval '1 year', now());
select t.ok(t.lim(t.get('orgA')::uuid) = 15, 'a paid entitlement does not raise the limit while billing is off');

-- ── 8b. feed rows obey the quota, including an expired row being revived ───
set role authenticated; select t.as('A');
select t.put('srcF', public.employer_submit_source(t.get('orgA')::uuid, 'greenhouse', 'global', 'acme-board2',
  '{boards.greenhouse.io}', '{"display":true,"refresh":true,"description":false}', 'v1')->>'id');
reset role;
select t.as('OP'); set role authenticated;
select public.operator_review_source(t.get('srcF'), 1, 'approve', '{boards.greenhouse.io}', 'Jobs from Acme', false,
  now() + interval '180 days', 'perm-feed-1', 'written permission');
reset role;
set role authenticated; select t.as('A');
select public.employer_close_post(t.get('postNew')::uuid);
reset role;
select t.ok(t.active(t.get('orgA')::uuid) = 14, 'a slot is free for a feed posting');
set role service_role;
select public.employer_stage_feed_candidates(t.get('srcF'), (public.employer_source_for_worker(t.get('srcF'))->>'revision')::int,
  jsonb_build_array(jsonb_build_object('source_listing_id', t.get('srcF') || ':9001', 'job_title', 'Data Analyst',
    'location', 'Raleigh, NC', 'state_code', 'NC', 'canonical_role', 'data-analyst',
    'apply_url', 'https://boards.greenhouse.io/acme-board2/jobs/9001')));
reset role;
set role authenticated; select t.as('A');
select public.employer_select_feed_jobs(t.get('srcF'), '{9001}', true);
reset role;
set role service_role;
select t.ok((public.employer_publish_feed_jobs(t.get('srcF'), (public.employer_source_for_worker(t.get('srcF'))->>'revision')::int,
  '{9001}')->>'published')::int = 1, 'a selected feed posting publishes into a free slot');
reset role;
select t.ok(t.active(t.get('orgA')::uuid) = 15, 'feed posting took the slot');
update public.pre_scraped_jobs set expires_at = now() - interval '1 minute' where source_listing_id = t.get('srcF') || ':9001';
select t.ok(t.active(t.get('orgA')::uuid) = 14, 'an expired feed posting frees its slot without being closed');
select t.put('postFill', t.live_post('A', t.get('orgA')::uuid, 'Analyst feed fill')::text);
select t.ok(t.active(t.get('orgA')::uuid) = 15, 'the freed slot is taken by a direct post');
set role service_role;
select t.ok((public.employer_publish_feed_jobs(t.get('srcF'), (public.employer_source_for_worker(t.get('srcF'))->>'revision')::int,
  '{9001}')->>'blocked_quota')::int = 1, 'an expired feed posting cannot be revived past the quota');
reset role;
select t.ok(t.active(t.get('orgA')::uuid) = 15
  and (select expires_at < now() from public.pre_scraped_jobs where source_listing_id = t.get('srcF') || ':9001'),
  'the revived-but-blocked posting stayed expired and took no slot');

-- ── 9. squatting: a job seeker cannot block a company from registering ──────
-- A job seeker on a personal address cannot register someone else's company at all.
set role authenticated; select t.as('JS');
select t.fails($q$select public.employer_register_org('Target Co (unverified)', 'targetco.com')$q$, 'company_email_required');
reset role;
set role authenticated; select t.as('T');
select t.put('orgT', (public.employer_register_org('Target Co', 'targetco.com')->>'org_id'));
select t.put('boardT', public.employer_submit_source(t.get('orgT')::uuid, 'greenhouse', 'global', 'targetco',
  '{jobs.targetco.com}', '{"display":true,"refresh":true}', 'v1')->>'id');
reset role;
select t.put('tokT', (select token from public.employer_domain_challenges where org_id = t.get('orgT')::uuid));
set role service_role;
select public.employer_mark_domain_verified(t.get('orgT')::uuid, t.get('tokT'));
reset role;
set role authenticated; select t.as('OP');
select public.operator_set_org_status(t.get('orgT')::uuid, 'verified', 'Checked: Target Co owns targetco.com');
select public.operator_review_source(t.get('boardT'), 1, 'approve', '{jobs.targetco.com}', 'Target Co', false,
  now() + interval '30 days', 'written-permission-2026-10-15', 'Target Co signed permission');
reset role;
select t.ok((select status from public.employer_sources where id = t.get('boardT')) = 'approved',
  'the real company''s board is approved despite the earlier pending claim');
-- A verified domain cannot be claimed twice, even by an address at that same company.
set role authenticated; select t.as('T');
select t.fails($q$select public.employer_register_org('Target Copy', 'targetco.com')$q$, 'domain_already_registered');
reset role;

-- ── 10. anonymous visitors see only the public catalogue ────────────────────
set role anon;
select t.ok(t.anon_count(t.get('orgA')::uuid) = t.active(t.get('orgA')::uuid),
  'anonymous visitors see exactly the live listings of an organisation');
select t.ok(t.anon_count(t.get('orgB')::uuid) = 0 and t.anon_count(t.get('orgC')::uuid) = 0,
  'unverified organisations have no visible listings');
select t.fails(format($q$select public.employer_listing_visible(%L, null)$q$, t.get('orgA')), 'permission denied');
reset role;
-- Suspension hides listings in the same statement, before any worker runs.
update public.employer_orgs set status = 'suspended' where id = t.get('orgA')::uuid;
set role anon;
select t.ok(t.anon_count(t.get('orgA')::uuid) = 0, 'suspending an organisation hides its listings immediately');
reset role;

-- ── 8. company domain rule: the registrant's sign-in address must be at the company domain
-- or a subdomain of it. Free-mail providers never qualify, on either side.
set role authenticated; select t.as('A');
select t.fails($q$select public.employer_register_org('Acme Mail', 'gmail.com')$q$, 'free_email_domain_not_allowed');
select t.fails($q$select public.employer_register_org('Beta Labs Copy', 'beta-b.com')$q$, 'email_domain_mismatch');
select t.fails($q$select public.employer_register_org('Suffix Trick', 'a.com')$q$, 'email_domain_mismatch');
reset role;
set role authenticated; select t.as('SUB');
select t.ok((public.employer_register_org('Newco Staff', 'newco-s.com')->>'status') = 'pending',
  'an address at a subdomain may claim the parent company domain');
reset role;
-- The registration audit records the email match that was checked, not a guess.
select t.ok(exists (select 1 from public.employer_audit where action = 'registered' and detail->>'email_domain_matches' = 'true'),
  'registration is audited with the email-domain check');

select 'PASS: employer access review';
rollback;
