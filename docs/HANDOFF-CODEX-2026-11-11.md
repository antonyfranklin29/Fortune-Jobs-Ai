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

## Rules
- Work on a branch and open a PR. Don't push to `main`, don't touch Make.com, don't post anywhere.
- Never commit keys, tokens or passwords. Don't publish EIN/tax IDs or personal names.
- Keep `social/posts.json` ids 0–51 and `social/reels/` 0–51 unchanged.

## Log
- 2026-11-11 Claude: wrote this handoff.
- 2026-11-11 Codex added student and new-grad photos and captions for IDs 52–81 on `codex/student-social-posts`. All 30 JPEGs and five-tag captions passed checks, and IDs 0–51 were preserved.
- 2026-11-11 Codex rendered and verified Reels 52–81 with licensed stock photos, the original loops and spinning-logo outro. Six have captioned local AI narration. Both Reel feeds were appended on `codex/student-reels`.
- 2026-11-11 Codex added ten link-free Reddit answers and the “7 ATS mistakes” post for manual use on `codex/reddit-drafts`.
