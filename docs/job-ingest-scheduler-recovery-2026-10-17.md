# Adzuna ingestion: why the feed stopped, and recovery fixes — October 17, 2026

Branch: `claude/adzuna-scheduler-recovery`, from `origin/main` at `3ada9b4`.

No provider call was made, no production row was written, no plan was purchased, and no API key or secret was read or printed. Production was checked read-only.

## Why the last successful run stopped on October 15

It did not stop. Nothing was ever scheduled to run it again.

Evidence (read-only, production project `hqgakkcxcyspqhnlnscv`):

- `cron.job` has no `job-ingest` entry. `pg_cron` is installed; `pg_net` is not. The hourly schedule in `migrations/pending/20261015_ingest_schedule.sql` is marked **NOT APPLIED** and needs `pg_net`, the Vault secret, and an approved plan.
- `ingest_runs` holds exactly two successful runs, both on October 15: 23:11:00 UTC and 23:12:23 UTC, five provider requests each. Both were the owner's manual five-call test from the Test panel (see `docs/job-ingest-deployment-2026-10-15.md`).
- `ingest_feeds` for `adzuna-us-it` has `next_page = 9`, `passes_completed = 0`, `last_pass_completed_at = null`, `last_success_at = 2026-10-15 23:12:44 UTC`, `last_error = null`. The feed is part-way through its first pass, and no run has resumed it.
- The deployed Edge Function (version 4) is byte-identical to `main` for `index.ts`, `lib.mjs` and `config.mjs`. The code that was running is the code in the repository.

Two further points about why one manual run is not a feed:

- A complete pass covers 265,183 listings reported by the source at 50 per page: about 5,304 pages. At the planned budget of 6 requests an hour, one pass takes about 884 hours, roughly 37 days. That is longer than the 30-day window the feed covers, so a pass may not finish before its early pages go stale. This is a design decision (budget or window), not a bug fixed here.
- Recorded provider usage is 10 calls (sum of `ingest_runs.requests_used`). If the account is still on the 25-call test plan, 15 calls remain. The hourly schedule would use 144 a day and exhaust that in about 2.5 hours.

## Defects found and fixed

Each fix has a test that failed on `main` before the change and passes now.

| # | Defect | Effect | Fix |
|---|---|---|---|
| 1 | A failed store write still moved the feed cursor and watermark. | Listings from the failed pages could be skipped for weeks. At the next complete pass, still-live listings from those pages were closed as unseen. | Cursor and watermark move only when the write succeeded. After a failed write they stay put, so the next run fetches the same pages again. |
| 2 | Provider calls were written to the run only when the run finished. Runs that stopped never finished. | Calls from a stopped run were invisible to the allowance, and its row stayed `running` forever. | Each request is written to its run as it happens. Runs still `running` after 15 minutes are closed as `failed` with note `interrupted`. Their calls still count. |
| 3 | No lifetime cap. The allowance checks covered only minute, day, week and month. | A scheduled run on a 25-call test plan would keep calling until the provider refused. | New optional `ADZUNA_LIMIT_TOTAL` caps every request ever made. Unset means no lifetime cap. An unreadable value blocks calls rather than allowing them. New pending migration adds the total. |
| 4 | Two simultaneous starts (for example cron plus a manual run) could both pass the overlap check before either recorded a run. | Both could spend the same remaining allowance. | Each run is claimed first. Of the runs in progress, the lowest id proceeds and the others are refused with `409 run_in_progress`. |

Tests: `tests/job-ingest-worker.ts` now has 21 scenarios, all passing (the original 15 plus six). The new ones are: failed write leaves cursor and watermark; calls recorded mid-run; interrupted run closed and still counted; lifetime allowance enforced; unreadable allowance blocks; two simultaneous starts, only one proceeds.

Also passing: `tests/job-ingest.mjs` (24 of 24) and `deno check` on `supabase/functions/job-ingest/index.ts`.

The fake database in the Deno test was extended to match production behaviour for the new paths: a PATCH by filter, a lower-id claim filter, a lifetime-total RPC, and an injectable store failure. Production behaviour itself has not been exercised.

## Pending migration

`migrations/pending/20261017_ingest_total_allowance.sql` adds one function, `ingest_total_used(text)`. It is additive: no table, column, data or existing grant changes. It is executable by `service_role` only. Tested on a local PostgreSQL 17 cluster with a minimal `ingest_runs`: it sums the `adzuna` rows only, and `anon` and `authenticated` cannot execute it.

## Not changed

- **The hourly schedule** (`20261015_ingest_schedule.sql`) is left as it was. It needs `pg_net`, sends `budget: 6` every hour, and does not check the response of `net.http_post`. The health view flags a missing success only after one full day.
- **Pass length.** As above, one pass takes about 37 days at 6 requests an hour, against a 30-day window. Needs a budget or window decision.
- **Possible page-depth stall (not observed).** If the provider stops serving pages past some depth, each run restarts at page 1 and the pass never completes. The worker reports `provider_truncated` in that case, and no closures happen. Whether this happens is unknown; checking it needs provider calls, which were out of scope.
- **Budget exhausted during a retry** is reported as `source_429`. Only the wording is wrong.
- **Checkpoint saves** ignore errors. A lost save causes duplicate work, not missed listings.

## Exact remaining activation steps (owner)

Nothing below has been done.

1. **Decide the plan first.** A plan purchase or agreement is the owner's decision. Until then, do not schedule the worker.
2. **Merge** `claude/adzuna-scheduler-recovery` after review.
3. **Apply the migration** in the production SQL editor: the contents of `migrations/pending/20261017_ingest_total_allowance.sql`. Verify with `select public.ingest_total_used('adzuna');`, which should return the same figure as the recorded total (10 at the time of writing).
4. **Redeploy `job-ingest`** from the branch, using the same method as on October 15 (dashboard, or `supabase functions deploy job-ingest --no-verify-jwt`). Verify the boot without a provider call: a POST with no `x-ingest-secret` should return `401 unauthorised`. Do **not** send any request that includes the secret unless it is `dry_run` with `fixture_pages`. Every other request with the secret calls the provider.
5. **Set the lifetime allowance** as a function secret: `ADZUNA_LIMIT_TOTAL` = remaining calls. For the 25-call test plan with 10 recorded, that is `15`. Recompute from step 3 before setting it.
6. **Only then** decide on scheduling. On a test plan, do not enable `pg_net` or the hourly schedule. Use manual runs with an explicit small `budget`, and check `ingest_runs` and `ingest_feeds` after each run.
7. **If scheduling is approved on a paid plan:** enable `pg_net` (Dashboard, Database, Extensions), confirm the Vault secret `ingest_secret` exists, choose the budget and cadence against the plan's limits, then apply `migrations/pending/20261015_ingest_schedule.sql`. Remove or raise `ADZUNA_LIMIT_TOTAL` if the plan has no lifetime cap.
8. **Watch** `public.ingest_health` (`stale`, `blocked_runs_24h`) and confirm `ingest_feeds.next_page` advances between runs.
