// Live Search v2 bulk insert (Make module 43: one POST /rest/v1/job_matches with a JSON array)
// against the production trigger contract, on an in-process PGlite database. No network.
//
// PostgREST turns a JSON-array POST into ONE statement of the form
//   insert into job_matches (<cols>) select <cols> from json_populate_recordset(null::job_matches, $body)
// so the database-side behaviour is reproduced here exactly. The triggers are copied from
// production (pg_get_functiondef, read-only, 2026-11-01).
//
//   node --test tests/live-search-bulk-insert-db.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const SCHEMA = `
create table live_search_admissions (search_id text primary key, status text not null,
  settled_at timestamptz, outcome text, slot_expires_at timestamptz default now() + interval '5 minutes');
create table job_matches (id bigserial primary key, created_at timestamptz default now(), job_title text,
  company text, location text, salary text, apply_url text, match_reason text, match_score integer,
  search_id text, source_metadata jsonb);

create function live_search_normalize_marker_signal() returns trigger language plpgsql as $f$
declare v jsonb;
begin
  if new.source_metadata is null or jsonb_typeof(new.source_metadata) <> 'string' then return new; end if;
  if not (new.job_title = 'No matching jobs found' and new.match_reason = 'Search complete'
      and coalesce(new.match_score, -1) = 0) then return new; end if;
  begin v := (new.source_metadata #>> '{}')::jsonb; exception when others then return new; end;
  if jsonb_typeof(v) = 'object' and jsonb_typeof(v->'signal') = 'string'
     and lower(v->>'signal') in ('success', 'failure') then new.source_metadata := v; end if;
  return new;
end $f$;

create function live_search_mark_completed() returns trigger language plpgsql as $f$
declare v_signal text; v_stage text; v_role text; v_marker boolean;
begin
  if new.search_id is null then return new; end if;
  begin
    v_signal := nullif(lower(coalesce(new.source_metadata ->> 'signal', '')), '');
    v_stage  := nullif(left(coalesce(new.source_metadata ->> 'stage', ''), 40), '');
  exception when others then v_signal := null; v_stage := null; end;
  begin
    v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(((current_setting('request.jwt.claims', true))::jsonb ->> 'role'), ''), 'unknown');
  exception when others then v_role := 'unknown'; end;
  if v_signal = 'failure' then
    update live_search_admissions set status = 'failed', settled_at = now(),
      outcome = left(coalesce(outcome || ' -> ', '') || 'failure:' || coalesce(v_stage, 'unspecified') || ':' || v_role, 300)
     where search_id = new.search_id and status in ('in_flight', 'dispatched');
    return new;
  end if;
  v_marker := (new.job_title = 'No matching jobs found' and new.match_reason = 'Search complete'
           and coalesce(new.match_score, -1) = 0);
  if v_signal = 'success' then
    update live_search_admissions set status = 'completed', settled_at = now(),
      outcome = left(coalesce(outcome || ' -> ', '') || 'success:' || v_role, 300)
     where search_id = new.search_id and status in ('in_flight', 'dispatched');
    return new;
  end if;
  if v_marker then
    update live_search_admissions set status = 'completed', settled_at = now(),
      outcome = left(coalesce(outcome || ' -> ', '') || 'marker_unverified:' || v_role, 300)
     where search_id = new.search_id and status in ('in_flight', 'dispatched');
  end if;
  return new;
end $f$;

create trigger live_search_normalize_marker_signal before insert on job_matches
  for each row execute function live_search_normalize_marker_signal();
create trigger live_search_release_slot after insert on job_matches
  for each row execute function live_search_mark_completed();`;

const COLS = 'job_title, company, location, salary, apply_url, search_id, match_score, match_reason, source_metadata';
// What PostgREST executes for a JSON-array POST (all objects share the same keys).
const bulkInsert = (db, rows) => db.query(
  `insert into job_matches (${COLS}) select ${COLS} from json_populate_recordset(null::job_matches, $1::json)`,
  [JSON.stringify(rows)]);

// Rows shaped exactly like the Oct 31 / Nov 1 v2 run: Transform to JSON emits source_metadata
// as an object for jobs and as the JSON *string* '{"signal":"success"}' for the marker.
const job = (sid, i, extra = {}) => ({ job_title: `Data Analyst ${i}`, company: `Co ${i}`, location: 'Remote',
  salary: 'Not specified', apply_url: `https://example.com/${i}`, search_id: sid, match_score: 80 + i,
  match_reason: 'Data analyst role', source_metadata: { title: { text: `Data Analyst ${i}` }, dates: { posted: '2026-10-20' }, brief: '…' }, ...extra });
