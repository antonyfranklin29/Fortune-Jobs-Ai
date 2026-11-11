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
- 2026-11-11 Claude: wrote this handoff.
- 2026-11-11 Claude: added TONIGHT tasks A (visa/OPT filter) and B (application tracker), C later.
- 2026-11-11 Claude: added the 100-subscriber goal (no discounts) and tasks 5–8.
- 2026-11-11 Codex: Application tracker [PR #5](https://github.com/antonyfranklin29/Fortune-Jobs-Ai/pull/5) open. React tests, build and disposable PostgreSQL checks passed. Migration pending review.
