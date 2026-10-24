-- End-to-end rehearsal of the employer approval flow, as the employer and an
-- independent reviewer would experience it: company-domain registration, DNS proof,
-- reviewer verification, post review (approve, stale revision, reject with feedback),
-- edits to a live post, suspension, and what employer_my_state tells the employer at
-- each step. Synthetic accounts only. Run on a DISPOSABLE database by
-- tests/employer-approval-flow-db.mjs. Everything runs in one transaction and is rolled back.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
begin;

create schema t;
grant usage on schema t to anon, authenticated, service_role;
create table t.ids (name text primary key, id uuid not null);
create table t.kv (k text primary key, v text);
grant select on t.ids to anon, authenticated, service_role;
grant select, insert, update on t.kv to anon, authenticated, service_role;

create function t.id(n text) returns uuid language sql stable as $$ select id from t.ids where name = n $$;
create function t.as(n text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce((select id::text from t.ids where name = n), ''), false) $$;
create function t.put(k text, v text) returns void language sql as $$
  insert into t.kv values (k, v) on conflict (k) do update set v = excluded.v $$;
create function t.get(k text) returns text language sql stable as $$ select v from t.kv where k = $1 $$;
create function t.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', msg; end if; end $$;
create function t.fails(sql text, pattern text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if sqlerrm !~* pattern then raise exception 'FAIL: % failed with "%" instead of /%/', sql, sqlerrm, pattern; end if;
    return;
  end;
  raise exception 'FAIL: expected % to fail with /%/', sql, pattern;
end $$;
-- The employer's own view of one post, exactly as the workspace receives it.
create function t.my_post(p uuid) returns jsonb language sql volatile as $$
  select x from jsonb_array_elements((public.employer_my_state()->'orgs')->0->'posts') x where x->>'id' = p::text $$;
create function t.my_org() returns jsonb language sql volatile as $$
  select (public.employer_my_state()->'orgs')->0 $$;
create function t.public_title(org uuid) returns text language sql stable as $$
  select string_agg(job_title, '|' order by id) from public.pre_scraped_jobs where employer_org_id = org and closed_at is null $$;
-- The reviewer queue shows the revision; the test reads it directly (owner rights).
create function t.rev(p text) returns int language sql stable security definer as $$
  select revision from public.employer_posts where id = p::uuid $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

insert into t.ids values ('OWNER', gen_random_uuid()), ('PERSONAL', gen_random_uuid()), ('OTHER', gen_random_uuid()),
  ('REVIEWER', gen_random_uuid());
insert into auth.users (id, email, email_confirmed_at) values
  (t.id('OWNER'), 'hiring@team.rehearsal-co.com', now()),   -- subdomain address: allowed
  (t.id('PERSONAL'), 'someone@gmail.com', now()),
  (t.id('OTHER'), 'person@unrelated-co.com', now()),
  (t.id('REVIEWER'), 'reviewer@fortunejobsai.com', now());
insert into public.employer_operators (user_id) values (t.id('REVIEWER'));

-- ── 1. registration: the company-domain rule ─────────────────────────────────
set role authenticated;
select t.as('PERSONAL');
select t.fails($$select public.employer_register_org('Rehearsal Co', 'rehearsal-co.com')$$, 'company_email_required');
select t.as('OTHER');
select t.fails($$select public.employer_register_org('Rehearsal Co', 'rehearsal-co.com')$$, 'email_domain_mismatch');
select t.as('OWNER');
select t.fails($$select public.employer_register_org('Mail', 'gmail.com')$$, 'free_email_domain_not_allowed');
select t.put('org', (public.employer_register_org('Rehearsal Co', 'rehearsal-co.com'))->>'org_id');
select t.ok(t.my_org()->>'status' = 'pending' and (t.my_org()->>'domain_verified')::boolean is false,
  'a new company starts pending and unverified');
select t.ok(t.my_org()->>'dns_record' = '_fortunejobsai.rehearsal-co.com', 'the employer is shown the DNS record to publish');
-- An employer can never review or verify anything, including their own company.
select t.fails(format($$select public.operator_set_org_status(%L, 'verified', 'self')$$, t.get('org')), 'operator_only');
reset role;

-- ── 2. reviewer cannot verify before the domain is proven ────────────────────
set role authenticated;
select t.as('REVIEWER');
select t.fails(format($$select public.operator_set_org_status(%L, 'verified', 'checked name')$$, t.get('org')), 'domain_not_verified');
select t.fails(format($$select public.operator_set_org_status(%L, 'verified', '  ')$$, t.get('org')), 'note_required');
reset role;

-- ── 3. DNS proof, as the domain-check function does it with the service role ─
set role service_role;
select t.put('attempt', (public.employer_domain_check_begin(t.get('org')::uuid, t.id('OWNER')))->>'attempt_id');
-- A token that does not match the challenge is not accepted as proof.
select t.ok((public.employer_domain_check_finish(t.get('org')::uuid, t.id('OWNER'), t.get('attempt')::uuid, 'wrong-token', true))->>'state' = 'invalidated',
  'a wrong DNS token is not accepted');
reset role;
update public.employer_domain_challenges set checked_at = now() - interval '2 minutes' where org_id = t.get('org')::uuid;
set role service_role;
select t.put('attempt', (public.employer_domain_check_begin(t.get('org')::uuid, t.id('OWNER')))->>'attempt_id');
select t.ok((public.employer_domain_check_finish(t.get('org')::uuid, t.id('OWNER'), t.get('attempt')::uuid,
  (select token from public.employer_domain_challenges where org_id = t.get('org')::uuid), true))->>'verified' = 'true',
  'a matching DNS record verifies the domain');
reset role;
set role authenticated;
select t.as('OWNER');
select t.ok((t.my_org()->>'domain_verified')::boolean and t.my_org()->>'status' = 'pending',
  'DNS proof alone does not verify the company; it still waits for a reviewer');
select t.as('REVIEWER');
select public.operator_set_org_status(t.get('org')::uuid, 'verified', 'Name matches the domain owner on the company site');
select t.as('OWNER');
select t.ok(t.my_org()->>'status' = 'verified', 'the employer sees the company verified');
reset role;

-- ── 4. a post: submit, stale review refused, approve publishes ───────────────
set role authenticated;
select t.as('OWNER');
select t.put('post', (public.employer_save_post(t.get('org')::uuid, null, jsonb_build_object(
  'job_title', 'Data Analyst', 'canonical_role', 'data-analyst', 'state_code', 'nc', 'city', 'Raleigh',
  'description', repeat('Analyse data and build reports for the finance team. ', 3),
  'apply_url', 'https://careers.rehearsal-co.com/jobs/1',
  'posting_date', current_date::text, 'closing_date', (current_date + 30)::text)))->>'id');
select public.employer_submit_post(t.get('post')::uuid);
select t.ok(t.my_post(t.get('post')::uuid)->>'status' = 'pending_review', 'the employer sees the post in review');
select t.fails(format($$select public.employer_activate_post(%L)$$, t.get('post')), 'review_required');
select t.as('REVIEWER');
select t.fails(format($$select public.operator_review_post(%L, 99, 'approve', null)$$, t.get('post')), 'revision_changed');
select public.operator_review_post(t.get('post')::uuid,
  t.rev(t.get('post')), 'approve', null);
reset role;
select t.ok(t.public_title(t.get('org')::uuid) = 'Data Analyst', 'approval publishes the reviewed version');

-- ── 5. an edit to the live post waits for review; the public version is kept ─
set role authenticated;
select t.as('OWNER');
select public.employer_save_post(t.get('org')::uuid, t.get('post')::uuid, jsonb_build_object('job_title', 'Senior Data Analyst'));
select public.employer_submit_post(t.get('post')::uuid);
select t.ok((t.my_post(t.get('post')::uuid)->>'has_unreviewed_changes')::boolean, 'the employer sees the edit waiting for review');
reset role;
select t.ok(t.public_title(t.get('org')::uuid) = 'Data Analyst', 'an unreviewed edit never reaches the public listing');

-- ── 6. the reviewer rejects that edit: the employer must receive the reason ──
set role authenticated;
select t.as('REVIEWER');
select public.operator_review_post(t.get('post')::uuid,
  t.rev(t.get('post')), 'reject', 'Title must match the role on your careers page');
select t.as('OWNER');
select t.put('after_reject', t.my_post(t.get('post')::uuid)::text);
reset role;
select t.ok(t.public_title(t.get('org')::uuid) = 'Data Analyst', 'rejecting an edit keeps the approved public version live');
select t.ok((t.get('after_reject')::jsonb)->>'status' = 'published', 'the post itself stays published');
select t.ok((t.get('after_reject')::jsonb)->>'review_note' = 'Title must match the role on your careers page',
  'the rejection reason reaches the employer state');
select t.ok(((t.get('after_reject')::jsonb)->>'has_unreviewed_changes')::boolean is false, 'nothing is waiting for review any more');
-- What the workspace needs to show the note: a review note on a post with no pending edit.
-- (The workspace previously showed the note only for status "rejected"; see employer-workspace.cjs.)
\echo REJECTED_LIVE_EDIT_STATE
select t.get('after_reject');

-- The employer can fix the edit and send it again; approval updates the live version.
set role authenticated;
select t.as('OWNER');
select public.employer_save_post(t.get('org')::uuid, t.get('post')::uuid, jsonb_build_object('job_title', 'Data Analyst II'));
select public.employer_submit_post(t.get('post')::uuid);
select t.as('REVIEWER');
select public.operator_review_post(t.get('post')::uuid,
  t.rev(t.get('post')), 'approve', null);
select t.as('OWNER');
select t.ok(t.my_post(t.get('post')::uuid)->>'review_note' is null, 'a later approval clears the old rejection note');
reset role;
select t.ok(t.public_title(t.get('org')::uuid) = 'Data Analyst II', 'the approved edit replaces the live version');

-- ── 7. a new post rejected outright ──────────────────────────────────────────
set role authenticated;
select t.as('OWNER');
select t.put('post2', (public.employer_save_post(t.get('org')::uuid, null, jsonb_build_object(
  'job_title', 'Analyst', 'canonical_role', 'data-analyst', 'state_code', 'nc', 'city', 'Durham',
  'description', repeat('Short role description for the rehearsal post. ', 3),
  'apply_url', 'https://careers.rehearsal-co.com/jobs/2',
  'posting_date', current_date::text, 'closing_date', (current_date + 30)::text)))->>'id');
select public.employer_submit_post(t.get('post2')::uuid);
select t.as('REVIEWER');
select t.fails(format($$select public.operator_review_post(%L, %s, 'reject', ' ')$$, t.get('post2'),
  t.rev(t.get('post2'))), 'reason_required');
select public.operator_review_post(t.get('post2')::uuid,
  t.rev(t.get('post2')), 'reject', 'Add the salary range');
select t.as('OWNER');
select t.ok(t.my_post(t.get('post2')::uuid)->>'status' = 'rejected'
  and t.my_post(t.get('post2')::uuid)->>'review_note' = 'Add the salary range', 'a rejected draft shows its reason');
reset role;

-- ── 8. suspension closes listings and blocks new work; billing is untouched ──
set role authenticated;
select t.as('REVIEWER');
select public.operator_set_org_status(t.get('org')::uuid, 'suspended', 'Rehearsal suspension');
select t.as('OWNER');
select t.ok(t.my_org()->>'status' = 'suspended', 'the employer sees the suspension');
select t.fails(format($$select public.employer_save_post(%L, null, '{}'::jsonb)$$, t.get('org')), 'organization_inactive');
select t.ok((t.my_org()->>'active_limit')::int = 15, 'the free allowance stays 15 active posts');
select t.ok((public.employer_my_state()->'plan'->>'paid_publishing_enabled')::boolean is false
  and (public.employer_my_state()->'plan'->>'monthly_price_cents')::int = 1499
  and (public.employer_my_state()->'plan'->>'checkout_available')::boolean is false, 'paid publishing stays off at USD 14.99');
reset role;
select t.ok(t.public_title(t.get('org')::uuid) is null, 'suspension closes every live listing');

\echo PASS: employer approval flow rehearsal
rollback;
