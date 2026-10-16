-- Permission, workflow and quota tests for
-- migrations/pending/20261016_employer_submissions.sql.
-- Run as the database owner on a DISPOSABLE database that has the shim and
-- migrations applied (tests/employer-submissions-db.mjs does this). Everything
-- below runs in one transaction and is rolled back.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
begin;

create schema t;
grant usage on schema t to anon, authenticated, service_role;
create table t.ids (name text primary key, id uuid not null);
grant select on t.ids to anon, authenticated, service_role;

create function t.id(n text) returns uuid language sql stable as $$ select id from t.ids where name = n $$;
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
create function t.anon_visible(org uuid) returns int language sql stable as $$
  select count(*)::int from public.pre_scraped_jobs where employer_org_id = org $$;
create function t.active(o uuid) returns int language sql security definer as $$ select public.employer_active_count(o) $$;
create function t.lim(o uuid) returns int language sql security definer as $$ select public.employer_active_limit(o) $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ── fixtures ─────────────────────────────────────────────────────────────────
insert into t.ids values ('A', gen_random_uuid()), ('A2', gen_random_uuid()), ('B', gen_random_uuid()),
  ('OP', gen_random_uuid()), ('OPA', gen_random_uuid()), ('X', gen_random_uuid()), ('U', gen_random_uuid());
insert into auth.users (id, email, email_confirmed_at) values
  (t.id('A'), 'owner@acme-a.com', now()), (t.id('A2'), 'second@acme-a.com', now()),
  (t.id('B'), 'owner@beta-b.com', now()), (t.id('OP'), 'ops@fortunejobsai.com', now()),
  (t.id('OPA'), 'ops2@fortunejobsai.com', now()), (t.id('X'), 'someone@gmail.com', now()),
  (t.id('U'), 'unconfirmed@acme-a.com', null);
insert into public.employer_operators (user_id) values (t.id('OP')), (t.id('OPA'));
insert into public.pre_scraped_jobs (category, job_title, company, apply_url, source, canonical_role, state_code)
  values ('Data Analyst', 'Data Analyst', 'Adzuna Co', 'https://boards.greenhouse.io/acme/jobs/104', 'adzuna', 'data-analyst', 'NC');

-- ── 1. anonymous and ordinary callers ────────────────────────────────────────
set role anon;
select t.fails('select public.employer_my_state()', 'permission denied');
select t.fails('select public.employer_register_org(''Evil'', ''evil.com'')', 'permission denied');
select t.fails('select public.operator_queue()', 'permission denied');
select t.fails('select * from public.employer_posts', 'permission denied');
select t.fails('insert into public.pre_scraped_jobs (category, job_title, apply_url) values (''x'',''x'',''https://x.com/1'')', 'permission denied');
reset role;

set role authenticated;
select t.as('U');
select t.fails('select public.employer_register_org(''Acme'', ''acme-a.com'')', 'email_not_confirmed');
select t.as('X');
select t.fails('select * from public.employer_orgs', 'permission denied');
select t.fails('select * from public.employer_source_evidence', 'permission denied');
select t.fails('insert into public.employer_entitlements (org_id, plan_code, status, paid_through, verified_event_at) values (gen_random_uuid(), ''employer_plus'', ''active'', now() + interval ''1 year'', now())', 'permission denied');
select t.fails('update public.employer_billing_config set paid_publishing_enabled = true', 'permission denied');
select t.fails('select public.employer_publish_feed_jobs(''x'', 1, ''{}'')', 'permission denied');
select t.fails('select public.employer_mark_domain_verified(gen_random_uuid(), ''x'')', 'permission denied');
select t.fails('select public.employer_publish_post_internal(gen_random_uuid(), gen_random_uuid(), ''employer'')', 'permission denied');
select t.fails('select public.employer_apply_downgrade(gen_random_uuid())', 'permission denied');
select t.fails('select public.operator_queue()', 'operator_only');
select t.as('');
select t.fails('select public.employer_my_state()', 'sign_in_required');

