# Live Search readiness, 2026-10-18

Status: committed on `claude/live-search-readiness` (based on origin/main e7fc270). Not pushed, not deployed. Nothing here changes production until the deploy steps below are approved and run.

## Where live search actually runs

Live searches run on `results.html`. `index.html` and `find-jobs.html` both redirect their search to `results.html?q=…&mode=…` before any Make or Supabase call. `find-jobs.html` still contains an older copy of the polling code, but its search never reaches it. It was left unchanged.

On origin/main, `results.html` shows "No live results for …" whenever a completion marker is present and the marker has no success signal, and also when Make reports a failure. A browser run of the readiness test against the origin/main page fails 2 of 5 checks for exactly this (unsigned marker, explicit failure).

## What changed

- `results.html`
  - A failure signal (`source_metadata.signal = "failure"`) shows "Live Search did not finish …". Partial results from a failed search are shown with a "stopped before it finished" note. A failure is never shown as "no jobs."
  - An unsigned completion marker shows "We could not confirm Live Search finished …".
  - Only `signal = "success"` with zero rows shows "No live results."
  - `LIVE_SEARCH_VIA_GATEWAY = false` is a cutover switch and is off. When on, the page posts to the live-search gateway, polls `job_matches` by the id the gateway issued, and shows gateway refusals (429/502/503) with Quick Match still available. The direct route is unchanged and remains the default.
- `supabase/functions/live-search/index.ts`: the Make dispatch sends the shared secret only in the `x-fj-gateway-secret` header. It is no longer in the JSON body, because Make keeps request bodies in its execution history.
- `tests/live-search-dispatch.ts` (new): the secret is header-only, and a refused dispatch returns `upstream_rejected` and settles its slot.
- `tests/live-search-client-states.mjs` (new): five browser scenarios on `results.html` with all network calls stubbed. Nothing reaches Make, Apify, Adzuna, or Supabase.
- `index.html`: unchanged. An earlier edit to it was reverted because that code is never reached.

Quick Match is unchanged. The Adzuna ingest worker and the employer pages are unchanged.

## Behavior change to decide before deploy

Make does not send an outcome signal yet. Until it does, a search that legitimately finds nothing will show "We could not confirm Live Search finished" instead of "No live results." Ship the client change only together with Make's success and failure signals, or accept that wording for now.

## Checks run (free; no paid Apify search, no Make calls, no secrets copied)

- Browser test (`tests/live-search-client-states.mjs`): 5 of 5 pass on the change. On origin/main's `results.html`, the unsigned and failure scenarios fail.
- Deno (`tests/live-search-dispatch.ts`, `tests/live-search-config-gate.ts`): 5 of 5 pass.
- `npm test`: 211 pass, 1 fail, 1 cancelled. Both are in `tests/resume-extraction.cjs` (PDF and DOCX extraction). The same failure occurs on origin/main, so it is unrelated to this change.
- Production read probes, earlier in the session: an unknown search id returns `unknown`. A valid gateway request returns 503 `gateway_not_configured`, which means `MAKE_LIVE_WEBHOOK_URL` and `MAKE_GATEWAY_SECRET` are not set in Supabase.
- Production data (read only): 639 `job_matches` rows across 70 search ids. No row carries an outcome signal. Fifteen searches have rows but no completion marker.

## Not verified

- Make scenario 4555354 has no check on the `x-fj-gateway-secret` header. It was not changed.
- The deployed gateway (version 11) was not fully diffed against main.
- No dry run with `GATEWAY_TEST_KEY`. The key is not available in this session.
- Live deploy behavior of the new `results.html` was not observed.

## Blockers for cutover, in order

1. Supabase secrets `MAKE_LIVE_WEBHOOK_URL` and `MAKE_GATEWAY_SECRET` are not set. This needs an owner action in Supabase.
2. Make does not check the secret header. The live site still posts to Make directly with no secret. If Make enforces the check before the flag is flipped, live search breaks. Enforcement and the flag flip must be one coordinated step.
3. Make does not emit `source_metadata.signal` (see the behavior change above).
4. Make's error handlers must write the failure signal. This is the remaining item from `docs/make-input-json-fix-2026-10-13.md`.
5. The gateway dry run has not been done.
6. Deploying `results.html` and the function needs approval. Not done.

## Cutover sequence, once blockers are cleared

1. Set the two Supabase secrets. Deploy the header-only `live-search` function.
2. Run the gateway dry run with `GATEWAY_TEST_KEY`. This must not call Make.
3. Configure Make so that the webhook requires the header `x-fj-gateway-secret` to match the stored secret, and rejects every other request.
4. In the same release, deploy `results.html` with `LIVE_SEARCH_VIA_GATEWAY = true`.
5. Watch gateway admissions, reads by search id, and Make error counts.

Rollback: deploy `results.html` with the flag back to `false` first, so the direct route resumes and sends no secret. Then remove the Make check. The direct route stays in the same file, so the rollback is a flag change and not a code revert.

## Run the checks

```
PLAYWRIGHT_MODULE=<path to playwright's index.js> node tests/live-search-client-states.mjs
deno test --allow-env --allow-read --import-map=tests/deno/import_map.json tests/live-search-dispatch.ts tests/live-search-config-gate.ts
```
