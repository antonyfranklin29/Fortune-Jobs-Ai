# Live Search v2: free pre-cutover checks (2026-11-01, Claude)

No Make or Apify run was made, nothing was activated, and no secret was changed. v2 (6856037) is Inactive on hook 3008463, and 6798265 is Inactive on hook 2989632. Both hook queues are 0.

## 1. Bulk-insert failure path (module 43)

**Make side (documented behaviour).**
- Make treats any HTTP 400–599 response from an app module as an error ([Make error handling](https://developers.make.com/custom-apps-documentation/app-components/base/error-handling)).
  - Client errors stop the module.
  - 5xx responses are treated as temporary connection errors.
- So a rejected bulk insert raises an error on module 43. Its error route (44 → 45) then writes the failure marker `{"signal":"failure","stage":"bulk_insert"}` and ends the run as handled.
- I did not live-test this. A live probe against production REST was correctly refused as a shared-resource write.

**Database side (tested locally).** `tests/live-search-bulk-insert-db.mjs` uses an in-process PGlite with the production trigger functions. It runs the same single statement PostgREST runs for a JSON-array POST (`insert … select … from json_populate_recordset`). **All 5 tests pass:**
1. Jobs plus a marker in one array: the search is settled once as `success:service_role`. Job `source_metadata` is stored as an object, and the marker string is normalised to `{"signal":"success"}`.
2. One bad row (a non-integer `match_score`) rejects the **whole** array: 0 rows, no marker, and the slot is still `in_flight`. The follow-up failure marker then settles it as `failure:bulk_insert:service_role`.
3. Rows for one search never change another search's admission.
4. A job row without `signal` does not settle the search early.
5. If Claude omits the marker, the jobs land but the search waits for the 5-minute TTL and ends `failed`. This is the same as v1.

**Hardening (recommended, not applied).**
- PostgREST rejects a JSON array whose objects have different keys (`All object keys must match`, [PostgREST #1118](https://github.com/PostgREST/postgrest/issues/1118)).
- Aggregator 41 maps all nine fields for every row, and the Nov 1 run succeeded. But if Make's Transform to JSON drops an empty value (for example, Claude omits `match_reason`), the whole insert would fail and become a failure marker.
- Fix: add the query parameter `columns=job_title,company,location,salary,apply_url,search_id,match_score,match_reason,source_metadata` to module 43. With it, PostgREST skips the key-matching check and treats a missing key as null.

## 2. Freshness window: keep 30 days

The posted dates of all 20 listings Apify returned in the two capped runs (relative to each run date):

| Window | Oct 31 run (10) | Nov 1 run (10) | Total |
|---|---|---|---|
| ≤ 30 days | 4 | 6 | **10** |
| 31–45 days | 1 (Sep 18) | 0 | **1** |
| > 45 days | 5 (Aug 12, Aug 18, Jun 4, Jun 6, 2025-10-14) | 4 (Aug 24, Aug 27, May 21, Mar 10) | **9** |

- Widening to 45 days would have added **1 listing in 20** (about 0.5 per search).
- The stale listings cluster at **60 days to over a year**, not just past 30. Indeed itself labels everything past 30 as "30+ days ago".
- **Recommendation:** keep 30.
- To get more fresh jobs per search, change what Apify returns rather than widening the filter:
  - Option (a): set the actor's `sort` to `date`. It is free; the actor notes that sponsored jobs can break strict ordering.
  - Option (b): `fromDays` accepts only 1, 3, 7 or 14. 14 is the closest, but it would also hide 15–30-day jobs.
  - Either needs one capped test, because results will differ.

## 3. Make-side blockers for a guarded cutover

1. **The gateway is not paused while Supabase points at an inactive scenario.**
   - `live_search_limits.paused = false`, and `MAKE_LIVE_WEBHOOK_URL` points at v2 hook 3008463.
   - Make keeps webhooks for an inactive scenario in its queue (limit 667). Any direct POST to the public gateway now returns 202 and is queued. **Every queued request would run, at about 14 credits each plus Apify, the moment v2 is activated.**
   - Before activating: check that the hook queue is 0 (it is 0 now). Better: set `paused = true` until cutover. This is Codex's gateway config.
2. **The Make plan allowance is smaller than the gateway caps.**
   - The Make Core plan allows **10,000 credits/month**. 871 are used this cycle, which resets on Nov 11.
   - At about 14 credits per search that is about **650 more searches a month** across *all* users, minus the other scenarios.
   - Current production caps are 150/day globally (about 2,100 credits/day). The pending quota migration's `global_per_30_days = 200` (about 2,800 credits) fits.
   - Apply the monthly cap before going public, or upgrade the plan. The 50-search plan alone covers about 13 heavy subscribers per 10k credits.
3. **v2 scenario settings to set at cutover** (not changed now):
   - `dlq: true` (store incomplete executions): a manual "retry" would re-run a paid search for a search that is already settled. Turn it off; every risky module already has an Ignore error route.
   - `maxErrors: 3`: three unhandled errors in a row deactivate the scenario, after which requests queue (see 1). Keep it, but the queue must be checked before any reactivation.
   - `confidential: false`: Make keeps search text and listing data in run history. Consider turning it on after launch debugging.
   - The name still reads "INACTIVE, not wired"; rename it at cutover.
4. **The module 43 `columns` hardening** described in section 1.

None of these require another paid run, except a later test of `sort: date` if you choose it.