const marker = (sid) => ({ job_title: 'No matching jobs found', company: 'N/A', location: 'N/A', salary: 'Not specified',
  apply_url: 'N/A', search_id: sid, match_score: 0, match_reason: 'Search complete', source_metadata: '{"signal":"success"}' });
const failureMarker = (sid, stage) => ({ ...marker(sid), source_metadata: `{"signal":"failure","stage":"${stage}"}` });

async function fresh() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  return db;
}
const admission = async (db, sid) => (await db.query('select status, outcome from live_search_admissions where search_id = $1', [sid])).rows[0];
const count = async (db, sid) => Number((await db.query('select count(*) n from job_matches where search_id = $1', [sid])).rows[0].n);

test('bulk insert of jobs plus marker settles the search once, as success, with jobs kept as objects', async () => {
  const db = await fresh();
  const sid = 's_test_aaaaaaaaaaaa';
  await db.query(`insert into live_search_admissions (search_id, status) values ($1, 'in_flight')`, [sid]);
  await bulkInsert(db, [job(sid, 1), job(sid, 2), job(sid, 3), marker(sid)]);
  assert.equal(await count(db, sid), 4);
  assert.deepEqual(await admission(db, sid), { status: 'completed', outcome: 'success:service_role' });
  const types = (await db.query(`select jsonb_typeof(source_metadata) t, source_metadata->>'signal' s from job_matches where search_id=$1 order by id`, [sid])).rows;
  assert.deepEqual(types.map((r) => r.t), ['object', 'object', 'object', 'object']);
  assert.deepEqual(types.map((r) => r.s), [null, null, null, 'success']);
});

test('one bad row rejects the whole array: no partial jobs, no marker, slot still held', async () => {
  const db = await fresh();
  const sid = 's_test_bbbbbbbbbbbb';
  await db.query(`insert into live_search_admissions (search_id, status) values ($1, 'in_flight')`, [sid]);
  await assert.rejects(bulkInsert(db, [job(sid, 1), job(sid, 2, { match_score: 'ninety' }), marker(sid)]));
  assert.equal(await count(db, sid), 0);
  assert.equal((await admission(db, sid)).status, 'in_flight');
  // Module 43's error route (44) then writes the single failure marker: the slot is released as failed.
  await bulkInsert(db, [failureMarker(sid, 'bulk_insert')]);
  assert.deepEqual(await admission(db, sid), { status: 'failed', outcome: 'failure:bulk_insert:service_role' });
  assert.equal(await count(db, sid), 1);
});

test('rows for one search never touch another search', async () => {
  const db = await fresh();
  await db.query(`insert into live_search_admissions (search_id, status) values ('s_a_000000000000','in_flight'), ('s_b_000000000000','in_flight')`);
  await bulkInsert(db, [job('s_a_000000000000', 1), marker('s_a_000000000000')]);
  assert.equal((await admission(db, 's_a_000000000000')).status, 'completed');
  assert.equal((await admission(db, 's_b_000000000000')).status, 'in_flight');
  assert.equal(await count(db, 's_b_000000000000'), 0);
});

test('a job row cannot settle the search early, even if listing data carried a signal key', async () => {
  // source_metadata for jobs is the scraped listing. If a listing ever contained "signal":"success"
  // it would settle the search; record that the contract depends on listings not having that key.
  const db = await fresh();
  const sid = 's_test_cccccccccccc';
  await db.query(`insert into live_search_admissions (search_id, status) values ($1, 'in_flight')`, [sid]);
  await bulkInsert(db, [job(sid, 1)]);
  assert.equal((await admission(db, sid)).status, 'in_flight');
});

test('if Claude omits the marker, jobs land but the search waits for the slot TTL', async () => {
  const db = await fresh();
  const sid = 's_test_dddddddddddd';
  await db.query(`insert into live_search_admissions (search_id, status) values ($1, 'in_flight')`, [sid]);
  await bulkInsert(db, [job(sid, 1), job(sid, 2)]);
  assert.equal(await count(db, sid), 2);
  assert.equal((await admission(db, sid)).status, 'in_flight');
});
