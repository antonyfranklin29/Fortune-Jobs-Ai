# Fortune Jobs AI overnight handoff — 25 October 2026

Starting point (9:15 p.m. ET): Quick Match has 756 open stored rows but no source refresh since 17 October. Live Search still uses the public Make webhook; the Supabase gateway switch and Make shared-secret filter are off. Billing for seeker and employer subscriptions remains deferred.

Adzuna update (after 9:30 p.m. ET): Franklin completed the provider subscription in Adzuna. The account page confirmed "Plan change was successful," "Plan: API Access: £8 per month," and allowances of 500 calls/day and 5,000 calls/month. The plan detail also lists 50 calls/minute and 2,000/week. This is separate from the deferred seeker/employer billing. No new Adzuna call was made as part of the confirmation.

Supabase update (later that evening): Franklin entered the rotated `INGEST_SECRET` directly in the Test panel. A 3-call nationwide feed run succeeded and inserted 26 jobs. A separate 15-call Data Analyst cell run across states lacking recent listings inserted 232 jobs. Its Test panel displayed a 500 after the database work, but the `ingest_runs` ledger recorded run 4 as `partial`, 15 requests, 232 inserted; the public catalogue health check showed 1,014 open jobs and recent coverage in all 50 states. `partial` reflects deferred pages/cells, not a failed write. The newer role/state cell fairness change in commit `9c5db44` remains undeployed. The owner then saved the same ingest secret in Supabase Vault and approved automatic refresh. `pg_net` was enabled, the temporary lifetime cap was removed, and cron job 2 (`job-ingest-us-it-feed-hourly`) was installed and verified active at minute 7 of every hour with budget 3. A no-cost `dry_run` request through `pg_net` and Vault received HTTP 200 with `nothing_due`, proving that path authenticates. The first scheduled feed run remains to be observed; Claude is investigating the separate cell-mode 500.

## Parallel work

| Owner | Tonight's work | Evidence to finish |
|---|---|---|
| Codex | Hide stale imported listings from Quick Match without hiding active employer posts; verify the public site after deployment; reconcile Adzuna access and prepare a capped refresh; check US state coverage and launch behavior. | Tests, deployment check, public catalogue report and exact coverage limits. |
| Claude | Verify Make success/failure completion signals; stop empty webhook requests before paid modules if authorized; prepare the separate gateway-only scenario and free gateway dry-run if authorized; document cutover and rollback. | Saved Make configuration read back after reload, no-cost checks, branch/commit and a list of remaining prerequisites. |

## Boundaries and dependencies

- Franklin entered billing details and activated Adzuna API Access himself. Check provider usage before spending any new calls.
- No paid Apify run tonight. A production success marker already observed by Claude may satisfy the success-path check; retain evidence in the Make runbook.
- The Adzuna worker no longer has the temporary `ADZUNA_LIMIT_TOTAL` lifetime cap. Its default limits remain 25/minute, 250/day, 1,000/week and 2,500/month, below the paid Adzuna plan's 50/minute, 500/day, 2,000/week and 5,000/month. The hourly schedule uses 3 calls per run, at most 2,232 in a 31-day month. The ledger records 28 calls before the schedule's first execution. Check `cron.job_run_details`, `net._http_response` and `ingest_runs` after the first hourly run; do not infer success merely from the active cron row.
- Keep the direct Live Search path working until the separate gateway-only scenario, secret check, frontend switch, cached-page drain and rollback path have been verified as one coordinated cutover. Never expose a webhook URL, API key or secret in documentation or chat.
- Do not claim 100 jobs in every role and state. Measure real coverage. The Adzuna US IT feed covers 18 tracked IT roles; Canada, the UK and India need separate source approval and scope.

Ending point for the morning handoff: identify changes shipped, checks passed, actual Adzuna plan/call budget, current catalogue freshness and state gaps, Live Search cutover readiness, and each blocker that still needs Franklin.