-- ── 2. registration; every org starts pending ────────────────────────────────
select t.as('A');
create temp table t_org as select (public.employer_register_org('Acme Analytics', 'Acme-A.com ')->>'org_id')::uuid as a;
grant all on t_org to public;
select t.ok(public.employer_my_state()->'orgs'->0->>'status' = 'pending', 'new org pending');
select t.ok((public.employer_my_state()->'orgs'->0->>'domain_verified')::boolean = false, 'domain not verified');
select t.as('B');
alter table t_org add column b uuid;
update t_org set b = (public.employer_register_org('Beta Labs', 'beta-b.com')->>'org_id')::uuid;
select t.fails('select public.employer_register_org(''Acme Copy'', ''acme-a.com'')', 'domain_already_registered');
select t.fails('select public.employer_register_org(''Bad'', ''localhost'')', 'violates check|check constraint');
reset role;
insert into public.employer_org_members (org_id, user_id, role) select a, t.id('A2'), 'member' from t_org;
insert into public.employer_org_members (org_id, user_id, role) select a, t.id('OPA'), 'member' from t_org;

-- ── 3. org isolation ─────────────────────────────────────────────────────────
set role authenticated;
select t.as('B');
select t.ok(jsonb_array_length(public.employer_my_state()->'orgs') = 1, 'B sees only its own org');
select t.ok(public.employer_my_state()->'orgs'->0->>'name' = 'Beta Labs', 'B sees Beta');
select t.fails(format('select public.employer_save_post(%L, null, t.post())', (select a from t_org)), 'not_a_member');

-- ── 4. forged fields are ignored; drafts are private and pending ────────────
select t.as('A');
create temp table t_p as select (public.employer_save_post((select a from t_org), null,
  t.post('{"status":"published","reviewed_revision":1,"org_id":"00000000-0000-0000-0000-000000000000","paid":true,"plan":"employer_plus","published_job_id":1,"publish_state":null}'))->>'id')::uuid as p1;
grant all on t_p to public;
reset role;
select t.ok((select status = 'draft' and reviewed_revision is null and published_job_id is null and org_id = (select a from t_org)
             from public.employer_posts where id = (select p1 from t_p)), 'forged status/review/org/job ignored');
set role authenticated; select t.as('A');
select t.fails(format('select public.employer_activate_post(%L)', (select p1 from t_p)), 'review_required');
select t.fails(format('select public.employer_save_post(%L, null, t.post(''{"apply_url":"http://insecure.com/x"}''))', (select a from t_org)), 'check');
select t.fails(format('select public.employer_save_post(%L, null, t.post(''{"closing_date":"2030-01-01"}''))', (select a from t_org)), 'check');
select public.employer_submit_post((select p1 from t_p));
select t.as('B');
select t.fails(format('select public.employer_submit_post(%L)', (select p1 from t_p)), 'post_not_found');
select t.fails(format('select public.employer_close_post(%L)', (select p1 from t_p)), 'post_not_found');

-- ── 5. review rules ──────────────────────────────────────────────────────────
select t.as('X');
select t.fails(format('select public.operator_review_post(%L, 1, ''approve'', null)', (select p1 from t_p)), 'operator_only');
select t.as('OPA');
select t.fails(format('select public.operator_review_post(%L, 1, ''approve'', null)', (select p1 from t_p)), 'cannot_review_own_organization');
select t.ok(jsonb_array_length(public.operator_queue()->'posts') = 0, 'conflicted operator does not see own org queue');
select t.as('OP');
select t.fails(format('select public.operator_review_post(%L, 99, ''approve'', null)', (select p1 from t_p)), 'revision_changed');
-- Approval while the org is unverified publishes nothing.
select t.ok(public.operator_review_post((select p1 from t_p), 1, 'approve', 'ok')->>'state' = 'org_not_verified', 'unverified org blocks publication');
select t.ok(t.anon_visible((select a from t_org)) = 0, 'nothing public yet');
select t.fails(format('select public.operator_set_org_status(%L, ''verified'', null)', (select a from t_org)), 'domain_not_verified');
reset role;

-- ── 6. domain proof (service) then operator verification ─────────────────────
set role service_role;
select t.ok(public.employer_mark_domain_verified((select a from t_org), 'wrong-token') = false, 'wrong DNS token rejected');
select t.ok(public.employer_mark_domain_verified((select a from t_org),
  (select token from public.employer_domain_challenges where org_id = (select a from t_org))) = true, 'right DNS token accepted');
