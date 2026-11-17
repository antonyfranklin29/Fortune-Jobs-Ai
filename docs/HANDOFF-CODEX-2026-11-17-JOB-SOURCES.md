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

## Part 2 — Remote-only jobs (Franklin asked Nov 17: "pull remote only jobs we need to fill that section too")
We have **632 open remote jobs** today. Add remote-job feeds as a separate ingest (or new providers),
keeping each source's terms. Claude read them on Nov 17 2026:

| Source | Endpoint | Key | Terms we must follow |
|---|---|---|---|
| **Jobicy** | `https://jobicy.com/api/jobs` (7-day window, 100/page) | none | Aggregators are allowed. Credit "Jobicy" on every listing and keep apply links to the Jobicy job page. Poll at most hourly, a few times a day, at a random minute (not :00). Mark jobs closed only on an explicit closed status (`/api/jobs/status?ids=`). |
| **Remote OK** | `https://remoteok.com/api` (skip the first element, which is the legal notice) | none | Credit "Remote OK" with a normal **followed** link (no nofollow) to the Remote OK job URL. Don't use their logo. A few polls a day. |
| **Himalayas** | `https://himalayas.app/jobs/api/search` (limit 20, cursor) | free key (Franklin to sign up; Claude can't create accounts) | Use `applicationLink` unchanged and credit Himalayas visibly. Show jobs only on our site. **Never put these jobs in JobPosting JSON-LD, the sitemap, feeds or Google Jobs.** Remove jobs when expired. Data refreshes daily, so poll once a day. |
| ~~Remotive~~ | — | — | **Skip.** Its terms forbid showing jobs to collect signups (our site has a signup prompt) and require a 24-hour delay. |

Rules for remote jobs:
1. Keep only jobs **open to U.S. applicants**: location/eligibility says USA, United States, US-only, North America
   or Worldwide/Anywhere. Reject EU-only, LATAM-only and other regions. Never guess.
2. Set `is_remote=true`, `work_mode='remote'`, `state_code=null` (the column is nullable), and `location='Remote (US)'`
   or the source's own text. Don't invent a state.
3. The same title → role rules apply (`config/job-roles.json`). Reject titles with no role.
4. Add a per-source `attribution` value and make sure the job card shows "via Jobicy / Remote OK / Himalayas"
   with the required link type. Exclude Himalayas rows from JobPosting markup, sitemaps and any outbound feed.
5. Dedupe against existing rows (the same job often appears on several boards).
6. Check that the site's Remote filter / "remote" searches return these jobs. Consider a `/jobs/remote/<role>/`
   page per role with ≥ 5 jobs, but **exclude Himalayas jobs from those indexable pages**.
7. Tests for the eligibility filter, attribution and exclusions. Report expected U.S.-eligible remote jobs per role per source.

## Rules
- Free public feeds only (they exist so companies can show their jobs elsewhere). Respect robots/terms.
- Every kept job links to the employer's own posting. Honest data only: no padding and no invented locations.
- Don't touch Stripe, auth, migrations or Make.com. Claude reviews, Franklin approves, then Claude deploys
  the edge function.

## Log
- 2026-11-17 Claude: created this handoff.
- 2026-11-17 Claude: added Part 2 (remote-only feeds; Remotive skipped for its terms).
