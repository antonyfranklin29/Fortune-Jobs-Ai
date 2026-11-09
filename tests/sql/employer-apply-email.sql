-- Apply by email (migrations/pending/20261109b_employer_apply_by_email.sql). Synthetic accounts
-- only, on a DISPOSABLE database (tests/employer-apply-email-db.mjs), rolled back at the end.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
begin;
create schema t;
create table t.ids (name text primary key, id uuid not null);
create function t.id(n text) returns uuid language sql stable as $$ select id from t.ids where name = n $$;
create function t.as(n text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce((select id::text from t.ids where name = n), ''), false),
         set_config('request.jwt.claims', json_build_object('sub', coalesce((select id::text from t.ids where name = n), ''), 'role', 'authenticated')::text, false) $$;
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
create function t.fields(email text, url text default null) returns jsonb language sql as $$
  select jsonb_build_object('job_title','Java Developer','canonical_role','software-engineer','state_code','NJ','city','Edison',
    'work_mode','hybrid','employment_type','Contract','description','Build Java services for a banking client. Five years of Java and Spring required.',
    'apply_email',email,'apply_url',url,'posting_date',current_date::text,'closing_date',(current_date+30)::text) $$;

insert into t.ids values ('hr', gen_random_uuid()), ('rv', gen_random_uuid()), ('out', gen_random_uuid());
insert into auth.users (id, email, email_confirmed_at) values
  (t.id('hr'), 'jobs@vendorco.com', now()), (t.id('rv'), 'reviews@fortunejobsai.test', now()), (t.id('out'), 'x@other.com', now());
insert into public.employer_operators (user_id, note) values (t.id('rv'), 'test reviewer');
select t.as('hr');
do $$ declare r jsonb := public.employer_register_org('VendorCo', 'vendorco.com'); begin insert into t.ids values ('org', (r->>'org_id')::uuid); end $$;

-- 1. Email must be on the company's domain; a post needs a link or an email.
select t.fails($$select public.employer_save_post(t.id('org'), null, t.fields('hr.vendorco@gmail.com'))$$, 'apply_email_domain_mismatch');
select t.fails($$select public.employer_save_post(t.id('org'), null, t.fields('a@vendorco.com.evil.io'))$$, 'apply_email_domain_mismatch');
select t.fails($$select public.employer_save_post(t.id('org'), null, t.fields(null))$$, 'apply_link_required');
do $$ declare r jsonb := public.employer_save_post(t.id('org'), null, t.fields(' Recruiter@VendorCo.com ')); p employer_posts; begin
  insert into t.ids values ('p', (r->>'id')::uuid);
  select * into p from employer_posts where id = t.id('p');
  perform t.ok(p.apply_email = 'recruiter@vendorco.com', 'email saved in lower case: ' || p.apply_email);
  perform t.ok(p.apply_url = 'https://fortunejobsai.com/apply.html?job=' || p.id, 'apply link is our page: ' || p.apply_url);
end $$;
select t.ok(public.employer_save_post(t.id('org'), null, t.fields('talent@jobs.vendorco.com')) ? 'id', 'subdomain email allowed');
select t.ok(public.employer_apply_emails(t.id('org'))->>t.id('p')::text = 'recruiter@vendorco.com', 'workspace can read the email');

-- 2. Not live yet: the public cannot read it; the company and reviewers can preview it.
select t.as('out');
select t.ok(public.employer_apply_info(t.id('p')) is null, 'outsider cannot see an unpublished job');
select t.fails($$select public.employer_apply_emails(t.id('org'))$$, 'not_a_member');
select t.as('rv');
select t.ok((public.employer_apply_info(t.id('p'))->>'live')::boolean = false, 'reviewer preview works before going live');

-- 3. Submit: goes to a person (our page is not on the company domain); approve; live.
select t.as('hr');
select t.ok(public.employer_submit_post(t.id('p'))->>'review' = 'manual', 'email-apply jobs are checked by a reviewer');
select t.as('rv');
select public.operator_review_post(t.id('p'), (select revision from employer_posts where id = t.id('p')), 'approve', null);
select t.ok((select count(*) from pre_scraped_jobs where apply_url = 'https://fortunejobsai.com/apply.html?job=' || t.id('p') and closed_at is null) = 1, 'job is live in the catalogue');
select t.as('');
do $$ declare r jsonb := public.employer_apply_info(t.id('p')); begin
  perform t.ok(r->>'apply_email' = 'recruiter@vendorco.com' and r->>'company' = 'VendorCo' and (r->>'live')::boolean, 'public apply info: ' || coalesce(r::text, 'null'));
end $$;

-- 4. Switching back to a link; an empty switch without a link is refused.
select t.as('hr');
select t.fails($$select public.employer_save_post(t.id('org'), t.id('p'), jsonb_build_object('apply_email', ''))$$, 'apply_link_required');
select public.employer_save_post(t.id('org'), t.id('p'), jsonb_build_object('apply_email', '', 'apply_url', 'https://vendorco.com/jobs/1'));
select t.ok((select apply_email is null and apply_url = 'https://vendorco.com/jobs/1' from employer_posts where id = t.id('p')), 'switched to a link');
-- Ordinary edits leave the method alone.
select public.employer_save_post(t.id('org'), t.id('p'), jsonb_build_object('city', 'Iselin'));
select t.ok((select apply_url from employer_posts where id = t.id('p')) = 'https://vendorco.com/jobs/1', 'edit keeps the link');

-- 5. Suspended company: the public page stops showing the email.
select public.employer_save_post(t.id('org'), t.id('p'), jsonb_build_object('apply_email', 'recruiter@vendorco.com'));
select t.as('rv');
select public.operator_set_org_status(t.id('org'), 'suspended', 'test');
select t.as('');
select t.ok(public.employer_apply_info(t.id('p')) is null, 'suspended company hides the email');

\echo 'PASS: employer apply by email'
rollback;
