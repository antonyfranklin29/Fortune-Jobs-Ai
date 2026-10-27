# Live Search gateway cutover and rollback checklist (2026-10-25)

Owners: Claude (Make) and Codex (gateway and page edits), with Franklin approving every action marked **[approve]**. Stage 0 is complete; later stages have not run. Do not skip a stage's "verify" before starting the next stage.

## State on 2026-10-25 (read-only checks)

- **Make scenario 4555354** (Active) has a router with Live Search and Quick Match routes.
  - Each Live Search step that can fail writes one failure marker and then Skips: `claude`, `apify`, `apify_dataset`, `claude_match`, `parse`.
  - The normal route writes the success marker last.
  - Details are in `docs/make-live-search-signals-2026-10-24.md`.
- **Success-signal storage is proven; the full path is not (corrected 2026-10-27).** The two markers at 11:27 UTC on Oct 25 were written by the empty-body runs: objects with `signal: "success"`, which proves the normalizer, but `search_id` was null, so no admission or status was involved. No Live Search with a `search_id` has run since the signal work (0 rows with an id since 2026-10-24 18:00 UTC; last admission 2026-10-14). The id → marker → `live_search_status` path is proven only by the local contract test. The next organic Live Search proves it at no extra cost (query below); a dedicated paid test is not needed unless cutover is due first.
- **Gateway `live-search` v15 is deployed (checked 2026-10-27).** Its source predates the dry-run guard. `MAKE_LIVE_WEBHOOK_URL`, `MAKE_GATEWAY_SECRET` and `GATEWAY_TEST_KEY` are all unset, so every valid POST is refused with `gateway_not_configured` before admission.
- **Only `results.html` has the switch** (`LIVE_SEARCH_VIA_GATEWAY = false`). `index.html` (around line 1111) and `find-jobs.html` (around line 1072) POST Live Search straight to the old webhook and have no gateway path. **Cutover blocker:** the old webhook cannot be retired until those two pages use the gateway or hand Live Search to `results.html`. That work is Codex's.
- **Empty-body executions spend money.** Make history shows Live Search runs with an empty webhook body: Oct 16, Oct 19 4:50 PM, Oct 20 7:10 PM, Oct 24 2:50 PM, and two at Oct 25 7:27 AM ET.
  - Each ran the full paid route (about 9.85 credits, 9 operations) and wrote a marker with a null `search_id`.
  - The proposed fix is a filter on the Live Search route requiring `search_id` and `text` to be non-empty (stage 0).

## Safeguards merged into main (zero-cost, not deployed)

- **Gateway dry-run guard** in `supabase/functions/live-search/index.ts`. A request carrying `x-fj-dry-run: 1` without the correct `x-fj-test-key` is refused with `403 dry_run_unauthorized`.
  - The check runs before the body is read or anything is admitted.
  - Without it, a mistyped or rotated test key on a configured gateway would silently become a paid search.
  - Tested in `tests/live-search-dispatch.ts` against a configured gateway: there was no Make call and no admission.
  - Browser dry runs must send **both** headers. The gateway allows `x-fj-dry-run` in CORS. A browser request with only `x-fj-test-key` and an incorrect key can become a real paid search after Make is connected.
- **`scripts/live-search-preflight.mjs`**: free checks of the deployed gateway.
  - What it checks: CORS for the site origin, both browser dry-run headers allowed, CORS not offering the Make secret header, and minimal status fields. It also checks that invalid JSON, missing text, control characters and a non-live mode are each refused, and that the dry-run guard is present.
  - It sends a keyed dry run only when `GATEWAY_TEST_KEY` is set **and** the guard is proven present.
  - Every other POST it sends is invalid on any gateway version, so none can dispatch.
  - Tests are in `tests/live-search-preflight.mjs` (a stub gateway records any request that could dispatch; it must stay at zero).
  - Run it from a machine that can reach supabase.co (the cloud workspace cannot): `node scripts/live-search-preflight.mjs`. The output is JSON and never contains the key.

## Stage 0: stop empty-body runs (Make, free). DONE 2026-10-25, see the runbook

