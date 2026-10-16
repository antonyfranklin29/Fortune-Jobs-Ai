-- PENDING — NOT APPLIED. Employer organisations, verified ownership, direct job
-- submissions, employer-feed source registry, operator review with audit, the
-- source-scoped publication path and the organisation-wide active-post quota.
--
-- Owner: Claude (employer submissions/approval track,
-- docs/employer-sourcing-plan-2026-10-15.md). Codex reviews before applying.
-- Tested against PostgreSQL 16 with a Supabase role/auth shim:
-- tests/employer-submissions.sql (run by tests/employer-submissions-db.mjs).
--
-- Principles
--   * Every table: RLS on, NO grants to anon/authenticated. All access goes
--     through SECURITY DEFINER functions that check auth.uid(), membership and
--     operator status themselves. PUBLIC execute is revoked on every function.
--   * Employers create and edit; they never approve, verify, enable, set hosts,
--     set rights, set plans, or publish unreviewed content. Every submission
--     starts pending.
--   * Operators are rows in employer_operators, inserted only by the database
--     owner. Never user_metadata. An operator cannot review their own org.
--   * Publication is one transaction under an organisation row lock: it
--     re-checks org verification, approval of the exact revision, source
--     approval/expiry and the active-post quota, so concurrent publishes cannot
--     overshoot 15.
--   * Quota: 15 active published posts per organisation across direct and feed
--     posts. Paid publishing stays OFF until billing is integrated
--     (employer_billing_config.paid_publishing_enabled = false and no paid limit
--     set). A forged or even a service-written entitlement cannot raise the
--     limit while that switch is off.
--   * Public visibility: employer rows are hidden by the catalogue's RLS policy
--     the moment their org is suspended, their source is revoked/expired or the
--     post's closing date passes — not only when a worker gets round to it.
--
-- SHARED-FILE CHANGES (flagged for Codex review): adds four nullable
-- provenance columns to public.pre_scraped_jobs and replaces its public read
-- policy with one that also checks employer visibility. Non-employer rows are
-- unaffected (the extra conditions short-circuit on null employer_org_id).

