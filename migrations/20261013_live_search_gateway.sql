-- Live Search admission gateway state. Applied to production 2026-10-13.
-- Mirrors what was deployed via the Supabase migration tool, kept here for review
-- and rollback reference. These tables are written only by the gateway Edge
-- Function running as service_role; anon and authenticated receive no grants, so
-- no existing permission is weakened.
--
-- Rollback note: dropping these tables removes admission control entirely and
-- re-exposes Live Search to unbounded public calls. Pause via
-- `update live_search_limits set paused = true` instead.

create table if not exists public.live_search_admissions (
  id              bigint generated always as identity primary key,
  search_id       text not null unique,
  client_hash     text not null,            -- salted hash of caller IP, never the raw IP
  account_id      uuid,
  query_text      text not null,
  status          text not null default 'in_flight'
                   check (status in ('in_flight','dispatched','completed','failed','expired')),
  admitted_at     timestamptz not null default now(),
  dispatched_at   timestamptz,
  settled_at      timestamptz,
  slot_expires_at timestamptz not null,     -- frees the slot even if nothing reports back
  outcome         text
);

create index if not exists live_search_admissions_live_idx
  on public.live_search_admissions (status, slot_expires_at);
create index if not exists live_search_admissions_client_idx
  on public.live_search_admissions (client_hash, admitted_at desc);
create index if not exists live_search_admissions_admitted_idx
  on public.live_search_admissions (admitted_at desc);

create table if not exists public.live_search_limits (
  id                    boolean primary key default true check (id),
  max_concurrent        integer not null default 3,
  per_client_per_minute integer not null default 2,
  per_client_per_hour   integer not null default 10,
  per_client_per_day    integer not null default 25,
  global_per_hour       integer not null default 60,
  global_per_day        integer not null default 150,
  slot_seconds          integer not null default 45,
  queue_wait_ms         integer not null default 6000,
  max_query_chars       integer not null default 120,
  paused                boolean not null default false,
  updated_at            timestamptz not null default now()
);
insert into public.live_search_limits (id) values (true) on conflict (id) do nothing;

alter table public.live_search_admissions enable row level security;
alter table public.live_search_limits     enable row level security;
revoke all on public.live_search_admissions from anon, authenticated;
revoke all on public.live_search_limits     from anon, authenticated;

-- See migration 20261013_live_search_admission_function for
-- live_search_try_admit() and live_search_settle(), which hold the atomic
-- admission decision and the slot release.
