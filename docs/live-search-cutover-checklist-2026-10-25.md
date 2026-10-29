# Live Search gateway cutover and rollback checklist (2026-10-25)

Owners: Claude (Make) and Codex (gateway and page edits), with Franklin approving every action marked **[approve]**. Stage 0 is complete; later stages have not run. Do not skip a stage's "verify" before starting the next stage.

## State on 2026-10-25 (read-only checks)

- **Make scenario 4555354** (Active) has a router with Live Search and Quick Match routes.
  - Each Live Search step that can fail writes one failure marker and then Skips: `claude`, `apify`, `apify_dataset`, `claude_match`, `parse`.
  - The normal route writes the success marker last.
  - Details are in `docs/make-live-search-signals-2026-10-24.md`.
- **Success-signal storage is proven; the full path is not (corrected 2026-10-27).** The two markers at 11:27 UTC on Oct 25 were written by the empty-body runs: objects with `signal: "success"`, which proves the normalizer, but `search_id` was null, so no admission or status was involved. No Live Search with a `search_id` has run since the signal work (0 rows with an id since 2026-10-24 18:00 UTC; last admission 2026-10-14). The id → marker → `live_search_status` path is proven only by the local contract test. The next organic Live Search proves it at no extra cost (query below); a dedicated paid test is not needed unless cutover is due first.
- **REGRESSION, 2026-10-29 03:25 UTC (11:25 PM ET Oct 28): `live-search` v18 is pre-guard source.** A manual deploy (no GitHub workflow deploys functions; Supabase logs show no other caller) replaced the Oct 27 build. Deployed v18 has no dry-run guard, CORS allows only `content-type, x-fj-test-key`, and dispatch sends `x-fj-gateway-secret` instead of `x-make-apikey`. Codex's preflight at 03:33 UTC confirms `dry_run_guard_deployed=false` and `cors_dry_run_headers=false`. No live harm yet: Make URL and secret are unset, there were no admissions after 2026-10-14 and no Live Search markers after Oct 25. **Stages 2–5 are blocked until `live-search` is redeployed from main** (`supabase/functions/live-search/index.ts` at `74d8db9` or later) and the preflight is all ok again. Do not use "redeploy v15" as a rollback any more; v15 lacks both fixes.
- **Gateway `live-search` was updated on 2026-10-27 at 1:24 PM ET** (superseded by the regression above). The dry-run guard and browser CORS header are live. The free production preflight passed every check immediately after deployment. No secrets were changed in this deployment. The Make URL and shared secret were unset at the last configuration check; confirm that state before any cutover work.
- **Only `results.html` runs Live Search (corrected 2026-10-27).** `index.html` and `find-jobs.html` contain a copy of the direct-webhook code, but `handleSearch` hands every search to `results.html?q=…&mode=…` first unless the page is `data-page="results"`, which only `results.html` is. Their copy is unreachable, so `results.html`'s `LIVE_SEARCH_VIA_GATEWAY` switch moves all Live Search traffic. Proven in a browser by `tests/live-search-client-states.mjs` (home and Find Jobs hand off; with the switch on, only the gateway is called). This is no longer a blocker; the dead copies can be removed at stage 7.
- **Empty-body executions spend money.** Make history shows Live Search runs with an empty webhook body: Oct 16, Oct 19 4:50 PM, Oct 20 7:10 PM, Oct 24 2:50 PM, and two at Oct 25 7:27 AM ET.
  - Each ran the full paid route (about 9.85 credits, 9 operations) and wrote a marker with a null `search_id`.
  - The proposed fix is a filter on the Live Search route requiring `search_id` and `text` to be non-empty (stage 0).

## Safeguards merged into main and deployed (zero-cost)

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

## Stage 1: deploy the dry-run guard (Supabase, free). DONE 2026-10-27

1. The branch was reviewed and merged; the current `live-search` source was deployed. No secret changes were made.
2. **Verified:** `node scripts/live-search-preflight.mjs` reported `status: ok`, including `dry_run_guard_deployed` and `cors_dry_run_headers`. Supabase showed a fresh deployment at 1:24 PM ET with no invocation errors.
3. **Rollback:** redeploy from main. Do not redeploy v15: it lacks the dry-run guard and the `x-make-apikey` header, and a v15-equivalent build (v18) was found live on 2026-10-29; see State.

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

