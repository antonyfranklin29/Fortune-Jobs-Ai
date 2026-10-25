-- The Make completion-signal contract, run as service_role (the role Make writes with) on a
-- DISPOSABLE database prepared by tests/live-search-signals-db.mjs. Rolled back.
-- Phase 1 runs against the production schema; phase 2 adds the pending normalizer.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
begin;
create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', msg; end if; end $$;
create function pg_temp.admit(id text) returns void language sql as $$
  insert into public.live_search_admissions (search_id, client_hash, query_text, status, slot_expires_at)
  values (id, 'h', 'data analyst', 'dispatched', now() + interval '5 minutes') $$;
create function pg_temp.state(id text) returns text language sql as $$
  select (public.live_search_status(id))->>'state' $$;
create function pg_temp.marker(id text, meta jsonb) returns void language sql as $$
  insert into public.job_matches (job_title, company, location, match_reason, match_score, search_id, source_metadata)
  values ('No matching jobs found', 'N/A', 'N/A', 'Search complete', 0, id, meta) $$;
grant execute on all functions in schema pg_temp to service_role;
select set_config('request.jwt.claim.role', 'service_role', false);

-- ── phase 1: production schema ───────────────────────────────────────────────
select pg_temp.admit(x) from unnest(array['s_p1_obj_ok','s_p1_str_ok','s_p1_obj_fail','s_p1_none','s_p1_rows']) x;
set role service_role;
select pg_temp.marker('s_p1_obj_ok', '{"signal":"success"}');
select pg_temp.marker('s_p1_str_ok', to_jsonb('{"signal":"success"}'::text));
select pg_temp.marker('s_p1_obj_fail', '{"signal":"failure","stage":"apify"}');
select pg_temp.marker('s_p1_none', null);
insert into public.job_matches (job_title, company, location, match_reason, match_score, search_id, source_metadata)
  values ('Data Analyst', 'Acme', 'Trenton, NJ', 'Role match', 90, 's_p1_rows', to_jsonb('{"id":"x"}'::text));
reset role;
select pg_temp.ok(pg_temp.state('s_p1_rows') = 'pending', 'a job row alone keeps the search pending');
set role service_role;
select pg_temp.marker('s_p1_rows', '{"signal":"success"}');
reset role;
select pg_temp.ok(pg_temp.state('s_p1_obj_ok') = 'empty', 'a success object on the marker reads as a confirmed empty search');
select pg_temp.ok(pg_temp.state('s_p1_str_ok') = 'indeterminate', 'a string-encoded success is NOT read as success (the hazard)');
select pg_temp.ok(pg_temp.state('s_p1_obj_fail') = 'failed', 'a failure object reads as failed');
select pg_temp.ok((select outcome from public.live_search_admissions where search_id = 's_p1_obj_fail') like 'failure:apify:%', 'the failing stage is recorded');
select pg_temp.ok(pg_temp.state('s_p1_none') = 'indeterminate', 'an unsigned marker stays indeterminate');
select pg_temp.ok(pg_temp.state('s_p1_rows') = 'complete', 'results then a success marker read as complete');

-- If Make ever wrote both markers for one search, failure must win and stay won.
-- (The Make error handler is built so this does not happen; this is the backstop.)
select pg_temp.admit('s_p1_fail_then_ok');
set role service_role;
select pg_temp.marker('s_p1_fail_then_ok', '{"signal":"failure","stage":"apify"}');
select pg_temp.marker('s_p1_fail_then_ok', '{"signal":"success"}');
reset role;
select pg_temp.ok(pg_temp.state('s_p1_fail_then_ok') = 'failed', 'a success marker after a failure does not overturn it');
select pg_temp.ok((select outcome from public.live_search_admissions where search_id = 's_p1_fail_then_ok') not like '%success%',
  'the late success marker is not recorded on the settled admission');

-- ── phase 2: with the pending normalizer ─────────────────────────────────────
\i migrations/pending/20261027_live_search_marker_signal_normalize.sql
select pg_temp.admit(x) from unnest(array['s_p2_str_ok','s_p2_str_fail','s_p2_str_junk','s_p2_str_other','s_p2_rows']) x;
set role service_role;
select pg_temp.marker('s_p2_str_ok', to_jsonb('{"signal":"success"}'::text));
select pg_temp.marker('s_p2_str_fail', to_jsonb('{"signal":"failure","stage":"apify"}'::text));
select pg_temp.marker('s_p2_str_junk', to_jsonb('not json'::text));
select pg_temp.marker('s_p2_str_other', to_jsonb('{"signal":"maybe"}'::text));
insert into public.job_matches (job_title, company, location, match_reason, match_score, search_id, source_metadata)
  values ('Data Analyst', 'Acme', 'Trenton, NJ', 'Role match', 90, 's_p2_rows', to_jsonb('{"signal":"success"}'::text));
reset role;
select pg_temp.ok(pg_temp.state('s_p2_str_ok') = 'empty', 'normalizer: a string-encoded success becomes a confirmed empty search');
select pg_temp.ok(pg_temp.state('s_p2_str_fail') = 'failed', 'normalizer: a string-encoded failure becomes failed');
select pg_temp.ok(pg_temp.state('s_p2_str_junk') = 'indeterminate', 'normalizer: text that is not JSON is left alone');
select pg_temp.ok(pg_temp.state('s_p2_str_other') = 'indeterminate', 'normalizer: an unknown signal is not invented into success');
select pg_temp.ok((select jsonb_typeof(source_metadata) from public.job_matches where search_id = 's_p2_str_ok') = 'object', 'the stored marker metadata is an object the page can read');
select pg_temp.ok((select jsonb_typeof(source_metadata) from public.job_matches where search_id = 's_p2_rows') = 'string', 'job rows are stored exactly as Make sent them');
select pg_temp.ok(pg_temp.state('s_p2_rows') = 'pending', 'a job row never settles a search, even with signal-like text');

\echo PASS: live search completion signals
rollback;