-- ── organisations, membership, operators ─────────────────────────────────────
create table if not exists public.employer_orgs (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 2 and 200 and name !~ '[<>[:cntrl:]]'),
  primary_domain     text not null check (primary_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' and char_length(primary_domain) <= 253),
  status             text not null default 'pending' check (status in ('pending','verified','rejected','suspended')),
  domain_verified_at timestamptz,
  domain_verify_method text check (domain_verify_method in ('dns_txt','operator_manual')),
  verified_by        uuid references auth.users(id),
  verified_at        timestamptz,
  created_by         uuid not null references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists employer_orgs_domain_uq on public.employer_orgs (primary_domain) where status <> 'rejected';

create table if not exists public.employer_org_members (
  org_id     uuid not null references public.employer_orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner','member')),
  status     text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- DNS proof of domain control: publish TXT "fortunejobsai-verify=<token>" at
-- _fortunejobsai.<domain>. The token is not a secret (it ends up in DNS) but is
-- only shown to the org's members.
create table if not exists public.employer_domain_challenges (
  org_id     uuid primary key references public.employer_orgs(id) on delete cascade,
  token      text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  last_result text
);

create table if not exists public.employer_operators (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  note     text
);

-- ── plans and entitlements (server-owned) ────────────────────────────────────
create table if not exists public.employer_billing_config (
  id                      boolean primary key default true check (id),
  free_active_posts       integer not null default 15 check (free_active_posts between 0 and 1000),
  paid_plan_code          text not null default 'employer_plus',
  monthly_price_cents     integer not null default 1499,
  currency                text not null default 'USD',
  paid_publishing_enabled boolean not null default false,
  paid_active_limit       integer check (paid_active_limit is null or paid_active_limit > 15),
  updated_at              timestamptz not null default now()
);
insert into public.employer_billing_config (id) values (true) on conflict (id) do nothing;

-- Written only by a future, signature-verified billing webhook (service role).
create table if not exists public.employer_entitlements (
  org_id          uuid primary key references public.employer_orgs(id) on delete cascade,
  plan_code       text not null check (plan_code in ('employer_plus')),
  status          text not null check (status in ('active','canceled','past_due','expired')),
  paid_through    timestamptz,
  provider        text,
  provider_ref    text,
  verified_event_at timestamptz not null,
  updated_at      timestamptz not null default now()
);

-- ── employer-feed source registry (contract v1) ──────────────────────────────
create table if not exists public.employer_sources (
  id                       text primary key default ('src_' || replace(gen_random_uuid()::text, '-', '')) check (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  org_id                   uuid not null references public.employer_orgs(id) on delete restrict,
  adapter                  text not null check (adapter in ('greenhouse','lever')),
  api_region               text not null default 'global' check (api_region in ('global','eu') and not (adapter = 'greenhouse' and api_region <> 'global')),
  board_token              text not null check (board_token ~ '^[a-z0-9][a-z0-9_-]{0,99}$'),
  employer_name            text not null check (char_length(employer_name) between 2 and 200 and employer_name !~ '[<>[:cntrl:]]'),
  status                   text not null default 'pending' check (status in ('pending','approved','rejected','revoked')),
  enabled                  boolean not null default false,
  rights_basis             text check (rights_basis is null or rights_basis = 'employer_written_permission'),
  permission_ref           text,
  approved_by              uuid references auth.users(id),
  approved_at              timestamptz,
  authorization_expires_at timestamptz,
  allow_display            boolean not null default false,
  allow_refresh            boolean not null default false,
  allow_description        boolean not null default false,
  allowed_apply_hosts      text[] not null default '{}',
  requested_apply_hosts    text[] not null default '{}',
  attribution_text         text not null default '' check (char_length(attribution_text) <= 120 and attribution_text !~ '[<>[:cntrl:]]'),
  revision                 integer not null default 1 check (revision > 0),
  submitted_by             uuid not null references auth.users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (not enabled or status = 'approved'),
  check (status <> 'approved' or (rights_basis is not null and permission_ref is not null and approved_by is not null
         and approved_at is not null and authorization_expires_at is not null
         and cardinality(allowed_apply_hosts) between 1 and 8))
);
create unique index if not exists employer_sources_board_uq on public.employer_sources (adapter, api_region, board_token) where status in ('pending','approved');

-- Private permission evidence: the employer's attestation, plus whatever the
-- operator records. Never returned to employers or the public.
create table if not exists public.employer_source_evidence (
  id                bigint generated always as identity primary key,
  source_id         text not null references public.employer_sources(id) on delete cascade,
  kind              text not null check (kind in ('employer_attestation','operator_note')),
  attested_by       uuid references auth.users(id),
  wording_version   text,
  grants            jsonb not null default '{}'::jsonb,
  note              text check (char_length(note) <= 2000),
  created_at        timestamptz not null default now()
);

-- Feed postings the worker has staged privately; the employer chooses which to
-- distribute. Only selected candidates may be published.
create table if not exists public.employer_feed_candidates (
  source_id        text not null references public.employer_sources(id) on delete cascade,
  provider_post_id text not null check (provider_post_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  revision         integer not null,
  payload          jsonb not null,
  staged_at        timestamptz not null default now(),
  selected         boolean not null default false,
  selected_by      uuid references auth.users(id),
  selected_at      timestamptz,
  primary key (source_id, provider_post_id)
);

-- ── direct employer posts ────────────────────────────────────────────────────
create table if not exists public.employer_posts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.employer_orgs(id) on delete restrict,
  created_by         uuid not null references auth.users(id),
  status             text not null default 'draft'
                     check (status in ('draft','pending_review','approved','rejected','published','paused','closed')),
  revision           integer not null default 1,
  reviewed_revision  integer,
  has_unreviewed_changes boolean not null default false,
  publish_state      text check (publish_state in ('upgrade_required','apply_url_already_listed','org_not_verified','expired')),
  job_title          text not null check (char_length(job_title) between 3 and 200 and job_title !~ '[<>[:cntrl:]]'),
  canonical_role     text not null references public.ingest_roles(id),
  country            text not null default 'us' check (country = 'us'),
  state_code         text not null references public.ingest_regions(code),
  city               text not null check (char_length(city) between 2 and 100 and city !~ '[<>[:cntrl:]]'),
  work_mode          text not null default 'onsite' check (work_mode in ('onsite','hybrid','remote')),
  employment_type    text not null default 'Full-time' check (employment_type in ('Full-time','Part-time','Contract','Internship','Temporary')),
  description        text not null check (char_length(description) between 50 and 8000),
  apply_url          text not null check (char_length(apply_url) <= 2000 and apply_url ~ '^https://[a-z0-9.-]+\.[a-z]{2,63}(/[^[:space:]]*)?$'),
  posting_date       date not null,
  closing_date       date not null,
  keep_on_downgrade  boolean not null default false,
  published_job_id   bigint references public.pre_scraped_jobs(id),
  review_note        text,
  reviewed_by        uuid references auth.users(id),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (closing_date > posting_date and closing_date <= posting_date + 90)
);
create index if not exists employer_posts_org_idx on public.employer_posts (org_id, status);

-- ── audit ────────────────────────────────────────────────────────────────────
create table if not exists public.employer_audit (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     uuid,
  actor_kind text not null check (actor_kind in ('employer','operator','service','system')),
  org_id    uuid,
  entity    text not null,
  entity_id text not null,
  action    text not null,
  detail    jsonb not null default '{}'::jsonb
);
create index if not exists employer_audit_org_idx on public.employer_audit (org_id, at desc);

-- ── catalogue provenance (shared table; additive) ────────────────────────────
alter table public.pre_scraped_jobs
  add column if not exists employer_org_id    uuid references public.employer_orgs(id) on delete restrict,
  add column if not exists employer_source_id text references public.employer_sources(id) on delete restrict,
  add column if not exists employer_post_id   uuid references public.employer_posts(id) on delete restrict,
  add column if not exists expires_at         timestamptz;
create index if not exists pre_scraped_jobs_employer_org_idx
  on public.pre_scraped_jobs (employer_org_id) where employer_org_id is not null and closed_at is null;

-- ── lock down every new table ────────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['employer_orgs','employer_org_members','employer_domain_challenges','employer_operators',
    'employer_billing_config','employer_entitlements','employer_sources','employer_source_evidence',
    'employer_feed_candidates','employer_posts','employer_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- ── helpers ──────────────────────────────────────────────────────────────────
create or replace function public.employer_audit_log(p_actor uuid, p_kind text, p_org uuid, p_entity text, p_id text, p_action text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into employer_audit (actor, actor_kind, org_id, entity, entity_id, action, detail)
  values (p_actor, p_kind, p_org, p_entity, p_id, p_action, coalesce(p_detail, '{}'::jsonb));
$$;

-- The calling user, required to be signed in with a confirmed email.
create or replace function public.employer_caller()
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'sign_in_required' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = u and email_confirmed_at is not null) then
    raise exception 'email_not_confirmed' using errcode = '42501';
  end if;
  return u;
end $$;

create or replace function public.employer_is_member(p_org uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from employer_org_members where org_id = p_org and user_id = p_user and status = 'active');
$$;

-- Operator for a given org: a registered operator who is NOT a member of it.
create or replace function public.employer_require_operator(p_org uuid)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller();
begin
  if not exists (select 1 from employer_operators where user_id = u) then
    raise exception 'operator_only' using errcode = '42501';
  end if;
  if p_org is not null and public.employer_is_member(p_org, u) then
    raise exception 'cannot_review_own_organization' using errcode = '42501';
  end if;
  return u;
end $$;

-- Effective active-post limit. Paid publishing needs BOTH the server switch and
-- a verified, unexpired entitlement. Until billing ships the switch is off.
create or replace function public.employer_active_limit(p_org uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when c.paid_publishing_enabled and c.paid_active_limit is not null and exists (
      select 1 from employer_entitlements e
       where e.org_id = p_org and e.plan_code = c.paid_plan_code
         and e.status in ('active','canceled','past_due') and e.paid_through > now())
    then c.paid_active_limit
    else c.free_active_posts end
  from employer_billing_config c where c.id;
$$;

create or replace function public.employer_active_count(p_org uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from pre_scraped_jobs
   where employer_org_id = p_org and closed_at is null and (expires_at is null or expires_at > now());
$$;

-- Public visibility of an employer row (used by the catalogue's RLS policy).
create or replace function public.employer_listing_visible(p_org uuid, p_source text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from employer_orgs o where o.id = p_org and o.status = 'verified')
     and (p_source is null or exists (
          select 1 from employer_sources s
           where s.id = p_source and s.org_id = p_org and s.status = 'approved' and s.enabled
             and s.allow_display and s.authorization_expires_at > now()));
$$;

create or replace function public.employer_valid_host(h text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select h is not null and char_length(h) <= 253
     and h ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
     and h !~ '\.(localhost|local|internal|test|invalid|example)$';
$$;

create or replace function public.employer_url_host(u text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select lower(substring(u from '^https://([a-z0-9.-]+)(?:[/?#]|$)'));
$$;

-- Holding the org row lock serialises every publication for that org.
create or replace function public.employer_lock_org(p_org uuid)
returns employer_orgs language plpgsql security definer set search_path = public, pg_temp as $$
declare o employer_orgs;
begin
  select * into o from employer_orgs where id = p_org for update;
  if not found then raise exception 'organization_not_found'; end if;
  return o;
end $$;

-- ── employer: organisation ───────────────────────────────────────────────────
create or replace function public.employer_register_org(p_name text, p_domain text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); d text := lower(btrim(p_domain)); o employer_orgs; email_domain text;
begin
  if (select count(*) from employer_org_members where user_id = u and status = 'active') >= 3 then
    raise exception 'too_many_organizations';
  end if;
  insert into employer_orgs (name, primary_domain, created_by) values (btrim(p_name), d, u) returning * into o;
  insert into employer_org_members (org_id, user_id, role) values (o.id, u, 'owner');
  insert into employer_domain_challenges (org_id) values (o.id);
  select lower(split_part(email, '@', 2)) into email_domain from auth.users where id = u;
  perform public.employer_audit_log(u, 'employer', o.id, 'org', o.id::text, 'registered',
    jsonb_build_object('domain', d, 'email_domain_matches', email_domain = d or email_domain like '%.' || d));
  return jsonb_build_object('org_id', o.id, 'status', o.status,
    'dns_record', '_fortunejobsai.' || d,
    'dns_value', 'fortunejobsai-verify=' || (select token from employer_domain_challenges where org_id = o.id));
exception when unique_violation then
  raise exception 'domain_already_registered';
end $$;

-- ── employer: read model (own orgs only; no private evidence) ────────────────
create or replace function public.employer_my_state()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller();
begin
  return jsonb_build_object(
    'plan', (select jsonb_build_object('free_active_posts', free_active_posts, 'paid_plan_code', paid_plan_code,
               'monthly_price_cents', monthly_price_cents, 'currency', currency,
               'checkout_available', false, 'paid_publishing_enabled', paid_publishing_enabled)
               from employer_billing_config where id),
    'orgs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'primary_domain', o.primary_domain, 'status', o.status,
        'role', m.role, 'domain_verified', o.domain_verified_at is not null,
        'dns_record', '_fortunejobsai.' || o.primary_domain,
        'dns_value', 'fortunejobsai-verify=' || c.token,
        'active_posts', public.employer_active_count(o.id),
        'active_limit', public.employer_active_limit(o.id),
        'entitlement', (select jsonb_build_object('plan_code', e.plan_code, 'status', e.status, 'paid_through', e.paid_through)
                          from employer_entitlements e where e.org_id = o.id),
        'posts', coalesce((select jsonb_agg(jsonb_build_object(
            'id', p.id, 'status', p.status, 'publish_state', p.publish_state, 'job_title', p.job_title,
            'canonical_role', p.canonical_role, 'state_code', p.state_code, 'city', p.city,
            'work_mode', p.work_mode, 'employment_type', p.employment_type, 'description', p.description,
            'apply_url', p.apply_url, 'posting_date', p.posting_date, 'closing_date', p.closing_date,
            'has_unreviewed_changes', p.has_unreviewed_changes, 'review_note', p.review_note,
            'keep_on_downgrade', p.keep_on_downgrade, 'updated_at', p.updated_at) order by p.updated_at desc)
            from employer_posts p where p.org_id = o.id), '[]'::jsonb),
        'sources', coalesce((select jsonb_agg(jsonb_build_object(
            'id', s.id, 'adapter', s.adapter, 'api_region', s.api_region, 'board_token', s.board_token,
            'status', s.status, 'enabled', s.enabled, 'authorization_expires_at', s.authorization_expires_at,
            'requested_apply_hosts', s.requested_apply_hosts, 'allowed_apply_hosts', s.allowed_apply_hosts,
            'candidates', (select count(*) from employer_feed_candidates fc where fc.source_id = s.id),
            'selected', (select count(*) from employer_feed_candidates fc where fc.source_id = s.id and fc.selected)))
            from employer_sources s where s.org_id = o.id), '[]'::jsonb)
      ) order by o.created_at)
      from employer_orgs o
      join employer_org_members m on m.org_id = o.id and m.user_id = u and m.status = 'active'
      left join employer_domain_challenges c on c.org_id = o.id), '[]'::jsonb));
end $$;

-- ── employer: direct posts ───────────────────────────────────────────────────
-- Creates or edits. Only whitelisted content fields are read from p_fields;
-- anything else (status, plan, paid, approved, org, published ids…) is ignored.
create or replace function public.employer_save_post(p_org uuid, p_post uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); p employer_posts; f jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  if not public.employer_is_member(p_org, u) then raise exception 'not_a_member' using errcode = '42501'; end if;
  if (select status from employer_orgs where id = p_org) in ('rejected','suspended') then raise exception 'organization_inactive'; end if;
  if p_post is null then
    if (select count(*) from employer_posts where org_id = p_org and status in ('draft','pending_review')) >= 50 then
      raise exception 'too_many_open_drafts';
    end if;
    insert into employer_posts (org_id, created_by, job_title, canonical_role, state_code, city, work_mode,
                                employment_type, description, apply_url, posting_date, closing_date)
    values (p_org, u, btrim(f->>'job_title'), f->>'canonical_role', upper(f->>'state_code'), btrim(f->>'city'),
            coalesce(f->>'work_mode', 'onsite'), coalesce(f->>'employment_type', 'Full-time'),
            btrim(f->>'description'), btrim(f->>'apply_url'), (f->>'posting_date')::date, (f->>'closing_date')::date)
    returning * into p;
    perform public.employer_audit_log(u, 'employer', p_org, 'post', p.id::text, 'created');
  else
    select * into p from employer_posts where id = p_post and org_id = p_org for update;
    if not found then raise exception 'post_not_found'; end if;
    if p.status = 'closed' then raise exception 'post_closed'; end if;
    update employer_posts set
      job_title       = coalesce(btrim(f->>'job_title'), job_title),
      canonical_role  = coalesce(f->>'canonical_role', canonical_role),
      state_code      = coalesce(upper(f->>'state_code'), state_code),
      city            = coalesce(btrim(f->>'city'), city),
      work_mode       = coalesce(f->>'work_mode', work_mode),
      employment_type = coalesce(f->>'employment_type', employment_type),
      description     = coalesce(btrim(f->>'description'), description),
      apply_url       = coalesce(btrim(f->>'apply_url'), apply_url),
      posting_date    = coalesce((f->>'posting_date')::date, posting_date),
      closing_date    = coalesce((f->>'closing_date')::date, closing_date),
      revision        = revision + 1,
      -- A published or approved post keeps its public version; the edit waits for review.
      status          = case when status in ('rejected','approved') then 'draft' else status end,
      -- Only a live (or paused) version needs a separate review queue entry; other
      -- edits fall back to draft or stay in review at the new revision.
      has_unreviewed_changes = status in ('published','paused'),
      publish_state   = null,
      updated_at      = now()
    where id = p.id returning * into p;
    perform public.employer_audit_log(u, 'employer', p_org, 'post', p.id::text, 'edited', jsonb_build_object('revision', p.revision));
  end if;
  return jsonb_build_object('id', p.id, 'status', p.status, 'revision', p.revision);
end $$;

create or replace function public.employer_submit_post(p_post uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); p employer_posts;
begin
  select * into p from employer_posts where id = p_post for update;
  if not found or not public.employer_is_member(p.org_id, u) then raise exception 'post_not_found'; end if;
  if p.status = 'draft' then
    update employer_posts set status = 'pending_review', updated_at = now() where id = p.id returning * into p;
  elsif p.has_unreviewed_changes then
    null;   -- already queued for review; the live version is unchanged
  else
    raise exception 'nothing_to_submit';
  end if;
  perform public.employer_audit_log(u, 'employer', p.org_id, 'post', p.id::text, 'submitted', jsonb_build_object('revision', p.revision));
  return jsonb_build_object('id', p.id, 'status', p.status);
end $$;

-- Publish (or re-publish) a post whose CURRENT revision an operator approved.
-- One transaction under the org lock; the quota is checked here and only here.
create or replace function public.employer_publish_post_internal(p_post uuid, p_actor uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p employer_posts; o employer_orgs; lim int; act int; jid bigint; org_name text; exp timestamptz;
begin
  select * into p from employer_posts where id = p_post;
  if not found then raise exception 'post_not_found'; end if;
  o := public.employer_lock_org(p.org_id);
  select * into p from employer_posts where id = p_post for update;
  if p.reviewed_revision is distinct from p.revision or p.status not in ('approved','paused','published','closed') then
    raise exception 'revision_not_approved';
  end if;
  if o.status <> 'verified' then
    update employer_posts set publish_state = 'org_not_verified' where id = p.id;
    return jsonb_build_object('id', p.id, 'published', false, 'state', 'org_not_verified');
  end if;
  exp := (p.closing_date + 1)::timestamptz;
  if exp <= now() then
    update employer_posts set publish_state = 'expired' where id = p.id;
    return jsonb_build_object('id', p.id, 'published', false, 'state', 'expired');
  end if;

  -- An already-live post being updated does not take another slot.
  if not (p.published_job_id is not null and exists (
            select 1 from pre_scraped_jobs where id = p.published_job_id and closed_at is null and (expires_at is null or expires_at > now()))) then
    lim := public.employer_active_limit(o.id);
    act := public.employer_active_count(o.id);
    if act >= lim then
      update employer_posts set publish_state = 'upgrade_required', status = case when status = 'published' then 'paused' else status end
       where id = p.id;
      perform public.employer_audit_log(p_actor, p_kind, o.id, 'post', p.id::text, 'publish_blocked_quota',
        jsonb_build_object('active', act, 'limit', lim));
      return jsonb_build_object('id', p.id, 'published', false, 'state', 'upgrade_required', 'active', act, 'limit', lim);
    end if;
  end if;

  -- Never take over another source's listing that shares the URL.
  if exists (select 1 from pre_scraped_jobs j where j.apply_url = p.apply_url
              and j.id is distinct from p.published_job_id) then
    update employer_posts set publish_state = 'apply_url_already_listed' where id = p.id;
    return jsonb_build_object('id', p.id, 'published', false, 'state', 'apply_url_already_listed');
  end if;

  org_name := o.name;
  if p.published_job_id is null then
    insert into pre_scraped_jobs (source, source_listing_id, category, canonical_role, job_title, company, location,
        state_code, country, apply_url, source_url, job_description, employment_type, work_mode, is_remote,
        posted_at, fetched_at, last_seen_at, scraped_at, attribution, search_text,
        employer_org_id, employer_post_id, expires_at)
    values ('employer_direct', p.id::text, (select name from ingest_roles where id = p.canonical_role), p.canonical_role,
        p.job_title, org_name, p.city || ', ' || p.state_code, p.state_code, 'us', p.apply_url, p.apply_url,
        p.description, p.employment_type, p.work_mode, p.work_mode = 'remote',
        p.posting_date::timestamptz, now(), now(), now(), null,
        lower(p.job_title || ' ' || org_name || ' ' || p.city || ', ' || p.state_code),
        o.id, p.id, exp)
    returning id into jid;
  else
    update pre_scraped_jobs set
        category = (select name from ingest_roles where id = p.canonical_role), canonical_role = p.canonical_role,
        job_title = p.job_title, company = org_name, location = p.city || ', ' || p.state_code, state_code = p.state_code,
        apply_url = p.apply_url, source_url = p.apply_url, job_description = p.description,
        employment_type = p.employment_type, work_mode = p.work_mode, is_remote = p.work_mode = 'remote',
        posted_at = p.posting_date::timestamptz, last_seen_at = now(), scraped_at = now(), closed_at = null,
        expires_at = exp,
        search_text = lower(p.job_title || ' ' || org_name || ' ' || p.city || ', ' || p.state_code)
     where id = p.published_job_id and employer_post_id = p.id and source = 'employer_direct'
     returning id into jid;
    if jid is null then raise exception 'published_row_mismatch'; end if;
  end if;
  update employer_posts set status = 'published', published_job_id = jid, publish_state = null,
                            has_unreviewed_changes = false, updated_at = now() where id = p.id;
  perform public.employer_audit_log(p_actor, p_kind, o.id, 'post', p.id::text, 'published',
    jsonb_build_object('job_id', jid, 'revision', p.revision));
  return jsonb_build_object('id', p.id, 'published', true, 'job_id', jid);
end $$;

-- Employer re-activation of an operator-approved, unchanged post (after a close
-- or a quota block). Unreviewed content can never be published this way.
create or replace function public.employer_activate_post(p_post uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); p employer_posts;
begin
  select * into p from employer_posts where id = p_post;
  if not found or not public.employer_is_member(p.org_id, u) then raise exception 'post_not_found'; end if;
  if p.has_unreviewed_changes or p.reviewed_revision is distinct from p.revision then raise exception 'review_required'; end if;
  return public.employer_publish_post_internal(p_post, u, 'employer');
end $$;

create or replace function public.employer_close_post(p_post uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); p employer_posts;
begin
  select * into p from employer_posts where id = p_post;
  if not found or not public.employer_is_member(p.org_id, u) then raise exception 'post_not_found'; end if;
  perform public.employer_lock_org(p.org_id);
  update pre_scraped_jobs set closed_at = now()
   where id = p.published_job_id and employer_post_id = p.id and closed_at is null;
  update employer_posts set status = case when status in ('draft','pending_review','rejected') then status else 'closed' end,
                            publish_state = null, updated_at = now() where id = p.id returning * into p;
  perform public.employer_audit_log(u, 'employer', p.org_id, 'post', p.id::text, 'closed');
  return jsonb_build_object('id', p.id, 'status', p.status);
end $$;

-- Which posts to keep if the plan later drops to the free allowance.
create or replace function public.employer_set_keep_on_downgrade(p_post uuid, p_keep boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); p employer_posts;
begin
  select * into p from employer_posts where id = p_post;
  if not found or not public.employer_is_member(p.org_id, u) then raise exception 'post_not_found'; end if;
  update employer_posts set keep_on_downgrade = p_keep, updated_at = now() where id = p.id;
end $$;

-- ── employer: feed sources ───────────────────────────────────────────────────
create or replace function public.employer_submit_source(p_org uuid, p_adapter text, p_region text, p_board_token text,
  p_requested_hosts text[], p_grants jsonb, p_wording_version text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); s employer_sources; h text; hosts text[] := '{}';
begin
  if not public.employer_is_member(p_org, u) then raise exception 'not_a_member' using errcode = '42501'; end if;
  if coalesce((p_grants->>'display')::boolean, false) is not true or coalesce((p_grants->>'refresh')::boolean, false) is not true then
    raise exception 'display_and_refresh_permission_required';
  end if;
  foreach h in array coalesce(p_requested_hosts, '{}') loop
    h := lower(btrim(h));
    if not public.employer_valid_host(h) then raise exception 'invalid_host'; end if;
    hosts := array_append(hosts, h);
  end loop;
  if cardinality(hosts) > 8 then raise exception 'too_many_hosts'; end if;
  insert into employer_sources (org_id, adapter, api_region, board_token, employer_name, requested_apply_hosts, submitted_by)
  values (p_org, p_adapter, coalesce(p_region, 'global'), lower(btrim(p_board_token)),
          (select name from employer_orgs where id = p_org), hosts, u)
  returning * into s;
  insert into employer_source_evidence (source_id, kind, attested_by, wording_version, grants)
  values (s.id, 'employer_attestation', u, left(p_wording_version, 40),
          jsonb_build_object('display', true, 'refresh', true,
                             'description', coalesce((p_grants->>'description')::boolean, false)));
  perform public.employer_audit_log(u, 'employer', p_org, 'source', s.id, 'submitted',
    jsonb_build_object('adapter', s.adapter, 'board_token', s.board_token));
  return jsonb_build_object('id', s.id, 'status', s.status);
exception when unique_violation then
  raise exception 'board_already_registered';
end $$;

create or replace function public.employer_select_feed_jobs(p_source text, p_ids text[], p_selected boolean)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); org uuid; n int;
begin
  select org_id into org from employer_sources where id = p_source;
  if org is null or not public.employer_is_member(org, u) then raise exception 'source_not_found'; end if;
  update employer_feed_candidates set selected = p_selected, selected_by = u, selected_at = now()
   where source_id = p_source and provider_post_id = any(p_ids);
  get diagnostics n = row_count;
  perform public.employer_audit_log(u, 'employer', org, 'source', p_source, case when p_selected then 'selected' else 'deselected' end,
    jsonb_build_object('count', n));
  return n;
end $$;

create or replace function public.employer_list_feed_candidates(p_source text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller(); org uuid;
begin
  select org_id into org from employer_sources where id = p_source;
  if org is null or not public.employer_is_member(org, u) then raise exception 'source_not_found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('provider_post_id', provider_post_id, 'selected', selected,
      'job_title', payload->>'job_title', 'location', payload->>'location', 'state_code', payload->>'state_code')
      order by provider_post_id) from employer_feed_candidates where source_id = p_source), '[]'::jsonb);
end $$;

-- ── operator ─────────────────────────────────────────────────────────────────
create or replace function public.operator_queue()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_require_operator(null);
begin
  return jsonb_build_object(
    'orgs', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'domain', o.primary_domain,
        'status', o.status, 'domain_verified', o.domain_verified_at is not null, 'created_at', o.created_at))
        from employer_orgs o where o.status = 'pending' and not public.employer_is_member(o.id, u)), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'org', o.name, 'org_status', o.status,
        'job_title', p.job_title, 'apply_url', p.apply_url, 'revision', p.revision, 'status', p.status,
        'changes', p.has_unreviewed_changes))
        from employer_posts p join employer_orgs o on o.id = p.org_id
        where (p.status = 'pending_review' or p.has_unreviewed_changes) and not public.employer_is_member(o.id, u)), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'org', o.name, 'adapter', s.adapter,
        'board_token', s.board_token, 'requested_apply_hosts', s.requested_apply_hosts))
        from employer_sources s join employer_orgs o on o.id = s.org_id
        where s.status = 'pending' and not public.employer_is_member(o.id, u)), '[]'::jsonb));
