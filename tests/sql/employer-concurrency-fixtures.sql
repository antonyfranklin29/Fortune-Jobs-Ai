-- Fixtures for tests/employer-concurrency-db.mjs. Run as the database owner (bypasses RLS)
-- against a database that already has the full pending chain applied. Not rolled back:
-- each scenario gets its own database cloned from a migrated template.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

create table public.conc_ids (name text primary key, id uuid not null);
grant select on public.conc_ids to anon, authenticated, service_role;

insert into public.conc_ids values
  ('A', gen_random_uuid()), ('M', gen_random_uuid()), ('B', gen_random_uuid()),
  ('OP', gen_random_uuid()), ('X', gen_random_uuid()), ('Y', gen_random_uuid()),
  ('C1', gen_random_uuid()), ('C2', gen_random_uuid()), ('C3', gen_random_uuid());

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ((select id from public.conc_ids where name = 'A'),  'owner@acme-a.com', now(), '{}'),
  ((select id from public.conc_ids where name = 'M'),  'member@acme-a.com', now(), '{}'),
  ((select id from public.conc_ids where name = 'B'),  'owner@beta-b.com', now(), '{}'),
  ((select id from public.conc_ids where name = 'OP'), 'ops@fortunejobsai.com', now(), '{}'),
  ((select id from public.conc_ids where name = 'X'),  'x@acme-a.com', now(), '{}'),
  ((select id from public.conc_ids where name = 'Y'),  'y@acme-a.com', now(), '{}'),
  ((select id from public.conc_ids where name = 'C1'), 'c1@contoso.com', now(), '{}'),
  ((select id from public.conc_ids where name = 'C2'), 'c2@contoso.com', now(), '{}'),
  ((select id from public.conc_ids where name = 'C3'), 'c3@contoso.com', now(), '{}');
insert into public.employer_operators (user_id) values ((select id from public.conc_ids where name = 'OP'));

-- Company A: owners A and X, member M (removed later in some scenarios).
-- Company B: owner B. Company C1/C2 are created by scenario code for the domain race.
-- Verification is done the same way the access suite does it: DNS proof by the service
-- role, then operator verification with a note.
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from public.conc_ids where name = 'A'), false);
select public.employer_register_org('Acme Analytics', 'acme-a.com');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select id as org_a from public.employer_orgs where primary_domain = 'acme-a.com' \gset
select token as tok_a from public.employer_domain_challenges where org_id = :'org_a'::uuid \gset
set role service_role;
select public.employer_mark_domain_verified(:'org_a'::uuid, :'tok_a');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from public.conc_ids where name = 'OP'), false);
select public.operator_set_org_status(:'org_a'::uuid, 'verified', 'Checked: Acme Analytics owns acme-a.com');
reset role;
insert into public.employer_org_members (org_id, user_id, role) values
  (:'org_a'::uuid, (select id from public.conc_ids where name = 'X'), 'owner');
insert into public.employer_org_members (org_id, user_id, role) values
  (:'org_a'::uuid, (select id from public.conc_ids where name = 'M'), 'member');
insert into public.conc_ids values ('ORG_A', :'org_a'::uuid) on conflict (name) do nothing;

-- Company B: a single owner (B). Used for the last-owner deletion scenarios.
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from public.conc_ids where name = 'B'), false);
select public.employer_register_org('Beta Labs', 'beta-b.com');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select id as org_b from public.employer_orgs where primary_domain = 'beta-b.com' \gset
select token as tok_b from public.employer_domain_challenges where org_id = :'org_b'::uuid \gset
set role service_role;
select public.employer_mark_domain_verified(:'org_b'::uuid, :'tok_b');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from public.conc_ids where name = 'OP'), false);
select public.operator_set_org_status(:'org_b'::uuid, 'verified', 'Checked: Beta Labs owns beta-b.com');
reset role;
insert into public.conc_ids values ('ORG_B', :'org_b'::uuid) on conflict (name) do nothing;
