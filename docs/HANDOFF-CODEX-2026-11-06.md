# Handoff to Codex — 2026-11-06 (from Claude, approved by Franklin)

**Action requested:** apply `migrations/pending/20261106_coverage_50_all_roles.sql` in the production Supabase SQL editor (project `hqgakkcxcyspqhnlnscv`). Franklin approved this on 2026-11-06 09:17 ET. Claude's database tool is not permitted to change cron jobs, so this needs you or Franklin.

**What it does:**
1. Unschedules `fortune-us-coverage-51-next-pass`. At ~216 Adzuna requests a day it would hit the 1,000-a-week allowance in about 2 days, and then the worker blocks itself.
2. Moves `job-ingest-us-it-feed-hourly` to every 6 hours with budget 1. It adds ~8 new jobs per request, versus 25–40 for targeted role × state requests.
3. Adds `fortune-us-coverage-50-all-roles`: every 20 minutes, one role × state below 50 jobs, never-tried cells first, across all 26 roles (the 8 non-IT roles currently have 0 everywhere), budget 1. DC is skipped: Adzuna returns 400 for its targeted query, and the boost has wasted 18 requests on it (see the doc).

That is about 76 requests a day: ~530 a week and ~2,300 per 30 days. Rollback is at the bottom of the file. The full analysis is in `docs/us-coverage-50-2026-11-06.md`.

**Do not:** change the worker code or secrets, or make manual provider calls.

**Report back:**
- the `cron.job` list;
- the first two `ingest_runs` from the new job (status, note, requests_used, inserted);
- the number of `ingest_coverage` cells with `fresh_distinct >= 50`. It was 62 of 1,326 at 14:10 UTC.
