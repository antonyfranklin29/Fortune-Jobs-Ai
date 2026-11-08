-- Employer verification by work email (migrations/pending/20261108_employer_work_email_verify.sql):
-- registration verifies at once, the first-week limit, automatic and manual post review, reviewer
-- confirmation, rejection, suspension, and which emails are queued. Synthetic accounts only. Run on
-- a DISPOSABLE database by tests/employer-work-email-db.mjs, in one transaction that is rolled back.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
begin;

create schema t;
create table t.ids (name text primary key, id uuid not null);
create function t.id(n text) returns uuid language sql stable as $$ select id from t.ids where name = n $$;
create function t.as(n text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce((select id::text from t.ids where name = n), ''), false) $$;
create function t.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', msg; end if; end $$;
create function t.fails(sql text, pattern text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if sqlerrm !~ pattern then raise exception 'FAIL: % raised "%" not /%/', sql, sqlerrm, pattern; end if;
    return;
  end;
  raise exception 'FAIL: % should have failed with /%/', sql, pattern;
end $$;
-- Unique emails: account-email sends each (person, kind, key) once, so repeats are not sent.
create function t.emails(k text) returns int language sql as $$ select count(distinct (body->>'user_id', body->>'key'))::int from net.calls where body->>'kind' = k $$;

insert into t.ids values ('hr', gen_random_uuid()), ('free', gen_random_uuid()), ('other', gen_random_uuid()), ('rv', gen_random_uuid());
insert into auth.users (id, email, email_confirmed_at) values
  (t.id('hr'), 'hr@rehearsal-co.com', now()),
  (t.id('free'), 'someone@gmail.com', now()),
  (t.id('other'), 'jane@elsewhere-co.com', now()),
  (t.id('rv'), 'reviews@fortunejobsai.test', now());
insert into public.employer_operators (user_id, note) values (t.id('rv'), 'test reviewer');

-- 1. Registration rules are unchanged; a matching work email is verified at once.
select t.as('free');
select t.fails($$select public.employer_register_org('Free', 'gmail.com')$$, 'company_email_required');
select t.as('other');
select t.fails($$select public.employer_register_org('Wrong', 'rehearsal-co.com')$$, 'email_domain_mismatch');
select t.as('hr');
do $$ declare r jsonb := public.employer_register_org('Rehearsal Co', 'rehearsal-co.com'); begin
  perform t.ok(r->>'status' = 'verified', 'work email verifies the company: ' || r::text);
  perform t.ok((r->>'first_week_limit')::int = 3, 'first-week limit is 3: ' || r::text);
  insert into t.ids values ('org', (r->>'org_id')::uuid);
end $$;
select t.ok(t.emails('review_company') = 1, 'reviewers are told about the new company');
select t.as('other');
select t.fails($$select public.employer_register_org('Copycat', 'rehearsal-co.com')$$, 'email_domain_mismatch');

-- 2. Posts: routine ones go live automatically, up to 3 in the first week.
select t.as('hr');
do $$ declare i int; r jsonb; p uuid; begin
  for i in 1..4 loop
    r := public.employer_save_post(t.id('org'), null, jsonb_build_object('job_title','Data Analyst '||i,'canonical_role','data-analyst',
      'state_code','NJ','city','Edison','work_mode','hybrid','employment_type','Full-time',
      'description','Analyse hiring data with SQL and Power BI. Build weekly dashboards and explain trends to the team.',
      'apply_url','https://rehearsal-co.com/jobs/'||i,'posting_date',current_date::text,'closing_date',(current_date+30)::text));
    p := (r->>'id')::uuid; insert into t.ids values ('p'||i, p);
    r := public.employer_submit_post(p);
    if i <= 3 then perform t.ok((r->>'published')::boolean and r->>'review' = 'automatic', 'routine post '||i||' goes live: '|| r::text);
    else perform t.ok(not (r->>'published')::boolean and r->>'review' = 'manual', '4th post in 24h waits for a person: '|| r::text); end if;
  end loop;
  r := public.employer_save_post(t.id('org'), null, jsonb_build_object('job_title','Easy money','canonical_role','data-analyst',
      'state_code','NJ','city','Edison','work_mode','remote','employment_type','Full-time',
      'description','Pay the training fee by gift card, then message us on WhatsApp to start working today.',
      'apply_url','https://rehearsal-co.com/jobs/x','posting_date',current_date::text,'closing_date',(current_date+30)::text));
  insert into t.ids values ('scam', (r->>'id')::uuid);
  r := public.employer_submit_post(t.id('scam'));
  perform t.ok(r->>'review' = 'manual', 'scam wording waits for a person: '|| r::text);
end $$;
select t.ok(public.employer_active_count(t.id('org')) = 3, 'three live jobs');
set constraints all immediate;
select t.ok(t.emails('review_post') = 2, 'reviewers are told about the 2 posts waiting, not the 3 published: ' || t.emails('review_post'));

-- 3. Reviewer: the company and both posts are in the queue; the 4th can't go live past the limit.
select t.as('rv');
do $$ declare q jsonb := public.operator_queue(); begin
  perform t.ok(jsonb_array_length(q->'orgs') = 1 and (q->'orgs'->0->>'auto_verified')::boolean, 'company listed for a check: ' || (q->'orgs')::text);
  perform t.ok(jsonb_array_length(q->'posts') = 2, 'two posts waiting');
end $$;
do $$ declare r jsonb := public.operator_review_post(t.id('p4'), (select revision from employer_posts where id = t.id('p4')), 'approve', null); begin
  perform t.ok(not coalesce((r->>'published')::boolean, false), 'first-week limit holds the 4th back: ' || r::text);
end $$;
select public.operator_set_org_status(t.id('org'), 'verified', 'Checked rehearsal-co.com website and LinkedIn');
select t.ok(public.employer_active_limit(t.id('org')) = 15, 'confirmed company gets the full 15');
select t.ok(jsonb_array_length(public.operator_queue()->'orgs') = 0, 'confirmed company leaves the queue');
select t.as('hr');
do $$ declare r jsonb := public.employer_activate_post(t.id('p4')); begin
  perform t.ok((r->>'published')::boolean, 'approved 4th post can go live after confirmation: ' || r::text);
end $$;

-- 4. Rejection and suspension, each with an email to the employer.
select t.as('rv');
select public.operator_review_post(t.id('scam'), (select revision from employer_posts where id = t.id('scam')), 'reject', 'Asks applicants to pay fees');
set constraints all immediate;
select t.ok(t.emails('post_rejected') = 1, 'employer told about the rejection');
select t.ok((select body->'data'->>'note' from net.calls where body->>'kind' = 'post_rejected') = 'Asks applicants to pay fees', 'rejection email carries the reason');
select t.ok(t.emails('post_approved') = 1, 'employer told about the approved 4th post');
select public.operator_set_org_status(t.id('org'), 'suspended', 'Repeated scam posts');
select t.ok((select count(*) from pre_scraped_jobs where employer_org_id = t.id('org') and closed_at is null) = 0, 'suspension closes every live job');
select t.ok(t.emails('company_suspended') = 1, 'employer told about the suspension');
select t.ok((select count(*) from net.calls where body->>'kind' in ('review_company','review_post') and (body->>'user_id')::uuid <> t.id('rv')) = 0, 'review emails go only to reviewers');

\echo 'PASS: employer work-email verification'
rollback;