end $$;

create or replace function public.operator_set_org_status(p_org uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_require_operator(p_org); o employer_orgs;
begin
  if p_status not in ('verified','rejected','suspended') then raise exception 'invalid_status'; end if;
  o := public.employer_lock_org(p_org);
  if p_status = 'verified' and o.domain_verified_at is null then raise exception 'domain_not_verified'; end if;
  update employer_orgs set status = p_status, verified_by = case when p_status = 'verified' then u else verified_by end,
         verified_at = case when p_status = 'verified' then now() else verified_at end, updated_at = now()
   where id = p_org;
  if p_status in ('rejected','suspended') then
    update pre_scraped_jobs set closed_at = now() where employer_org_id = p_org and closed_at is null;
    update employer_sources set enabled = false, status = case when status = 'approved' then 'revoked' else status end,
           revision = revision + 1, updated_at = now() where org_id = p_org and status in ('approved','pending');
  end if;
  perform public.employer_audit_log(u, 'operator', p_org, 'org', p_org::text, 'status_' || p_status, jsonb_build_object('note', left(p_note, 500)));
end $$;

-- Manual domain verification, when DNS cannot be used (operator records how).
create or replace function public.operator_verify_domain(p_org uuid, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_require_operator(p_org);
begin
  if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  update employer_orgs set domain_verified_at = now(), domain_verify_method = 'operator_manual', updated_at = now() where id = p_org;
  perform public.employer_audit_log(u, 'operator', p_org, 'org', p_org::text, 'domain_verified_manual', jsonb_build_object('note', left(p_note, 500)));
end $$;

create or replace function public.operator_review_post(p_post uuid, p_revision integer, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p employer_posts; u uuid;
begin
  select * into p from employer_posts where id = p_post;
  if not found then raise exception 'post_not_found'; end if;
  u := public.employer_require_operator(p.org_id);
  select * into p from employer_posts where id = p_post for update;
  -- Approval binds to the exact revision the operator looked at.
  if p.revision <> p_revision then raise exception 'revision_changed'; end if;
  if not (p.status = 'pending_review' or p.has_unreviewed_changes) then raise exception 'not_awaiting_review'; end if;
  if p_decision = 'approve' then
    update employer_posts set reviewed_revision = p.revision, reviewed_by = u, reviewed_at = now(),
           review_note = left(p_note, 500),
           status = case when status in ('pending_review','draft') then 'approved' else status end
     where id = p.id;
    perform public.employer_audit_log(u, 'operator', p.org_id, 'post', p.id::text, 'approved', jsonb_build_object('revision', p.revision));
    -- Operator approval publishes (or updates the live version) under the quota.
    return public.employer_publish_post_internal(p.id, u, 'operator');
  elsif p_decision = 'reject' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'reason_required'; end if;
    update employer_posts set status = case when published_job_id is null then 'rejected' else status end,
           has_unreviewed_changes = false, review_note = left(p_note, 500), reviewed_by = u, reviewed_at = now()
     where id = p.id;
    perform public.employer_audit_log(u, 'operator', p.org_id, 'post', p.id::text, 'rejected', jsonb_build_object('revision', p.revision, 'note', left(p_note, 500)));
    return jsonb_build_object('id', p.id, 'rejected', true);
  end if;
  raise exception 'invalid_decision';
end $$;

create or replace function public.operator_close_post(p_post uuid, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p employer_posts; u uuid;
begin
  select * into p from employer_posts where id = p_post;
  if not found then raise exception 'post_not_found'; end if;
  u := public.employer_require_operator(p.org_id);
  update pre_scraped_jobs set closed_at = now() where id = p.published_job_id and employer_post_id = p.id and closed_at is null;
  update employer_posts set status = 'closed', review_note = left(p_note, 500), updated_at = now() where id = p.id;
  perform public.employer_audit_log(u, 'operator', p.org_id, 'post', p.id::text, 'closed_by_operator', jsonb_build_object('note', left(p_note, 500)));
end $$;

create or replace function public.operator_review_source(p_source text, p_revision integer, p_decision text,
  p_allowed_hosts text[], p_attribution text, p_allow_description boolean, p_expires_at timestamptz,
  p_permission_ref text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s employer_sources; u uuid; h text; hosts text[] := '{}';
begin
  select * into s from employer_sources where id = p_source;
  if not found then raise exception 'source_not_found'; end if;
  u := public.employer_require_operator(s.org_id);
  select * into s from employer_sources where id = p_source for update;
  if s.revision <> p_revision then raise exception 'revision_changed'; end if;
  if p_decision = 'approve' then
    if s.status <> 'pending' then raise exception 'not_pending'; end if;
    if (select status from employer_orgs where id = s.org_id) <> 'verified' then raise exception 'organization_not_verified'; end if;
    foreach h in array coalesce(p_allowed_hosts, '{}') loop
      h := lower(btrim(h));
      if not public.employer_valid_host(h) then raise exception 'invalid_host'; end if;
      hosts := array_append(hosts, h);
    end loop;
    if cardinality(hosts) not between 1 and 8 then raise exception 'hosts_required'; end if;
    if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '400 days' then raise exception 'invalid_expiry'; end if;
    if coalesce(btrim(p_permission_ref), '') = '' then raise exception 'permission_ref_required'; end if;
    if p_allow_description and not coalesce((select bool_or((grants->>'description')::boolean) from employer_source_evidence
                                              where source_id = s.id and kind = 'employer_attestation'), false) then
      raise exception 'description_not_permitted_by_employer';
    end if;
    update employer_sources set status = 'approved', enabled = true, rights_basis = 'employer_written_permission',
           permission_ref = btrim(p_permission_ref), approved_by = u, approved_at = now(),
           authorization_expires_at = p_expires_at, allow_display = true, allow_refresh = true,
           allow_description = coalesce(p_allow_description, false), allowed_apply_hosts = hosts,
           attribution_text = coalesce(p_attribution, ''), revision = revision + 1, updated_at = now()
     where id = s.id returning * into s;
  elsif p_decision = 'reject' then
    update employer_sources set status = 'rejected', enabled = false, revision = revision + 1, updated_at = now()
     where id = s.id returning * into s;
  else raise exception 'invalid_decision'; end if;
  insert into employer_source_evidence (source_id, kind, attested_by, note)
  values (s.id, 'operator_note', u, left(p_note, 2000));
  perform public.employer_audit_log(u, 'operator', s.org_id, 'source', s.id, p_decision || 'd',
    jsonb_build_object('revision', s.revision, 'hosts', s.allowed_apply_hosts));
  return jsonb_build_object('id', s.id, 'status', s.status, 'revision', s.revision);
end $$;

-- Revocation stops the worker (status/enabled/revision) and hides every row from
-- the source in the same transaction.
create or replace function public.operator_revoke_source(p_source text, p_note text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare s employer_sources; u uuid; n int;
begin
  select * into s from employer_sources where id = p_source;
  if not found then raise exception 'source_not_found'; end if;
  u := public.employer_require_operator(s.org_id);
  perform public.employer_lock_org(s.org_id);
  update employer_sources set status = 'revoked', enabled = false, revision = revision + 1, updated_at = now() where id = s.id;
  update pre_scraped_jobs set closed_at = now() where employer_source_id = s.id and closed_at is null;
  get diagnostics n = row_count;
  perform public.employer_audit_log(u, 'operator', s.org_id, 'source', s.id, 'revoked', jsonb_build_object('closed', n, 'note', left(p_note, 500)));
  return n;
end $$;

-- ── service (edge function / Codex worker) ───────────────────────────────────
-- DNS proof: called by the employer-submissions edge function after it resolved
-- the TXT record itself. The token must match the stored challenge.
create or replace function public.employer_mark_domain_verified(p_org uuid, p_token text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update employer_domain_challenges set checked_at = now(),
         last_result = case when token = p_token then 'match' else 'mismatch' end where org_id = p_org;
  if not exists (select 1 from employer_domain_challenges where org_id = p_org and token = p_token) then return false; end if;
  update employer_orgs set domain_verified_at = coalesce(domain_verified_at, now()), domain_verify_method = 'dns_txt', updated_at = now()
   where id = p_org and status in ('pending','verified');
  perform public.employer_audit_log(null, 'service', p_org, 'org', p_org::text, 'domain_verified_dns');
  return true;
end $$;

-- The registry record in contract-v1 shape, for collectEmployerFeed's
-- loadSource port. Returns null unless the source is currently publishable.
create or replace function public.employer_source_for_worker(p_source text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('source', jsonb_build_object(
      'id', s.id, 'adapter', s.adapter, 'api_region', s.api_region, 'board_token', s.board_token,
      'employer_name', s.employer_name, 'status', s.status, 'enabled', s.enabled, 'rights_basis', s.rights_basis,
      'permission_ref', s.permission_ref, 'approved_by', s.approved_by::text,
      'approved_at', to_char(s.approved_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'domain_verified_at', to_char(o.domain_verified_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'authorization_expires_at', to_char(s.authorization_expires_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'allow_display', s.allow_display, 'allow_refresh', s.allow_refresh, 'allow_description', s.allow_description,
      'allowed_apply_hosts', to_jsonb(s.allowed_apply_hosts), 'attribution_text', s.attribution_text),
    'revision', s.revision)
  from employer_sources s join employer_orgs o on o.id = s.org_id
  where s.id = p_source and s.status = 'approved' and s.enabled and o.status = 'verified'
    and o.domain_verified_at is not null and s.authorization_expires_at > now();
$$;

-- Stage normalised feed rows privately for the employer to choose from.
create or replace function public.employer_stage_feed_candidates(p_source text, p_revision integer, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare s employer_sources; r jsonb; n int := 0; pid text;
begin
  select * into s from employer_sources where id = p_source;
  if not found or s.revision <> p_revision or public.employer_source_for_worker(p_source) is null then
    raise exception 'source_not_publishable';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'invalid_rows'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    pid := split_part(r->>'source_listing_id', ':', 2);
    if r->>'source_listing_id' <> s.id || ':' || pid then raise exception 'listing_not_from_source'; end if;
    insert into employer_feed_candidates (source_id, provider_post_id, revision, payload)
    values (s.id, pid, p_revision, r)
    on conflict (source_id, provider_post_id) do update set payload = excluded.payload, revision = excluded.revision, staged_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- Publish SELECTED staged feed postings for one source, under the same org lock
-- and quota as direct posts. Re-checks source approval and revision inside the
-- transaction (an approval may be revoked while a fetch is in flight).
create or replace function public.employer_publish_feed_jobs(p_source text, p_revision integer, p_provider_ids text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s employer_sources; o employer_orgs; c record; lim int; act int; jid bigint;
        published int := 0; updated int := 0; blocked int := 0; skipped jsonb := '[]'::jsonb; host text; exp timestamptz;
begin
  select * into s from employer_sources where id = p_source;
  if not found then raise exception 'source_not_found'; end if;
  o := public.employer_lock_org(s.org_id);
  select * into s from employer_sources where id = p_source for update;
  if s.revision <> p_revision or public.employer_source_for_worker(p_source) is null then
    raise exception 'source_not_publishable';
  end if;
  lim := public.employer_active_limit(o.id);
  for c in select * from employer_feed_candidates
            where source_id = s.id and provider_post_id = any(p_provider_ids) order by provider_post_id loop
    if not c.selected then skipped := skipped || jsonb_build_object('id', c.provider_post_id, 'reason', 'not_selected'); continue; end if;
    host := public.employer_url_host(c.payload->>'apply_url');
    if host is null or not host = any(s.allowed_apply_hosts) then
      skipped := skipped || jsonb_build_object('id', c.provider_post_id, 'reason', 'apply_host_not_allowed'); continue;
    end if;
    if not exists (select 1 from ingest_regions where code = c.payload->>'state_code')
       or not exists (select 1 from ingest_roles where id = c.payload->>'canonical_role') then
      skipped := skipped || jsonb_build_object('id', c.provider_post_id, 'reason', 'unknown_role_or_state'); continue;
    end if;
    exp := s.authorization_expires_at;
    select id into jid from pre_scraped_jobs where source = 'employer_feed' and source_listing_id = s.id || ':' || c.provider_post_id;
    if jid is not null then
      if exists (select 1 from pre_scraped_jobs where id = jid and closed_at is null) then
        update pre_scraped_jobs set job_title = c.payload->>'job_title', location = c.payload->>'location',
               state_code = c.payload->>'state_code', canonical_role = c.payload->>'canonical_role',
               job_description = case when s.allow_description then c.payload->>'job_description' end,
               last_seen_at = now(), expires_at = exp where id = jid and employer_source_id = s.id;
        updated := updated + 1; continue;
      end if;
    end if;
    if exists (select 1 from pre_scraped_jobs where apply_url = c.payload->>'apply_url' and id is distinct from jid) then
      skipped := skipped || jsonb_build_object('id', c.provider_post_id, 'reason', 'apply_url_already_listed'); continue;
    end if;
    act := public.employer_active_count(o.id);
    if act >= lim then blocked := blocked + 1; continue; end if;
    if jid is null then
      insert into pre_scraped_jobs (source, source_listing_id, category, canonical_role, job_title, company, location,
          state_code, country, apply_url, source_url, job_description, employment_type, work_mode, is_remote,
          posted_at, fetched_at, last_seen_at, scraped_at, attribution, search_text,
          employer_org_id, employer_source_id, expires_at)
      values ('employer_feed', s.id || ':' || c.provider_post_id,
          (select name from ingest_roles where id = c.payload->>'canonical_role'), c.payload->>'canonical_role',
          c.payload->>'job_title', s.employer_name, c.payload->>'location', c.payload->>'state_code', 'us',
          c.payload->>'apply_url', c.payload->>'apply_url',
          case when s.allow_description then c.payload->>'job_description' end,
          c.payload->>'employment_type', c.payload->>'work_mode', coalesce((c.payload->>'is_remote')::boolean, false),
          nullif(c.payload->>'posted_at', '')::timestamptz, now(), now(), now(), nullif(s.attribution_text, ''),
          lower(coalesce(c.payload->>'job_title', '') || ' ' || s.employer_name || ' ' || coalesce(c.payload->>'location', '')),
          o.id, s.id, exp);
    else
      update pre_scraped_jobs set closed_at = null, last_seen_at = now(), expires_at = exp where id = jid and employer_source_id = s.id;
    end if;
    published := published + 1;
  end loop;
  perform public.employer_audit_log(null, 'service', o.id, 'source', s.id, 'feed_published',
    jsonb_build_object('published', published, 'updated', updated, 'blocked_quota', blocked, 'skipped', jsonb_array_length(skipped)));
  return jsonb_build_object('published', published, 'updated', updated, 'blocked_quota', blocked,
    'state', case when blocked > 0 then 'upgrade_required' end, 'limit', lim, 'skipped', skipped);
end $$;

-- Close feed postings of ONE source. The caller must have a complete,
-- source-scoped enumeration; this function never closes other sources' rows.
create or replace function public.employer_close_feed_jobs(p_source text, p_revision integer, p_provider_ids text[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare s employer_sources; n int;
begin
  select * into s from employer_sources where id = p_source;
  if not found or s.revision <> p_revision then raise exception 'source_revision_mismatch'; end if;
  perform public.employer_lock_org(s.org_id);
  update pre_scraped_jobs set closed_at = now()
   where source = 'employer_feed' and employer_source_id = s.id and closed_at is null
     and source_listing_id = any(select s.id || ':' || x from unnest(p_provider_ids) x);
  get diagnostics n = row_count;
  perform public.employer_audit_log(null, 'service', s.org_id, 'source', s.id, 'feed_closed', jsonb_build_object('closed', n));
  return n;
end $$;

-- Downgrade to the free allowance. NOT scheduled: notice timing and the
-- no-selection fallback are open decisions. It only acts when the employer has
-- marked enough posts to keep; otherwise it changes nothing and says so.
-- Excess posts are paused (recoverable), never deleted.
create or replace function public.employer_apply_downgrade(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o employer_orgs; lim int; act int; kept int; n int;
begin
  o := public.employer_lock_org(p_org);
  lim := public.employer_active_limit(p_org);
  act := public.employer_active_count(p_org);
  if act <= lim then return jsonb_build_object('state', 'within_limit', 'active', act, 'limit', lim); end if;
  select count(*) into kept from employer_posts p join pre_scraped_jobs j on j.id = p.published_job_id
   where p.org_id = p_org and p.keep_on_downgrade and j.closed_at is null and (j.expires_at is null or j.expires_at > now());
  if kept + (select count(*) from pre_scraped_jobs where employer_org_id = p_org and employer_source_id is not null
              and closed_at is null and (expires_at is null or expires_at > now())) > lim or kept = 0 then
    return jsonb_build_object('state', 'selection_required', 'active', act, 'limit', lim, 'kept', kept);
  end if;
  with paused as (
    update pre_scraped_jobs j set closed_at = now()
      from employer_posts p
     where p.published_job_id = j.id and p.org_id = p_org and not p.keep_on_downgrade and j.closed_at is null
     returning p.id)
  update employer_posts set status = 'paused', publish_state = 'upgrade_required' where id in (select id from paused);
  get diagnostics n = row_count;
  perform public.employer_audit_log(null, 'system', p_org, 'org', p_org::text, 'downgrade_paused', jsonb_build_object('paused', n));
  return jsonb_build_object('state', 'paused_excess', 'paused', n, 'limit', lim);
end $$;

-- ── public visibility (replaces the catalogue read policy) ───────────────────
alter policy "public can read pre-scraped jobs" on public.pre_scraped_jobs
  using (closed_at is null
         and (expires_at is null or expires_at > now())
         and (employer_org_id is null or public.employer_listing_visible(employer_org_id, employer_source_id)));

-- ── execute grants ───────────────────────────────────────────────────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and (p.proname like 'employer\_%' or p.proname like 'operator\_%') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- Signed-in callers (checked inside each function).
grant execute on function
  public.employer_register_org(text, text),
  public.employer_my_state(),
  public.employer_save_post(uuid, uuid, jsonb),
  public.employer_submit_post(uuid),
  public.employer_activate_post(uuid),
  public.employer_close_post(uuid),
  public.employer_set_keep_on_downgrade(uuid, boolean),
  public.employer_submit_source(uuid, text, text, text, text[], jsonb, text),
  public.employer_select_feed_jobs(text, text[], boolean),
  public.employer_list_feed_candidates(text),
  public.operator_queue(),
  public.operator_set_org_status(uuid, text, text),
  public.operator_verify_domain(uuid, text),
  public.operator_review_post(uuid, integer, text, text),
  public.operator_close_post(uuid, text),
  public.operator_review_source(text, integer, text, text[], text, boolean, timestamptz, text, text),
  public.operator_revoke_source(text, text)
to authenticated;

-- The catalogue policy calls this for every anon/authenticated read.
grant execute on function public.employer_listing_visible(uuid, text) to anon, authenticated;
