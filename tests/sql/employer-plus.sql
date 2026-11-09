-- Employer Plus (migrations/pending/20261109c_employer_plus_billing.sql). DISPOSABLE database only.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
begin;
create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', msg; end if; end $$;
insert into auth.users (id, email, email_confirmed_at) values ('aaaaaaaa-0000-4000-8000-000000000001', 'hr@plusco.com', now());
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', false);
create temp table ids as select (public.employer_register_org('PlusCo', 'plusco.com')->>'org_id')::uuid as org;
select pg_temp.ok((public.employer_my_state()->'plan'->>'checkout_available')::boolean, 'checkout offered');
select pg_temp.ok((public.employer_my_state()->'plan'->>'paid_active_limit')::int = 50, 'plan shows 50');
-- First week: still 3 even with Plus, until a reviewer confirms.
insert into employer_entitlements (org_id, plan_code, status, paid_through, provider, provider_ref, verified_event_at)
  select org, 'employer_plus', 'active', now() + interval '30 days', 'stripe', 'sub_1', now() from ids;
select pg_temp.ok(public.employer_active_limit(org) = 3, 'first-week limit holds: ' || public.employer_active_limit(org)) from ids;
update employer_orgs set reviewer_confirmed_at = now() where id = (select org from ids);
select pg_temp.ok(public.employer_active_limit(org) = 50, 'Plus gives 50: ' || public.employer_active_limit(org)) from ids;
update employer_entitlements set status = 'canceled' where org_id = (select org from ids);
select pg_temp.ok(public.employer_active_limit(org) = 50, 'cancelled keeps 50 until the paid period ends') from ids;
update employer_entitlements set paid_through = now() - interval '1 minute' where org_id = (select org from ids);
select pg_temp.ok(public.employer_active_limit(org) = 15, 'after the paid period: back to 15') from ids;
update employer_entitlements set status = 'expired', paid_through = now() + interval '1 day' where org_id = (select org from ids);
select pg_temp.ok(public.employer_active_limit(org) = 15, 'expired: 15') from ids;
-- Nobody but the service role can touch billing tables.
select pg_temp.ok(not has_table_privilege('authenticated', 'public.employer_billing_customers', 'select'), 'customers table private');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.employer_entitlements', 'insert'), 'entitlements not writable by users');
\echo 'PASS: employer plus'
rollback;