reset role;
set role authenticated; select t.as('OP');
select public.operator_set_org_status((select a from t_org), 'verified', 'DNS proof');
select t.as('A');
select t.ok((public.employer_activate_post((select p1 from t_p))->>'published')::boolean, 'approved post publishes once org verified');
reset role;

set role anon;
select t.ok(t.anon_visible((select a from t_org)) = 1, 'anon sees the published post');
select t.ok((select source = 'employer_direct' and company = 'Acme Analytics' and state_code = 'NC' and attribution is null
             from public.pre_scraped_jobs where employer_post_id = (select p1 from t_p)), 'provenance and company from the org, not the form');
reset role;

-- ── 7. quota: 15th publishes, 16th is upgrade_required ───────────────────────
create temp table t_more (n int, id uuid);
grant all on t_more to public;
do $$ declare i int; pid uuid; begin
  for i in 2..16 loop
    perform t.as('A');
    pid := (public.employer_save_post((select a from t_org), null, t.post())->>'id')::uuid;
    perform public.employer_submit_post(pid);
    insert into t_more values (i, pid);
  end loop;
end $$;
set role authenticated; select t.as('OP');
do $$ declare r record; res jsonb; begin
  for r in select * from t_more where n <= 15 order by n loop
    res := public.operator_review_post(r.id, 1, 'approve', null);
    if not (res->>'published')::boolean then raise exception 'FAIL: post % not published: %', r.n, res; end if;
  end loop;
end $$;
select t.ok(t.active((select a from t_org)) = 15, '15 active');
select t.ok(public.operator_review_post((select id from t_more where n = 16), 1, 'approve', null)->>'state' = 'upgrade_required', '16th is upgrade_required');
select t.ok(t.active((select a from t_org)) = 15, 'still 15 after 16th');
reset role;
set role anon; select t.ok(t.anon_visible((select a from t_org)) = 15, 'anon sees exactly 15'); reset role;

-- ── 8. an edit at the limit uses no extra slot and waits for review ──────────
set role authenticated; select t.as('A');
select public.employer_save_post((select a from t_org), (select p1 from t_p), '{"job_title":"Senior Data Analyst","status":"published"}');
reset role;
select t.ok((select job_title from public.pre_scraped_jobs where employer_post_id = (select p1 from t_p)) = 'Data Analyst', 'live version unchanged until review');
select t.ok((select has_unreviewed_changes from public.employer_posts where id = (select p1 from t_p)), 'edit queued for review');
set role authenticated; select t.as('A');
select t.fails(format('select public.employer_activate_post(%L)', (select p1 from t_p)), 'review_required');
select t.as('OP');
select t.ok((public.operator_review_post((select p1 from t_p), 2, 'approve', null)->>'published')::boolean, 'edit at limit publishes');
reset role;
select t.ok((select job_title from public.pre_scraped_jobs where employer_post_id = (select p1 from t_p)) = 'Senior Data Analyst', 'edit applied in place');
select t.ok(t.active((select a from t_org)) = 15, 'edit used no extra slot');

-- ── 9. close frees a slot; reactivation consumes one ─────────────────────────
set role authenticated; select t.as('A2');   -- any active member of the org
select public.employer_close_post((select id from t_more where n = 2));
select t.ok(t.active((select a from t_org)) = 14, 'close frees a slot');
select t.ok((public.employer_activate_post((select id from t_more where n = 16))->>'published')::boolean, 'freed slot lets the 16th publish');
select t.ok(public.employer_activate_post((select id from t_more where n = 2))->>'state' = 'upgrade_required', 'reactivation at 15 is blocked');
select public.employer_close_post((select id from t_more where n = 3));
select t.ok((public.employer_activate_post((select id from t_more where n = 2))->>'published')::boolean, 'reactivation consumes the freed slot');
select t.ok(t.active((select a from t_org)) = 15, 'back to 15');
reset role;

-- ── 10. forged and premature paid access ─────────────────────────────────────
-- Even a service-written active entitlement does nothing while paid publishing is off.
insert into public.employer_entitlements (org_id, plan_code, status, paid_through, verified_event_at)
  select a, 'employer_plus', 'active', now() + interval '30 days', now() from t_org;