## Stage 3: gateway-only Make scenario, inactive (Make, free). DONE 2026-10-27

Built by Claude, saved, reloaded and re-read. Nothing was run and no secret was entered.

- **Scenario 6798265**, "Live Search (gateway only) - INACTIVE until cutover", cloned from 4555354. **Inactive.** It has all of the original's modules, mappings and failure routes, because a clone copies the blueprint; the live scenario had no edits after its last verified save (Oct 25, 9:38 PM ET).
- **New webhook** "Live Search gateway-only hook". Its address appears only in Make; it is not in any file, page or chat. *Get request headers* = **No**, *Get HTTP method* = No, *JSON pass-through* = No. No API key yet.
- **Live Search guard on the clone**: `1.mode` equals `live` AND `1.search_id` matches `^s_[0-9a-z]+_[0-9a-f]{12}$` AND `1.text` matches `\S`. The id pattern accepts only gateway-minted ids (`s_<base36 time>_<12 hex>`); the pages' UUIDs do not match. Checked against the gateway's generator.
- The Quick Match and empty placeholder routes are still in the clone. The gateway always sends `mode: "live"`, so they never run; they can be deleted later.

**Change from the original plan: Make's webhook API key instead of a header filter.**
- Make webhooks have built-in *API Key authentication* (header `x-make-apikey`). A request without the key is refused before the scenario runs, so it uses no credits.
- A filter on `x-fj-gateway-secret` would need *Get request headers* = Yes, which puts every header, including the secret, into Make's execution history in plain text.
- The gateway on branch `claude/live-search-site-cutover` sends the secret only as `x-make-apikey`, which Make's documentation says is sanitized from module data. No other header and never the body carries it (`tests/live-search-dispatch.ts` asserts exactly one header holds it). That change must be deployed before stage 4.

**Rollback:** delete scenario 6798265 and its webhook. Nothing else uses them.

## Stage 4: arm the key and point the gateway at the new scenario **[approve]**

0. Deploy `live-search` from main once the `x-make-apikey` change is merged. Verify with the preflight.
1. **The secret.** Franklin creates one random value locally and keeps it in his password manager, never in chat. It goes in exactly two places:
   - **Make:** scenario 6798265 → webhook module → Edit webhook → API Key authentication → **Add API key** → paste → save the webhook and the scenario.
   - **Supabase:** Edge Functions → Secrets → `MAKE_GATEWAY_SECRET` = the same value.
2. **The webhook address (not the secret).** Separately, Franklin copies the new webhook's URL from that module in Make into Supabase `MAKE_LIVE_WEBHOOK_URL`. It tells the gateway where to send; the API key is what authorises the call.
   - The gateway stays refused (`gateway_not_configured`) until both Supabase values are set, so set them in the same sitting.
3. The site still calls the old webhook directly at this stage, so no visitor traffic reaches the gateway yet.
4. **Verify:** run the preflight again; it should be all ok.
   - Do not send a real search yet; that is stage 5.
   - With the new scenario inactive, a real gateway search would be **queued** in Make and would run when the scenario is activated. Before activating at stage 5, check the scenario's queue is empty and clear anything unexpected.
5. **Rollback:** unset `MAKE_GATEWAY_SECRET` and `MAKE_LIVE_WEBHOOK_URL`. The gateway goes back to `gateway_not_configured`. The Make API key can stay; it only blocks callers.

## Stage 5: activate and run one real search (paid, capped) **[approve: action-time]**

1. Check the queue of scenario 6798265 is empty, then activate it.
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

## Live Search paused on the site, 2026-10-28 (e39904c)

`LIVE_SEARCH_PAUSED = true` in `results.html`: the page refuses Live Search before it calls the gateway or Make, and Quick Match stays live. **This does not close the cost exposure.** The old webhook address is still in the source of `index.html`, `find-jobs.html` and `results.html`, and scenario 4555354 is still Active, so anyone holding the address can start paid runs. While paused, no current page uses that route, so it can be retired now, before the gateway is live (stage 6). Live Search is unpaused only in stage 7.

