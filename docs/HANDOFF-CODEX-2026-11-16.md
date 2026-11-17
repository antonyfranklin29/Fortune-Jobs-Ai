# Handoff to ChatGPT / Codex — Nov 16, 2026: performance and reach review

Franklin asked Claude to work with Codex on **what we can do to improve fortunejobsai.com's performance and reach**.
Codex: please **audit first, build second**. Reply by appending a section **"Codex findings — <date>"** at the bottom
of this file: a ranked list (impact × effort) with evidence. Then build only the items Franklin approves, as PRs.
Claude reviews PRs and deploys after Franklin approves. Never commit keys. Keep claims honest: no "straight from employers",
no "skip the middleman", no fake testimonials or reviews, and no fabricated numbers.

## Where things stand (Nov 16)
- **Traffic goal:** 100 Pro subscribers by Jan 29, 2027. Audience: U.S. college students, new grads, international students (OPT).
- **Catalogue:** about 17,300 open jobs (Adzuna plus our own ingest), plus Live Search (Jooble, WhatJobs, Adzuna live).
  Growth slowed to +60–280 a day net, because closures roughly match new jobs. Partner feeds are pending: NLx (paused intake),
  Jobg8 (account manager contacting us), Appcast, Talent.com, The Muse (API dead).
- **SEO:** 627 generated pages under /jobs/ (role × city/state); 271 URLs in sitemap.xml (pages with < 5 jobs are noindex).
  Each page shows a market snapshot (pay p25–p75, top companies), JobPosting and Breadcrumb JSON-LD, and related links.
  Daily rebuild workflow `job-seo-refresh.yml`, with IndexNow ping to Bing after publish. Google Search Console and
  Bing Webmaster are both verified. Google validated the indexing fix on Nov 15.
- **App:** React + Vite (`react/`), 15 HTML entry points copied to the repo root, GitHub Pages hosting, Cloudflare in front
  (Web Analytics beacon on all pages), Supabase backend.
- **Bundle (gzip, from `npm run build`):** a shared chunk `jsx-runtime-*.js` is **119 KB**, `mammoth.browser` is 84 KB,
  and `resumeMatching-*.js` (43 KB) is **duplicated in 4 chunks**. These are worth checking first.
- **Social:** daily automatic posts via Make (Instagram @fortunejobs_ai, Facebook page, LinkedIn company page).
  The "What makes FJA different" series is queued for Jan 4. The footer has social icons.
- **Outreach:** 21 university career centers emailed so far. An automatic daily batch of ~15 runs until 100.
- **Signup prompt** on results pages for logged-out users (`SignupNudge`).

## Questions for Codex
### A. Performance (Core Web Vitals on mobile)
1. Run PageSpeed Insights / Lighthouse (mobile) on: `/`, `/results.html?mode=quick&q=data%20analyst&location=Texas`,
   `/jobs/software-engineer/texas/`, `/resume-search.html`, `/resume-builder.html`. Record LCP, INP, CLS and the main opportunities.
2. Why is `jsx-runtime-*.js` 119 KB gz? Find what's bundled into it (supabase-js? icons?) and propose a split.
   Make sure `mammoth` and `resumeMatching` load only on the pages and actions that need them, with no duplicate copies.
3. Fonts, images (og/logo/social images), caching headers via Cloudflare, preconnect to Supabase, and the cost of the
   first results render.
4. Static /jobs/ pages: check that they're fast and crawlable without JS, and what `jobs/live.mjs` costs.

### B. Reach (free first, then cheap)
1. **Google:** what keeps more of the 627 pages from being indexed? Look at content uniqueness, internal linking,
   thin pages, canonical tags and sitemap hygiene. Should we add more roles/cities, or improve the existing ones first?
   Do NOT propose adding Google for Jobs (JobPosting) markup: Franklin decided against it.
2. **New free page types** with real search demand that we can fill honestly: e.g. "entry-level <role> jobs in <state>",
   "remote <role> jobs", company pages ("<company> jobs" for top hiring companies), a salary page per role.
   Only where the data supports ≥ 5 real listings.
3. **Shareability:** share buttons on job pages, a better og:image per page (role + city + count), and a "send me jobs like
   this" alert signup on /jobs/ pages to turn search traffic into accounts.
4. **Student channels** beyond career centers: Handshake employer/partner options, subreddit-friendly free tools,
   student org newsletters, Product Hunt / BetaList launch, free directory listings. Give honest pros and cons.
5. **Conversion:** where visitors drop between landing → search → signup → Pro (use Cloudflare Analytics + Supabase:
   search_history, profiles, subscriptions). Suggest 3 experiments.

## Rules
- Free / low cost first. Franklin approves anything that goes live or costs money.
- Don't touch the Make scenarios, Stripe, auth or migrations without flagging it; Claude handles those.
- `npm test` and `npm run build` must pass for every PR.

## Log
- 2026-11-16 Claude: created this handoff.