Verified 2026-10-27: the only execution since the guard was saved (Oct 26, 11:26:14 PM ET) carried a 5-byte body. It used 1 operation and 1 credit, and Make logged Claude 2 and Supabase Search Rows 20 as "The bundle did not pass through the filter". Each earlier empty-body run cost about 9.85 credits plus the Apify actor.

**What the guard does not stop:** a deliberate, well-formed request to the public webhook (`mode=live` plus any `search_id` and `text`) still runs the paid route. Only the gateway cutover (stages 3 to 7) closes that.

**Proving the first organic search** (free, read-only), after the next real Live Search:
```sql
select m.search_id, m.created_at, jsonb_typeof(m.source_metadata) kind, m.source_metadata->>'signal' signal,
       (select count(*) from public.job_matches j where j.search_id = m.search_id and j.job_title <> 'No matching jobs found') job_rows
from public.job_matches m
where m.job_title = 'No matching jobs found' and m.match_reason = 'Search complete'
  and m.search_id is not null and m.created_at > '2026-10-25'
order by m.created_at desc limit 5;
```
Expected: `kind = object`, `signal = success` (or `failure` with a stage). Direct-route searches have no admission row, so `live_search_status` only reports `complete` (job rows exist) or `unknown`; the page reads the marker's signal itself. The admission settle (`empty`/`failed`) is exercised only on the gateway path, proven locally by `tests/live-search-signals-db.mjs` and in production first at stage 5.

1. In scenario 4555354, open the filter between the router and Claude 2 (Live Search route). Record its current condition exactly; it is expected to be `1.mode = live`.
2. Add AND conditions: `1.search_id` *exists*, `1.search_id` *not equal* empty, `1.text` *exists*, `1.text` *not equal* empty.
3. Save, then reload and re-read the filter. Do not use Run once.
4. **Verify.** Every page and the gateway always send `search_id` and `text`, so real searches still pass. Watch history: there should be no new Live Search execution with an empty body, and the next real search should still produce a marker with its `search_id`:
   ```sql
   select search_id, created_at, source_metadata->>'signal' as signal
   from public.job_matches
   where job_title = 'No matching jobs found' and created_at > now() - interval '1 day'
   order by created_at desc limit 20;
   ```
5. **Rollback:** remove the added conditions, restoring the recorded filter.

## Stage 1: deploy the dry-run guard (Supabase, free) **[approve]**

1. The branch has been reviewed and merged. Deploy the current `live-search` source (it becomes the next version after v15). No secret changes are needed.
2. **Verify:** the preflight reports `dry_run_guard_deployed: ok`, and the other checks are all ok.
3. **Rollback:** redeploy v15. This is harmless, because v15 behaves the same for all real traffic.

## Stage 2: test key and dry run (Supabase, free) **[approve]**

1. Set `GATEWAY_TEST_KEY` in Supabase function secrets from the dashboard or CLI. Generate the value locally and never paste it into chat.
2. Run `GATEWAY_TEST_KEY=... node scripts/live-search-preflight.mjs`. `dry_run_admitted` and `dry_run_status_pending` should both be ok. If testing from a browser instead, send **both** `x-fj-dry-run: 1` and `x-fj-test-key: <key>`; never send a valid search with the test-key header alone. The browser request must use headers shaped like this:
   ```js
   headers: {
     "content-type": "application/json",
     "x-fj-dry-run": "1",
     "x-fj-test-key": testKey
   }
   ```
   - A dry run takes one visitor allowance and one slot until `slot_expires_at`. That is expected.
3. **Verify:**
   ```sql
   select search_id, status, outcome, admitted_at, slot_expires_at
   from public.live_search_admissions order by admitted_at desc limit 5;
   ```
   The dry-run row should be present. The Make history should show no new execution.

## Stage 3: gateway-only Make scenario, inactive (Make, free while inactive) **[approve]**

1. Clone scenario 4555354 as "Live Search (gateway)". Delete the Quick Match route from the clone, and give it a **new** custom webhook. Do not reuse the public one.
2. On the new webhook, set *Get request headers* = Yes. Read the exact header field name in the mapping panel; do not assume it.
3. Set the Live Search filter: `mode = live` AND `search_id` and `text` non-empty AND the header `x-fj-gateway-secret` **equals (case sensitive)** the secret.
   - Enter the secret directly in Make. Don't paste it in chat, and don't save it in any file.