select t.ok(t.lim((select a from t_org)) = 15, 'entitlement ignored while billing is pending');
update public.employer_billing_config set paid_publishing_enabled = true;
select t.ok(t.lim((select a from t_org)) = 15, 'no paid maximum approved: still 15');
update public.employer_billing_config set paid_publishing_enabled = false;
set role authenticated; select t.as('A');
select t.ok((public.employer_my_state()->'plan'->>'checkout_available')::boolean = false, 'checkout reported unavailable');
-- "Returning from checkout": nothing a client sends can change the limit.
select public.employer_save_post((select a from t_org), null, t.post('{"plan":"employer_plus","paid_through":"2099-01-01","checkout":"success"}'));
select t.ok((public.employer_my_state()->'orgs'->0->>'active_limit')::int = 15, 'limit unchanged after checkout-like input');
select t.as('B');
select t.ok((public.employer_my_state()->'orgs'->0->'entitlement') = 'null'::jsonb, 'B cannot see A''s entitlement');
select t.ok((public.employer_my_state()->'orgs'->0->>'active_posts')::int = 0, 'B quota separate');
reset role;

-- ── 11. feed source: submission, approval, worker record ─────────────────────
set role authenticated; select t.as('A');
select t.fails(format('select public.employer_submit_source(%L, ''greenhouse'', ''global'', ''acme'', ''{}'', ''{"display":true}'', ''v1'')', (select a from t_org)), 'display_and_refresh_permission_required');
select t.fails(format('select public.employer_submit_source(%L, ''greenhouse'', ''global'', ''acme'', ''{localhost}'', ''{"display":true,"refresh":true}'', ''v1'')', (select a from t_org)), 'invalid_host');
create temp table t_s as select public.employer_submit_source((select a from t_org), 'greenhouse', 'global', 'acme',
  '{boards.greenhouse.io}', '{"display":true,"refresh":true,"description":false}', 'v1')->>'id' as s;
grant all on t_s to public;
reset role;
select t.ok(public.employer_source_for_worker((select s from t_s)) is null, 'pending source not available to the worker');
set role authenticated; select t.as('A');
select t.ok(public.employer_my_state()->'orgs'->0->'sources'->0->>'status' = 'pending', 'source pending');
select t.ok(public.employer_my_state()::text !~ 'employer_attestation|permission_ref', 'private evidence not exposed');
select t.as('OP');
select t.fails(format('select public.operator_review_source(%L, 1, ''approve'', ''{boards.greenhouse.io}'', ''Jobs from Acme'', true, now() + interval ''180 days'', ''perm-001'', ''ok'')', (select s from t_s)), 'description_not_permitted');
select t.fails(format('select public.operator_review_source(%L, 1, ''approve'', ''{*.greenhouse.io}'', '''', false, now() + interval ''180 days'', ''perm-001'', ''ok'')', (select s from t_s)), 'invalid_host');
select t.fails(format('select public.operator_review_source(%L, 1, ''approve'', ''{boards.greenhouse.io}'', '''', false, now() - interval ''1 day'', ''perm-001'', ''ok'')', (select s from t_s)), 'invalid_expiry');
select public.operator_review_source((select s from t_s), 1, 'approve', '{boards.greenhouse.io}', 'Jobs from Acme', false, now() + interval '180 days', 'perm-001', 'written permission on file');
reset role;
select t.ok((public.employer_source_for_worker((select s from t_s))->>'revision')::int = 2, 'approved source has revision 2');
select t.ok(public.employer_source_for_worker((select s from t_s))->'source'->>'status' = 'approved', 'contract v1 record');

-- ── 12. staging, selection and quota-bound feed publication ──────────────────
set role service_role;
select t.fails(format('select public.employer_stage_feed_candidates(%L, 2, %L)', (select s from t_s),
  '[{"source_listing_id":"src_other:1","apply_url":"https://boards.greenhouse.io/acme/jobs/1"}]'), 'listing_not_from_source');
