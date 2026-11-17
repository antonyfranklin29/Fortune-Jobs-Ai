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

## Part 2 — Remote jobs from Remotive and Himalayas (Franklin, Nov 17: "add remote jobs too, to our database from remotive and himalayas")
Add **all remote jobs** from these two sources to `pre_scraped_jobs`. This is NOT a U.S.-only remote section.
Store every remote job, but show its real eligibility on the card so students aren't misled
(e.g. "Remote · Worldwide", "Remote · USA only", "Remote · Europe only"), using the source's own text. Never guess.

| Source | Endpoint | Key | Terms (read by Claude Nov 17 2026) |
|---|---|---|---|
| **Remotive** | `https://remotive.com/api/remote-jobs` | none | Link back to the Remotive job URL and name "Remotive" as the source. **Show jobs only after a 24-hour delay.** At most 4 fetches a day; over 2 requests/minute gets blocked. Never pass them to other job sites, Google Jobs or LinkedIn (so no JobPosting JSON-LD, sitemap or feeds). Their terms say displaying jobs "to collect signups or email addresses" breaks them, so Remotive jobs must **never be gated behind sign-up**, and Franklin should get written OK from hello@remotive.com (Claude will draft the email). Until that OK arrives, build it behind a config flag that is **off**. |
| **Himalayas** | `https://himalayas.app/jobs/api` (full feed, cursor, limit 20) or `/jobs/api/search` | free key optional (60 req/min); keyless works on a shared allowance | Use `applicationLink` unchanged and show a visible "via Himalayas" link. Show jobs only on our own site. **No JobPosting JSON-LD, sitemap, feeds or Google Jobs.** Remove jobs when expired. Poll once a day (data refreshes daily). Call from the backend only (no CORS). |

Rules:
1. `is_remote=true`, `work_mode='remote'`. Set `state_code` only if the job names one U.S. state; otherwise `null`.
   `location` = the source's eligibility text (e.g. "Remote · Worldwide").
2. The same title → role rules apply (`config/job-roles.json`). Store jobs with no role match with `canonical_role=null`, so
   they're searchable but don't count toward role pages.
3. `attribution` = 'Remotive' / 'Himalayas'. The job card shows "via Remotive" / "via Himalayas" with a normal followed
   link to the source job page.
4. Exclude both sources from JobPosting markup, sitemap.xml, IndexNow pings and any outbound feed or partner export.
   Generated /jobs/ pages may count them only if they are not shown in indexable markup; simplest is to exclude them there too.
5. Close jobs that disappear from the feed or have expired (the Himalayas status endpoint returns 410 for closed jobs).
6. Dedupe against existing rows and across the two sources.
7. Tests for the 24-hour delay, the Remotive flag, attribution, exclusions and dedupe. Report expected jobs per role per source.

## Rules
- Franklin decided (Nov 17): do NOT add Google for Jobs / JobPosting markup for any job from any source.
- Free public feeds only (they exist so companies can show their jobs elsewhere). Respect robots/terms.
- Every kept job links to the employer's own posting. Honest data only: no padding and no invented locations.
- Don't touch Stripe, auth, migrations or Make.com. Claude reviews, Franklin approves, then Claude deploys
  the edge function.

## Log
- 2026-11-17 Claude: created this handoff.
- 2026-11-17 Claude: Part 2 rewritten per Franklin: all remote jobs from Remotive + Himalayas (not U.S.-only). Remotive stays behind a flag until they confirm in writing.