4. Check that every failure route, the success-marker mapping and the Apify input match the original. The runbook lists each one.
5. Leave the scenario **inactive** and save. Reload, then re-read the filter and the webhook settings.
6. **Rollback:** delete the clone.

## Stage 4: point the gateway at the new scenario (Supabase) **[approve]**

1. Set `MAKE_GATEWAY_SECRET` to the same value as the Make filter, and `MAKE_LIVE_WEBHOOK_URL` to the **new** webhook. Set both together, without echoing either.
2. The site still calls the old webhook directly at this stage, so no visitor traffic reaches the gateway yet.
3. **Verify:** run the preflight again; it should be all ok.
   - Do not send a real search yet; that is stage 5.
   - With the new scenario inactive, a real gateway search would be queued in Make, not run.
4. **Rollback:** unset both secrets. The gateway goes back to `gateway_not_configured`.

## Stage 5: activate and run one real search (paid, capped) **[approve: action-time]**

1. Activate "Live Search (gateway)".
2. Franklin, or an approved test, runs **one** gateway search through `results.html` with the switch flipped in a local or preview copy only. Alternatively, Codex posts once to the gateway with a real query. The Apify cap is 0.10.
3. **Verify:**
   - The admission goes `dispatched` → `completed`, with outcome `success:…`.
   - `live_search_status` returns `complete` or `empty`.
   - The marker is an object with `signal = success`.
   - In Make, the new scenario shows one execution and the old scenario none for that `search_id`.
   ```sql
   select public.live_search_status('<search_id>');
   select status, outcome from public.live_search_admissions where search_id = '<search_id>';
   select jsonb_typeof(source_metadata), source_metadata
   from public.job_matches where search_id = '<search_id>' and job_title = 'No matching jobs found';
   ```
4. **Rollback:** deactivate the new scenario. The site is unaffected, because it still uses the direct route.

## Stage 6: move the pages (Codex) **[approve]**

1. Flip `LIVE_SEARCH_VIA_GATEWAY = true` in `results.html`. Give `index.html` and `find-jobs.html` the same gateway path, or have them hand Live Search to `results.html`. All three must ship in one release.
2. **Verify for one to two hours:**
   - New gateway admissions arrive at the expected rate, and none stay `dispatched` past `slot_expires_at`.
   - New executions appear in the new scenario; executions in the old scenario's Live Search route fall towards zero (cached pages only).
   ```sql
   select status, count(*), min(admitted_at), max(admitted_at)
   from public.live_search_admissions where admitted_at > now() - interval '2 hours' group by status;
   ```
3. **Rollback, in this order:** flip the switch(es) back to `false` and deploy. The direct route still works, because the old scenario is untouched. Then, if needed, deactivate the new scenario or unset the gateway secrets.

## Stage 7: retire the direct route **[approve]**

1. Wait for the cache window: at least 24 hours after stage 6 with no old-route Live Search executions except stray empty bodies, which stage 0 already filters.
2. In scenario 4555354, disable the Live Search route, for example with a filter that never passes. Keep Quick Match running.
3. Rotate the old webhook: create a new one for Quick Match and update the pages (Codex). The old URL is public in page source, so this rotation is what actually closes the open direct path.
4. **Rollback:** re-enable the old route and set the page switches back to `false`. This is only possible before the old webhook is rotated, so do the rotation last.

## Approvals needed

| # | Action | Cost |
|---|---|---|
| 0 | Empty-body guard filter on the current Live Search route | free |
| 1 | Deploy the merged dry-run guard and CORS update (next version after v15) | free |
| 2 | Set `GATEWAY_TEST_KEY` and run one dry run | free (one slot) |
| 3 | Create the inactive gateway-only scenario and its webhook | free |
| 4 | Set `MAKE_GATEWAY_SECRET` and `MAKE_LIVE_WEBHOOK_URL` | free |
| 5 | Activate the new scenario and run one real search | ~10 Make credits, ≤ $0.10 Apify |
| 6 | Page release (Codex) | free |
| 7 | Retire the old route and rotate the webhook | free |

Stages 0 to 4 need Make to stay signed in, plus Supabase dashboard or CLI access for secrets. The Supabase connector used here cannot set function secrets without the value passing through chat, so Franklin sets the secrets himself.
