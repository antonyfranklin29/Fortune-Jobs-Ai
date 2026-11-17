# Handoff to Codex — Nov 17, 2026: more company career boards (free job sources)

Franklin approved this ("start job sources"). **Goal:** fill more role × state combinations toward
**50+ open jobs for the top 10 roles in the top 20 states**. Today 80 of 200 are full (about 68% of the jobs needed).
Data-heavy and analyst roles in mid-size states are the biggest gaps.

## What exists
- `supabase/functions/ats-ingest/` reads public, keyless career-board feeds. `ats.mjs` has the
  providers (greenhouse, lever, ashby, smartrecruiters, workable, breezy) and `boards.mjs` has the company list.
- Today there are **191 boards**: greenhouse 93, ashby 39, breezy 40, lever 13, smartrecruiters 4, workable 2.
- Jobs are kept only when the title matches a role in `config/job-roles.json` and the location gives a U.S. state.
- Claude is separately adding USAJOBS Nurse (0610) and Accounting (0510) series (branch `job-sources`).

## Your tasks (one PR)
1. **Grow `boards.mjs` to 600+ boards.** Prioritise U.S. companies that hire analysts, data, BI, QA,
   cloud, cybersecurity and project/product roles across many states: banks, insurers, consulting,
   healthcare tech, retail/e-commerce HQs, logistics, government contractors (Booz Allen, Leidos, SAIC and
   similar, if they use one of these ATSs) and mid-size SaaS. Lever, SmartRecruiters and Workable are
   under-used, so add many more there.
2. **Check every board:** write `scripts/check-boards.mjs` to fetch each feed once, then keep only boards
   that answer 200 with ≥ 1 U.S. job. Print a table of slug → total jobs, U.S. jobs and role-matched jobs.
   Update `checked` in boards.mjs.
3. **Add the Recruitee provider** (`https://<slug>.recruitee.com/api/offers/`) with `listOf`/normalize
   rules and tests, the same way Breezy was added.
4. **Be polite to providers:** keep the worker's per-run request budget and delays. If 600 boards don't fit in one run,
   rotate through them across runs (e.g. a cursor stored in `ingest_runs` or a deterministic slice by hour).
   No API keys, no scraping of HTML pages, and nothing behind logins.
5. **Tests:** `npm test` and the deno tests for ats-ingest must pass. Add tests for Recruitee and the rotation.
6. In the PR description, report the expected added U.S. jobs per role from the check script.

## Rules
- Free public feeds only (they exist so companies can show their jobs elsewhere). Respect robots/terms.
- Every kept job links to the employer's own posting. Honest data only: no padding and no invented locations.
- Don't touch Stripe, auth, migrations or Make.com. Claude reviews, Franklin approves, then Claude deploys
  the edge function.

## Log
- 2026-11-17 Claude: created this handoff.
