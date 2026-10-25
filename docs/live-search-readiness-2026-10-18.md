# Live Search readiness (updated 2026-10-24)

Integrated on October 24. The header-only-secret `live-search` Edge Function was deployed through the Supabase editor, which reported success. The page changes are included in the site release with the gateway switch **off**. Make now writes completion signals through an applied normalizer; the gateway secret filter and cutover remain pending. See `docs/make-live-search-signals-2026-10-24.md` for the current Make record.

## Implemented vs deployed

| Item | On branch | In production |
|---|---|---|
| Failure signal shown as a failure, never "no jobs" (`results.html`) | Yes | Included in site release. |
| Unsigned completion marker shown as "could not confirm" | Yes | Included in site release. |
| Gateway switch `LIVE_SEARCH_VIA_GATEWAY` | Yes, **off** | Included in site release, **off**. The site still posts to Make directly. |
| Gateway status check (failed, indeterminate, empty) while no rows have arrived | Yes, gateway path only | Included but inactive while the switch is off. |
| Make secret sent in the header only (`live-search` function) | Yes | Deployed October 24. |
| Supabase secrets `MAKE_LIVE_WEBHOOK_URL`, `MAKE_GATEWAY_SECRET` | n/a | Not set. A no-key production POST returned `503 gateway_not_configured` before admission on October 24. |
| Make check of the secret header | n/a | Not present. The scenario 4555354 router filter checks `mode` only. |
| Make outcome signal `source_metadata.signal` | n/a | Success and Apify-failure mappings saved October 24; an end-to-end marker remains unverified without a capped Apify search. The database normalizer is applied. |

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
- Production: the updated function was deployed successfully; a no-key POST returned `503 gateway_not_configured`. The browser tests passed 8/8 and the two dispatch tests plus three configuration-gate tests passed 5/5 without provider calls.

## Remaining cutover sequence

1. **Done October 24:** deploy the `live-search` function with the header-only secret. It refuses before admission while the secrets are unset.
2. Run one capped Live Search to verify the new Make success marker arrives as an object. That calls Apify and has not been done.
3. Create a separate gateway-only Make webhook with its secret filter enabled from the start. Keep the existing direct webhook working for cached pages.
4. Set `MAKE_LIVE_WEBHOOK_URL` and `MAKE_GATEWAY_SECRET` in Supabase without displaying the values. Dry-run the gateway with `GATEWAY_TEST_KEY`.
5. Deploy `results.html` with `LIVE_SEARCH_VIA_GATEWAY = true`, then watch admissions, reads by search id, and Make errors.
6. Retire or rotate the direct webhook only after its traffic has stopped. See `docs/make-live-search-signals-2026-10-24.md`.

**Rollback:** deploy `results.html` with the flag set to `false` first, then remove the Make filter. The direct route stays in the same file.

## Run the checks

```
PLAYWRIGHT_MODULE=<path to playwright's index.js> node tests/live-search-client-states.mjs
deno test --allow-env --allow-read --import-map=tests/deno/import_map.json tests/live-search-dispatch.ts tests/live-search-config-gate.ts
```
