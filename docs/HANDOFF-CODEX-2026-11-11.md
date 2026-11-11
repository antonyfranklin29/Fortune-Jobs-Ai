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

## NOW #1 — Cloudflare Web Analytics on every page (Franklin approved Nov 11 3:31 PM; quick)
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
4. **WhatJobs** (after publisher approval; secret `WHATJOBS_API_KEY` / feed URL): follow
   https://www.whatjobs.com/xml-feed-specification. Prefer the XML feed → filter to U.S. + our roles + posted ≤30 days →
   upsert into pre_scraped_jobs with source `whatjobs`, keep their tracking apply URL, close jobs missing from the feed.
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