`tests/live-search-release-guard.cjs` enforces the site side: `results.html` can only ship with `LIVE_SEARCH_PAUSED = false` if `LIVE_SEARCH_VIA_GATEWAY = true` and no `.html`/`.js` page contains a Make webhook address. It also checks that the pause is tested before any Live Search request.

## Stage 6: retire the old direct route (Make, free) **[approve]** — can run now, while paused

1. Franklin signs in to Make. Confirm the history of scenario 4555354: Live Search runs since the pause should be none (or only stray 1-credit calls stopped by the stage 0 guard).
2. **Deactivate scenario 4555354.** No page uses it: Quick Match reads the database directly and no page calls `WEBHOOK_URL_QUICK`; Live Search is paused.
3. **Then delete its webhook** ("Fortune Jobs AI" hook) so the public address stops accepting requests. Deactivating alone is not enough: Make keeps accepting and queuing requests for an inactive scenario's webhook, and they would run if it were ever reactivated. Before deleting, open the scenario's queue (Incomplete executions / webhook queue) and clear anything that arrived after the pause.
4. **Verify (read-only):** the scenario shows Inactive, the webhook is gone from Make's webhook list, and Make history shows no new 4555354 executions. Do not "test" the old address with a request.
5. **Rollback:** reactivate 4555354 with a new webhook. Only needed if the gateway route is abandoned; the site stays paused either way.

## Stage 7: switch Live Search on through the gateway (one site release, Codex) **[approve]**

Preconditions: stages 1–5 verified (gateway redeployed from main and preflight all ok, dry run ok, secrets set, one real gateway search verified end to end) and stage 6 done.

1. Merge the switch-on branch `claude/live-search-cutover-flip-v3`: `LIVE_SEARCH_VIA_GATEWAY = true`, `LIVE_SEARCH_PAUSED = false`, and the old webhook address removed from all three pages (`WEBHOOK_URL_LIVE` / `WEBHOOK_URL_QUICK` set to `''`; their only callers are the unreachable direct copies). `tests/live-search-release-guard.cjs` must pass on it. (`claude/live-search-cutover-flip` and `-flip-v2` are superseded.)
2. **Verify for one to two hours:**
   - Gateway admissions arrive at the expected rate, and none stay `dispatched` past `slot_expires_at`.
   - Executions appear only in scenario 6798265.
   ```sql
   select status, outcome, count(*), min(admitted_at), max(admitted_at)
   from public.live_search_admissions where admitted_at > now() - interval '2 hours' group by 1, 2;
   ```
3. **Rollback:** set `LIVE_SEARCH_PAUSED = true` and release (Quick Match keeps working); then, if needed, deactivate 6798265 or unset the gateway secrets. There is no fallback to the direct route; it was retired in stage 6.

## Approvals needed

| # | Action | Cost |
|---|---|---|
| 0 | Empty-body guard filter on the current Live Search route — done 2026-10-25 | free |
| 1 | Deploy the merged dry-run guard and CORS update — done 2026-10-27 | free |
| 2 | Set `GATEWAY_TEST_KEY` and run one dry run | free (one slot) |
| 3 | Create the inactive gateway-only scenario and its webhook — done 2026-10-27 (scenario 6798265, inactive) | free |
| 4 | Deploy the `x-make-apikey` gateway change; Franklin puts one random secret in the Make API key and `MAKE_GATEWAY_SECRET`, and copies the new webhook URL into `MAKE_LIVE_WEBHOOK_URL` | free |
| 5 | Activate the new scenario and run one real search | ~10 Make credits, ≤ $0.10 Apify |
| 6 | Deactivate scenario 4555354 and delete its webhook (safe now: Live Search is paused, Quick Match does not use it) | free |
| 7 | Merge `claude/live-search-cutover-flip-v3`: gateway on, unpause, old webhook address removed from pages | free |

Stages 0 to 4 need Make to stay signed in, plus Supabase dashboard or CLI access for secrets. The Supabase connector used here cannot set function secrets without the value passing through chat, so Franklin sets the secrets himself.