select t.fails(format('select public.employer_stage_feed_candidates(%L, 1, ''[]'')', (select s from t_s)), 'source_not_publishable');
select public.employer_stage_feed_candidates((select s from t_s), 2, jsonb_build_array(
  jsonb_build_object('source_listing_id', (select s from t_s) || ':101', 'job_title', 'Data Analyst', 'location', 'Charlotte, NC', 'state_code', 'NC', 'canonical_role', 'data-analyst', 'apply_url', 'https://boards.greenhouse.io/acme/jobs/101'),
  jsonb_build_object('source_listing_id', (select s from t_s) || ':102', 'job_title', 'Data Analyst II', 'location', 'Columbia, SC', 'state_code', 'SC', 'canonical_role', 'data-analyst', 'apply_url', 'https://boards.greenhouse.io/acme/jobs/102'),
  jsonb_build_object('source_listing_id', (select s from t_s) || ':103', 'job_title', 'Data Analyst', 'location', 'Raleigh, NC', 'state_code', 'NC', 'canonical_role', 'data-analyst', 'apply_url', 'https://evil.example.org/apply/103'),
  jsonb_build_object('source_listing_id', (select s from t_s) || ':104', 'job_title', 'Data Analyst', 'location', 'Raleigh, NC', 'state_code', 'NC', 'canonical_role', 'data-analyst', 'apply_url', 'https://boards.greenhouse.io/acme/jobs/104')));
select t.ok((public.employer_publish_feed_jobs((select s from t_s), 2, '{101,102}')->'skipped'->0->>'reason') = 'not_selected', 'unselected candidates never publish');
reset role;
set role authenticated; select t.as('B');
select t.fails(format('select public.employer_select_feed_jobs(%L, ''{101}'', true)', (select s from t_s)), 'source_not_found');
select t.as('A');
select t.ok(public.employer_select_feed_jobs((select s from t_s), '{101,102,103,104}', true) = 4, 'employer selects');
reset role;
set role service_role;
select t.ok((public.employer_publish_feed_jobs((select s from t_s), 2, '{101,102,103,104}')->>'blocked_quota')::int = 2, 'feed publication shares the full quota');
reset role;
set role authenticated; select t.as('A');
select public.employer_close_post((select id from t_more where n = 4));
select public.employer_close_post((select id from t_more where n = 5));
reset role;
set role service_role;
create temp table t_res as select public.employer_publish_feed_jobs((select s from t_s), 2, '{101,102,103,104}') as r;
grant all on t_res to public;
reset role;
select t.ok(((select r from t_res)->>'published')::int = 2, 'two feed jobs published into freed slots');
select t.ok((select r from t_res)::text ~ 'apply_host_not_allowed', 'unapproved apply host refused');
select t.ok((select r from t_res)::text ~ 'apply_url_already_listed', 'existing Adzuna listing never relabelled');
select t.ok((select source from public.pre_scraped_jobs where apply_url = 'https://boards.greenhouse.io/acme/jobs/104') = 'adzuna', 'Adzuna row untouched');
select t.ok(t.active((select a from t_org)) = 15, 'feed + direct = 15');
set role service_role;
select t.ok((public.employer_publish_feed_jobs((select s from t_s), 2, '{101,102}')->>'updated')::int = 2, 'republishing is idempotent (updates, no new slots)');
reset role;
select t.ok((select count(*) from public.pre_scraped_jobs where employer_source_id = (select s from t_s)) = 2, 'no duplicate rows');

-- ── 13. expiry and revocation hide jobs immediately ──────────────────────────
update public.employer_sources set authorization_expires_at = now() - interval '1 minute' where id = (select s from t_s);
set role anon;
select t.ok((select count(*) from public.pre_scraped_jobs where employer_source_id = (select s from t_s)) = 0, 'expired source hidden by policy');
reset role;
select t.ok(public.employer_source_for_worker((select s from t_s)) is null, 'expired source not given to the worker');
update public.employer_sources set authorization_expires_at = now() + interval '180 days' where id = (select s from t_s);
set role authenticated; select t.as('OP');
select t.ok(public.operator_revoke_source((select s from t_s), 'permission withdrawn') = 2, 'revocation closes the source''s rows');
reset role;
select t.ok(public.employer_source_for_worker((select s from t_s)) is null, 'revoked source not given to the worker');
set role service_role;
select t.fails(format('select public.employer_publish_feed_jobs(%L, 2, ''{101}'')', (select s from t_s)), 'source_not_publishable');
reset role;
set role anon;
select t.ok((select count(*) from public.pre_scraped_jobs where employer_source_id = (select s from t_s)) = 0, 'revoked source hidden');
reset role;

