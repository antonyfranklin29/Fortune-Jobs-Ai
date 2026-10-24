# Live Search readiness (updated 2026-10-24)

Branch `claude/live-search-readiness`, rebased onto origin/main 62658cf. **Implemented and tested on the branch. Nothing here is deployed.**

## Implemented vs deployed

| Item | On branch | In production |
|---|---|---|
| Failure signal shown as a failure, never "no jobs" (`results.html`) | Yes | No. Production still shows "No live results" for failures and for unsigned markers. |
| Unsigned completion marker shown as "could not confirm" | Yes | No |
| Gateway switch `LIVE_SEARCH_VIA_GATEWAY` | Yes, **off** | Not present. The site posts to Make directly. |
| Gateway status check (failed, indeterminate, empty) while no rows have arrived | Yes, gateway path only | Not present |
| Make secret sent in the header only (`live-search` function) | Yes | **No.** Deployed version 11 (Oct 17) still copies the secret into the JSON body. Inert today, because the Make URL and secret are not set. |
| Supabase secrets `MAKE_LIVE_WEBHOOK_URL`, `MAKE_GATEWAY_SECRET` | n/a | Not set. Version 11 refuses requests with `gateway_not_configured` before admission. |
| Make check of the secret header | n/a | Not present. The scenario 4555354 router filter checks `mode` only. |
| Make outcome signal `source_metadata.signal` | n/a | Not sent. No production row carries one. |

## Where live search runs

Live searches run on `results.html`. `index.html` and `find-jobs.html` redirect their search there before any Make or Supabase call. `find-jobs.html` still contains an older copy of the polling code, but its search never reaches it, so it was left unchanged. `results.html` is shared with Quick Match. Only the Live Search functions were changed: `fetchJobs`, `startPolling`, the gateway submit and status calls, and the outcome screens. No Quick Match code was touched.

## Page behavior on the branch

- `signal = "failure"`: "Live Search did not finish". Partial results from a failed search carry a "stopped before it finished" note.
- An unsigned completion marker: "We could not confirm Live Search finished".
- `signal = "success"` with zero rows: "No live results". This is the only no-jobs state.
- Gateway path, no rows yet: the page checks `GET live-search?search_id=…` on every other poll. `failed` ends the search as a failure, `indeterminate` as unconfirmed, and `empty` as no jobs. `pending`, `complete` and `unknown` keep polling. Errors are ignored, so job rows stay authoritative.
- Gateway refusals (429, 502, 503) are shown with Quick Match offered.
- The direct route, which is the default, never calls the gateway.

**Behavior change to accept before deploying `results.html`:** Make sends no success signal yet, so a search that legitimately finds nothing will read "could not confirm" until Make writes `source_metadata.signal`. Deploy the page together with that Make change, or accept the wording.

## Checks run (all free: no Apify run, no Make call, no secrets read or printed)

- Browser test `tests/live-search-client-states.mjs`: 8 of 8 pass.
  - Against origin/main's `results.html`, the unsigned-marker and failure checks fail, which reproduces the production bug.
  - With the status check disabled, the two status scenarios fail.
- Deno `tests/live-search-dispatch.ts` and `tests/live-search-config-gate.ts`: 5 of 5 pass. The secret is in the header and absent from the body.
- Production, read only:
  - `live-search` is version 11 and still has the body copy of the secret.
  - Earlier probes: the status endpoint answers, and a POST is refused with `gateway_not_configured`.
  - No POST probe was sent this time. If the secrets had been set since, a POST would have started a paid run.

## Cutover sequence (each step needs Tony's go-ahead)

1. Deploy the `live-search` function from this branch (header-only secret). This is safe while the secrets are unset, because the function refuses before admission.
2. Set `MAKE_LIVE_WEBHOOK_URL` and `MAKE_GATEWAY_SECRET` in Supabase. Do step 1 first, so the secret never travels in a body that Make logs.
3. Dry run with `GATEWAY_TEST_KEY`. This admits a request but never calls Make.
4. In Make, make sure the webhook passes request headers to the scenario, then filter the Live Search route on `x-fj-gateway-secret` equal to the stored secret. The header option and the filter syntax were not verified in this session.
5. In the same release as step 4, deploy `results.html` with `LIVE_SEARCH_VIA_GATEWAY = true`. The live site sends no secret, so enforcing step 4 before the flag flips would break live search.
6. Make writes `source_metadata.signal` (`success` or `failure`) on the completion marker, and its error handlers write `failure`. See `docs/make-input-json-fix-2026-10-13.md`.
7. Watch admissions, reads by search id, and Make errors.

**Rollback:** deploy `results.html` with the flag set to `false` first, then remove the Make filter. The direct route stays in the same file.

## Run the checks

```
PLAYWRIGHT_MODULE=<path to playwright's index.js> node tests/live-search-client-states.mjs
deno test --allow-env --allow-read --import-map=tests/deno/import_map.json tests/live-search-dispatch.ts tests/live-search-config-gate.ts
```
