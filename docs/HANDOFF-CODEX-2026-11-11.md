# Handoff to ChatGPT / Codex — Nov 11, 2026

Franklin wants Claude and ChatGPT to work **in parallel** and to **save Claude credits**: from now on ChatGPT
takes the forward/bulk work below; Claude keeps reviews, live deploys and quick checks. Both keep this file
current (append a dated line under "Log" when you finish something). Franklin approves anything that goes live.

## What changed Nov 9–11 (already live)
- **Social:** 52 photo posts (`social/posts.json`, ids 0–51) and 52 Reels (`social/reels/`, `social/reels.json`,
  `social/reels-feed.json`). Every caption has exactly **5 hashtags** (Instagram's limit).
- Every Reel ends with the brand outro (spinning gold logo, glow, twinkle + coin sound):
  `scripts/render-reels/outro.py` + `add_outro.py` (run after `render.py`).
- **Posting schedule (Make.com, org timezone America/Chicago):**
  - Photo posts: daily 12:00 PM and 8:30 PM ET (scenario 6971973).
  - Reels: daily 7:00 PM ET (scenario 6974849).
  - Reddit: nightly 11 PM ET to u/FortunejobsAI (scenario 6989988, **inactive** until Reddit API approval,
    ticket R57MEK-G1E7R).
  - Formulas are documented in `social/README.md`. Only append to posts/reels; never reorder or change ids.
- **Site:** Pro shows 50+ results per search (up to 100); welcome email says 50+; Stripe receipts are on;
  apply-by-email for employers; Employer Plus; ATS score in the résumé builder and upload page; SEO tags,
  sitemap and og-image.
- **Brand:** gold rounded square, rising line with 4 dots (`favicon.svg`). Navy #10243b, blue #174c78,
  gold #D4A843, font Inter. Facebook Page and Reddit profile are set up.

## Your tasks (ChatGPT/Codex), in order
1. **Next 30 posts (ids 52–81)** before ~Dec 5, when the photo rotation (2/day) wraps. Audience: U.S. college
   students, new grads, bachelor's students and job seekers. Same format, 5 hashtags each (topic tags first,
   then #jobsearch/#careeradvice/#hiring/#collegestudents/#newgrad). Honest claims only.
2. **Next 30 Reels (ids 52–81)** before ~Dec 31. Same specs (1080×1920, ~10 s, original music only, outro).
   Franklin wants a **professional, decent look with people's faces** (licensed stock photos only, never
   presented as real users or testimonials) and an **AI voiceover on some** (clear, neutral narrator, no
   imitation of real people; show the script as on-screen captions too).
3. **Reddit content:** 10 helpful answers for r/resumes and r/jobs, and one value post ("7 ATS mistakes")
   for Franklin to paste by hand — no links in the first 2 weeks. Put them in `social/reddit/drafts.md`.
4. **Free-traffic SEO:** city/role landing pages (e.g. "Data Analyst jobs in Raleigh, NC") generated from
   live jobs, plus Google for Jobs `JobPosting` markup. Keep pages honest and noindex any page with < 5 jobs.

## NOW #3 — More Google job pages (Franklin chose this Nov 12, 9:54 AM ET). Top priority today.
The generator already exists: `scripts/build-job-seo.mjs` (6 cities × 4 roles = 24 pages under /jobs/, `jobs/live.mjs`
refreshes listings in the browser, pages with < 5 jobs are noindex). Extend it, don't rewrite it:
1. **State pages:** add `/jobs/<role>/<state>/` (e.g. /jobs/software-engineer/texas/) for every role × state that has
   **≥ 40 open jobs** (about 40 pages today; open-job counts on Nov 12: software-engineer CA 949, TX 329, NY 294, VA 196,
   WA 186, MD 185, NC 125, NJ 122, FL 118, MA 114, IL 110, CO 100; qa-engineer CA 163; ML engineer CA 143, VA 107,
   NY 92; data-scientist VA 122, CA 112, NY 74; product-manager CA 118; devops CA 107, VA 98, MD 88; data-analyst VA 102,
   TX 85; full-stack VA 99, NY 82; business-analyst VA 87, IL 80, CA 77; data-engineer VA 76, TX 74; servicenow VA 83;
   cybersecurity VA 80). Pick the list from the data at build time with the same ≥ 40 rule, not hard-coded.