-- ── 14. downgrade needs an explicit choice; content is paused, not deleted ───
select t.ok(public.employer_apply_downgrade((select a from t_org))->>'state' = 'within_limit', 'no downgrade needed at 13');
insert into public.employer_entitlements (org_id, plan_code, status, paid_through, verified_event_at)
  select a, 'employer_plus', 'active', now() + interval '30 days', now() from t_org
  on conflict (org_id) do nothing;
update public.employer_billing_config set paid_publishing_enabled = true, paid_active_limit = 20;
select t.as('A');   -- owner context, run as the test harness so it can list post ids
do $$ declare r record; begin
  for r in select id from public.employer_posts where org_id = (select a from t_org) and status in ('closed','paused') loop
    perform public.employer_activate_post(r.id);
  end loop;
end $$;
select t.ok(t.active((select a from t_org)) > 15, 'paid limit applies only with switch, limit and entitlement');
update public.employer_entitlements set status = 'expired', paid_through = now() - interval '1 day';
update public.employer_billing_config set paid_publishing_enabled = false, paid_active_limit = null;
select t.ok(public.employer_apply_downgrade((select a from t_org))->>'state' = 'selection_required', 'no choice: nothing changes');
update public.employer_posts set keep_on_downgrade = true
 where id in (select id from public.employer_posts where org_id = (select a from t_org) and status = 'published' order by id limit 15);
create temp table t_dg as select public.employer_apply_downgrade((select a from t_org)) as r;
grant all on t_dg to public;
select t.ok((select r->>'state' from t_dg) = 'paused_excess', 'excess paused after explicit selection');
select t.ok(t.active((select a from t_org)) = 15, 'back to 15 after downgrade');
select t.ok((select count(*) from public.employer_posts where org_id = (select a from t_org) and status = 'paused') > 0, 'paused posts kept, recoverable');

-- ── 15. suspension hides everything; audit trail exists ──────────────────────
set role authenticated; select t.as('OP');
select public.operator_set_org_status((select a from t_org), 'suspended', 'test');
reset role;
set role anon; select t.ok(t.anon_visible((select a from t_org)) = 0, 'suspended org hidden'); reset role;
select t.ok((select count(*) from public.employer_audit where org_id = (select a from t_org) and action in ('approved','published','revoked','status_verified','status_suspended','domain_verified_dns')) >= 6, 'audit trail recorded');

-- ── 16. effective privileges ─────────────────────────────────────────────────
select t.ok(not exists (
  select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and (p.proname like 'employer\_%' or p.proname like 'operator\_%')
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('employer_listing_visible','employer_public_listing_keys')), 'anon executes only the read-only catalogue visibility helpers');
select t.ok(not exists (
  select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('employer_publish_feed_jobs','employer_stage_feed_candidates','employer_close_feed_jobs','employer_mark_domain_verified',
                      'employer_publish_post_internal','employer_apply_downgrade','employer_source_for_worker','employer_lock_org','employer_audit_log')
    and has_function_privilege('authenticated', p.oid, 'execute')), 'service functions closed to signed-in users');
select t.ok(not exists (
  select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'employer\_%' and c.relkind = 'r'
    and (has_table_privilege('anon', c.oid, 'select,insert,update,delete') or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))),
  'no employer table readable or writable by anon/authenticated');
select t.ok(not has_table_privilege('authenticated', 'public.pre_scraped_jobs', 'insert,update,delete'), 'catalogue still read-only to users');
select t.ok((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'employer\_%' and relkind = 'r' and not relrowsecurity) = 0, 'RLS on every employer table');

rollback;
select 'PASS: employer submissions — permissions, isolation, review, DNS proof, quota 15/16, edits, close/reactivate, forged and premature paid access, feed selection/quota/provenance, expiry, revocation, downgrade, suspension, audit, effective privileges' as result;