2. **More roles on city pages:** use every role in the taxonomy (26 roles), keep the < 5 jobs → noindex rule.
3. **More cities:** add Dallas TX, Houston TX, Charlotte NC, Atlanta GA, Boston MA, Washington DC, Jersey City NJ,
   Newark NJ, Arlington VA, Los Angeles CA, San Jose CA, Denver CO, Phoenix AZ.
4. **Each page:** unique title + meta description with the real count ("124 Software Engineer jobs in Texas"),
   a 2–3 sentence honest intro, links to the related city/state pages, `JobPosting` JSON-LD only for jobs whose
   detail page we host, breadcrumb JSON-LD. Add every indexed page to sitemap.xml; update /jobs/ index by state.
5. **Do NOT** make "OPT / visa sponsorship" pages yet: only ~6 jobs are tagged sponsors/opt, too thin.
6. **Keep fresh:** add a GitHub Actions workflow that rebuilds the pages daily (reuse catalogue-health.yml's
   Supabase read setup) and opens a PR or commits only generated files. No keys in the repo.
7. Tests for the ≥ 40 rule, noindex rule, sitemap, and JSON-LD; `npm test` + build must pass.
Open a PR; Claude reviews and deploys after Franklin approves.

## NOW #1 (DONE) — Cloudflare Web Analytics on every page (Franklin approved Nov 11 3:31 PM; quick)
The beacon `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"5e0de46ee5d94ffa87d7f7d4363a4b3d"}'></script>`
(public site token, already on about/contact/find-jobs etc.) is missing on: apply, email-preferences, employer-login,
employers, login, profile, results, resume-builder, resume-search, and all generated /jobs/ city pages (add it to
scripts/build-job-seo.mjs). Put it in the react/*.html sources (and seo.cjs if that's the right place) so builds keep it.
Add a check in react/scripts/check-dist.cjs that every built page has the beacon. One small PR; Claude deploys.

## NOW #2 — Careerjet live search
Franklin created a Careerjet publisher account; the key is already a Supabase secret `CAREERJET_API_KEY` (never print or commit it).
Careerjet's API requires the end user's `user_ip` and `user_agent`, so it is for LIVE searches, not batch ingestion:
- New edge function `supabase/functions/careerjet-search/` (verify_jwt false, CORS for fortunejobsai.com): takes
  `{q, location, page}`; reads the caller IP from `x-forwarded-for` and the browser `user-agent`; calls
  `https://search.api.careerjet.net/v4/query` (check the current endpoint in Careerjet's docs) with Basic auth
  (key as username, empty password), `locale_code=en_US`, `page_size` 20; returns title, company, location, date,
  salary, short description and the Careerjet click URL. Timeout 5 s; on any error return `{jobs: []}` so search never breaks.
  Do NOT store results in the database (Careerjet's model is live display). Cache identical queries in memory ≤10 min at most.
- Frontend: on the results page, below our own results, a "More jobs from Careerjet" section (logo/credit "Jobs by
  Careerjet" linking to careerjet.com, as their terms ask), loading after our results so it never slows them.
  Links open in a new tab with rel="nofollow sponsored noopener".
- Tests: unit tests for the response mapping and error fallback; no real key in tests.
- Privacy Policy (react source of privacy.html, plus any parity fixture): add one sentence, e.g. "When you search, your search
  words, IP address and browser type are sent to our job partners (such as Careerjet) to show live results and prevent
  fraud. We never send your name, email, résumé or account details." Franklin approved this wording on Nov 11.
- One PR; do not deploy. Claude reviews and deploys the function and site after Franklin's OK.

## NEXT — more job sources (Franklin, Nov 11 4:48 PM: "add everything")
Build each as its own PR, same pattern as Careerjet. Never commit keys; Franklin adds them as Supabase secrets.
3. **Jooble** (after Franklin's key arrives; secret `JOOBLE_API_KEY`): POST `https://jooble.org/api/{key}` with
   `{keywords, location, page}`. Read Jooble's terms when the key arrives: if storing is allowed, add an `ingest`
   source like Adzuna (role × state, nightly, budget-limited); if not, live search like Careerjet. Always link out via
   the URL Jooble returns; credit "Jobs by Jooble".
4. **WhatJobs — NOW (Franklin's U.S. publisher account is live, publisher ID 7594, site www.whatjobs.com).**
   No API key and no IP whitelist: GET `https://api.whatjobs.com/api/v1/jobs.json` with `publisher=7594`,
   `user_ip` (mandatory, the visitor's IP), `user_agent`, `keyword`, `location`, `radius`, `limit` (≤50, default 20), `page`.
   200 = ok, 422 = bad params, 503 = maintenance. Response `data[]`: url, title, company, location, postcode, snippet
   (contains `<span class="highlighted">` — strip HTML), salary, job_type, age, age_days. It's a LIVE per-visitor feed with
   click tracking in `url`, so build it like Jooble: a `whatjobs-search` edge function on the shared live-job-partner
   handler (keep publisher ID in env `WHATJOBS_PUBLISHER_ID`, default 7594), a "Search WhatJobs" button/section with
   "Jobs by WhatJobs" credit, links open the returned `url` unchanged (their URL Validator checks tracking). Don't store.
   Also optional later: their `unique_id` param can feed daily job-alert emails without repeats.
5. **Breezy HR employers** (no key): add a `breezy` provider to `supabase/functions/ats-ingest/ats.mjs` using each
   company's public `https://{slug}.breezy.hr/json` list; add 30–50 U.S. employer slugs to boards.mjs (verify each
   returns U.S. jobs); same role filter as other providers; tests with fixtures.
6. **Jobg8** — later, once traffic analytics show steady visitors; just prepare `docs/outreach/jobg8.md` (what to send).
Skip: Lensa (employer ad product, no confirmed publisher feed), CalJOBS/state "open data" (not a real job API; states
come via NLx), Indeed/ZipRecruiter/Workday (closed to small sites).

## TONIGHT — top priority (Franklin approved Nov 11, 00:32 ET): build these two first, then continue the list
A. **Visa / OPT-friendly filter** on search results.
   - Classify each job from its title + description into `sponsorship`: `sponsors` (e.g. "H-1B sponsorship available",
     "will sponsor", "visa sponsorship provided"), `opt_friendly` ("OPT", "CPT", "STEM OPT", "F-1 students welcome"),
     `no_sponsorship` ("no sponsorship", "must be authorized to work without sponsorship", "US citizens only",
     "security clearance required"), else `unknown`. Negations win over positives ("unable to sponsor" = no_sponsorship).
   - Store it on `pre_scraped_jobs` (new nullable column + backfill function) via a migration in
     `migrations/pending/`, and set it on insert in the ingest paths (shared helper, unit-tested with ≥20 real-style phrases).
   - UI: a "Work authorization" filter (Any · Sponsors visa · OPT/CPT friendly · Hide "no sponsorship" jobs) and a small
     badge on job cards. Wording must be honest: "Mentions visa sponsorship" / "Mentions OPT/CPT" — never promise a job sponsors.
B. **Application tracker** for signed-in users' saved jobs.
   - Stages: Saved → Applied → Interview → Offer → Rejected, with date changed and an optional note (≤500 chars).
   - Extend the existing saved-jobs table/RLS (migration in `migrations/pending/`, row-level security: owner only).
   - UI on the profile/saved-jobs page: stage dropdown per job, counts per stage at the top, filter by stage.
Both: tests (unit + SQL where relevant), build passes, one PR each. Do NOT apply migrations or deploy; Claude reviews in the
morning and deploys after Franklin's OK. Append a Log line when each PR is open.
C. (After A and B, lower priority) "Fix my résumé" button after the ATS score: uses the existing AI Coach to rewrite weak
   lines, add missing job keywords and switch to the ATS-safe layout in the résumé builder.

## Goal (Franklin, Nov 11): 100 paying Pro subscribers by Jan 29, 2027
Pro stays **$9.99/month — no discounts, coupons or founding prices.** Grow through free traffic and value instead.
Extra tasks after #1–4:
5. Shareable ATS score card ("My résumé scored 87/100 on Fortune Jobs AI") with an Open Graph image.
6. (On hold — Franklin said "not yet": no referral rewards or free months. Don't build.)
7. Drafts for 20 college career-center emails (NC/NJ first: ECU, NC State, UNC, Rutgers, NJIT…) in `docs/outreach/career-centers.md`.
8. Product Hunt launch kit (tagline, description, 5 screenshots, first comment) in `docs/launch/product-hunt.md`.

## Rules
- Work on a branch and open a PR. Don't push to `main`, don't touch Make.com, don't post anywhere.
- Never commit keys, tokens or passwords. Don't publish EIN/tax IDs or personal names.
- Keep `social/posts.json` ids 0–51 and `social/reels/` 0–51 unchanged.

## Log
- 2026-11-11 Codex: City and role SEO [PR #7](https://github.com/antonyfranklin29/Fortune-Jobs-Ai/pull/7) open. Generated 24 pages and tested Google for Jobs markup with fixtures. No eligible live posting was present for Google validation.
- 2026-11-11 Claude: wrote this handoff.
- 2026-11-11 Claude: added TONIGHT tasks A (visa/OPT filter) and B (application tracker), C later.
- 2026-11-11 Codex: Work authorization filter [PR #6](https://github.com/antonyfranklin29/Fortune-Jobs-Ai/pull/6) open. React tests, build and disposable PostgreSQL checks passed. Migration pending review.
- 2026-11-11 Claude: added the 100-subscriber goal (no discounts) and tasks 5–8.
- 2026-11-11 Codex added student and new-grad photos and captions for IDs 52–81 on `codex/student-social-posts`. All 30 JPEGs and five-tag captions passed checks, and IDs 0–51 were preserved.
- 2026-11-11 Codex rendered and verified Reels 52–81 with licensed stock photos, the original loops and spinning-logo outro. Six have captioned local AI narration. Both Reel feeds were appended on `codex/student-reels`.
- 2026-11-11 Codex added ten link-free Reddit answers and the “7 ATS mistakes” post for manual use on `codex/reddit-drafts`.
- 2026-11-11 Claude: added NOW #1 analytics-on-all-pages and NOW #2 Careerjet tasks.
- 2026-11-11 Claude: deployed posts/reels 52–81, Reddit drafts, city/role pages (PR #2–4, #7) and the visa/OPT filter (PR #6; migration applied, 16,731 jobs classified). Tracker (PR #5) waits on its migration.
- 2026-11-11 Codex: Add Cloudflare Web Analytics to every site page ([PR #8](https://github.com/antonyfranklin29/Fortune-Jobs-Ai/pull/8)). React build and generated page checks passed.
- 2026-11-11 Codex: Add Careerjet live partner results and privacy disclosure ([PR #9](https://github.com/antonyfranklin29/Fortune-Jobs-Ai/pull/9)). Mocked provider, privacy parity and React build checks passed.
- 2026-11-11 Codex: Add Jooble on-demand live partner results ([PR #10](https://github.com/antonyfranklin29/Fortune-Jobs-Ai/pull/10)). Live display only. Mocked provider, privacy parity and React build checks passed.
- 2026-11-11 Claude: deployed analytics (#8), Careerjet (#9) and Jooble (#10). Jooble live search works (20 real jobs for "registered nurse, Raleigh NC"). Careerjet API refuses our calls ("Unauthorized access from IP"): Careerjet requires declared fixed server IPs and does not support serverless. Franklin decided to SKIP Careerjet for now. TODO (small PR): stop calling careerjet-search from the results page (feature flag off) so we don't waste requests; keep the code for later.
- 2026-11-11 Codex: Pause Careerjet calls from search results ([PR #11](https://github.com/antonyfranklin29/Fortune-Jobs-Ai/pull/11)). React build and privacy parity passed. The active results bundle omits the Careerjet endpoint.
- 2026-11-11 Codex: Add on-demand WhatJobs publisher search ([PR #12](https://github.com/antonyfranklin29/Fortune-Jobs-Ai/pull/12)). Mocked partner tests, privacy parity and production build passed.
- 2026-11-11 Codex: Add 40 verified Breezy HR career boards ([PR #13](https://github.com/antonyfranklin29/Fortune-Jobs-Ai/pull/13)). 40 verified public boards; 370 eligible rows in the read-only check. ATS tests and React build passed.
- 2026-11-11 Claude: deployed #11 (Careerjet off), #12 WhatJobs (whatjobs-search v3; fixed: API answers via same-host redirect, so redirect:'follow' + host check — live test 6 jobs for customer service Raleigh), #13 Breezy (ats-ingest v9, 40 boards; one-off run of all 4 parts).
- 2026-11-11 Codex: Application tracker [PR #5](https://github.com/antonyfranklin29/Fortune-Jobs-Ai/pull/5) open. React tests, build and disposable PostgreSQL checks passed. Migration pending review.
- Nov 12 (Claude): tracker migration applied (no backfill; 0 saved jobs) and PR #5 live (347a433). Breezy: 370 jobs on first run. Added NOW #3 (Google job pages). Career-center outreach email drafted by Claude (Franklin approves list before sending).
- 2026-11-12 Codex: Expand Google job search pages by state and city ([PR #14](https://github.com/antonyfranklin29/Fortune-Jobs-Ai/pull/14)). 132 state pages and 494 city pages; SEO checks and React build passed. Root suite matched the 31 failures on unchanged main.
