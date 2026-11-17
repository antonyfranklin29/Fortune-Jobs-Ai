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
   Check Google for Jobs eligibility of our JobPosting markup.
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

## Codex findings — 2026-11-17

### Mobile measurements

One cold navigation per production URL in Lighthouse 13.6.0 using mobile simulated throttling. LCP and CLS are lab results. The keyless PageSpeed Insights endpoint returned HTTP 429. Field INP is unavailable, and TBT below is the lab blocking-time measure. Repeat runs and verify mobile field p75 before setting a performance target.

| Production page | Score | LCP | CLS | INP | TBT | Main observation |
|---|---:|---:|---:|---|---:|---|
| Home | 99 | 1.7 s | 0.000 | Unavailable | 0 ms | 78 KiB estimated unused JS |
| Quick Match for Data Analyst in Texas | 99 | 1.7 s | 0.000 | Unavailable | 10 ms | 77 KiB estimated unused JS, three sequential catalogue reads |
| Texas Software Engineer area page | 100 | 0.9 s | 0.000 | Unavailable | 40 ms | List is in the HTML. Live refresh fetches about 17 KiB |
| Résumé Search | 100 | 0.9 s | 0.000 | Unavailable | 40 ms | 86 KiB estimated unused JS |
| Résumé Builder | 99 | 1.6 s | 0.000 | Unavailable | 0 ms | 84 KiB estimated unused JS |

### Ranked by impact and effort

1. **Improve existing job pages and internal links (high impact, medium effort).** The repo has 627 generated pages, 364 explicitly noindex. The live sitemap contains 263 jobs URLs and eight general URLs, with zero duplicate entries. All 627 generated pages had unique self-canonicals. The generator requires five verified jobs for a city and 40 for a state. That explains which URLs the site elects to submit. Search Console Page Indexing and URL Inspection are needed to learn why Google omits particular eligible URLs. Start with ten high-impression role/state pages. Give each a local snapshot with dated counts, pay sample size and links to useful city pages. Link the Jobs hub and strongest state pages from Home and Find Jobs. Use lastmod for meaningful changes. Inspect the eligible cohort before adding cities or roles. [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)

2. **Shorten time to the first usable Quick Match list (high impact, medium effort).** The tested route finished three catalogue reads around 1.67 s, 2.27 s and 2.89 s from navigation, transferring 98 KiB in total. Lighthouse LCP was 1.7 s while catalogue activity continued. ResultsPage waits on mySubscription before Quick Match, and catalogue.js can wait on city and source-diversity reads after the first batch. Start the primary request alongside the subscription check, apply known region filters before the candidate cap, and render the first useful batch while optional enrichment runs. Keep selected rows stable. Fetch full descriptions when selected and test ranking and fit parity. Measure navigation-to-first-card and search-submit-to-first-card p50/p75, with empty and failed results reported separately.

3. **Measure the funnel and run three low-cost experiments (high impact, low-to-medium effort).** This audit had no authenticated Cloudflare Analytics or Supabase reporting session, so drop-off is unmeasured. Use Cloudflare for route traffic and referrers. ResultsPage records search_history for signed-in users, missing guest searches. Use authorized Supabase reporting to aggregate profiles and first paid subscription transitions by week, joining by user ID inside the database. Add privacy-preserving counts for search submitted, results shown, signup started, signup completed and first paid activation. Exclude test users and duplicates. Avoid collecting raw queries, résumé content or sponsorship details.
   - Test a prefilled role search for student landing traffic. Measure landing-to-results and guard against more empty results.
   - Test a save or alert invitation after users see results against the current signup nudge. Measure signups per results session, Apply clicks and repeat searches. Keep results and Apply open to guests.
   - Test showing Pro after users have seen an available benefit such as expanded results. Measure paid activations in seven days, checkout abandonment and cancellations. Set sample sizes and stop dates before evaluating lift.

4. **Split by route and action, then tune caching (medium impact, medium effort).** The Vite build reports 68.5 kB gzip for jsx-runtime and 55.4 kB separately for Supabase. The served jsx-runtime contains React DOM. The 119 KB single chunk in the handoff did not reproduce. The four React pages start with approximately 178–192 KiB gzip of JavaScript before the analytics beacon and data. Home preloads ResultsPage and ProCard dependencies. Both résumé routes import both screens through resume-entry. Their current HTML references one shared 44.3 kB gzip resumeMatching chunk. Older hashes are present in dist because sync-static copies the root assets directory. Keep React DOM shared, split the two résumé screens, and defer Supabase and the matching code where the initial anonymous view can use a public fetch or wait for actions. Check guest fit and print parity. Mammoth already loads on DOCX use and did not appear in any initial waterfall. Keep that boundary for its 87.8 kB gzip chunk.

   Home and results fetched about 48–49 kB of Inter font data and already preconnect to the font hosts. Compare a local Latin variable font or fewer weights. Test a Supabase preconnect where catalogue fetches begin immediately. The OG image is 73.7 kB and the newsletter logo is 9.3 kB raw. The OG image did not load in these navigation waterfalls. Sampled HTML and hashed JS returned max-age=600. The Cloudflare beacon was visible. Responses did not expose CF-Cache-Status, so verify edge behavior before changing TTLs. Use longer immutable lifetimes for fingerprinted bundles and short lifetimes for HTML. Keep logo dimensions stable and lazy-load below-fold logos.

5. **Keep area pages static and validate single-job eligibility (medium impact, low-to-medium effort).** The Texas sample returned HTTP 200, a self-canonical, a static list, and a title reporting 336 jobs. The HTML is about 2.8 kB gzip. The live module is about 1.3 kB gzip, with about 2.5 kB more across imports. Its 17 KiB catalogue request took around 0.87 s after preflight. Keep the static list available and refresh after initial paint. Align live status and the generator's noindex rules with sitemap decisions. No generated page contains JobPosting and the live sitemap has zero single-posting URLs. Code gates JobPosting to a single employer-direct listing with a description and expiry. Validate an actual open listing in Rich Results Test and URL Inspection before claiming eligibility. Check rendered description, Apply, expiry and removal. Keep area lists eligible for ordinary web search. [Google JobPosting requirements](https://developers.google.com/search/docs/appearance/structured-data/job-posting)

6. **Pilot student-specific pages and share features (medium impact, low-to-medium effort).** Entry-level Data Analyst in Texas and remote Data Analyst are candidates based on dedicated search results and public discussion. Query volume and Fortune Jobs AI inventory for those exact slices remain unverified. Check Search Console impressions and cross-check regional interest in Trends where it has data. Only pilot pages with five distinct current listings. Require explicit employer evidence for entry level and show remote eligibility as stated by the source. Respect each feed's distribution rules. Company pages need five verified jobs and branded query interest. Salary pages need dated geography, pay period and sample sizes, with advertised pay identified separately from published wage statistics. Test native Share with a Copy link fallback, an OG card generated with the role, location and verified count, and an opt-in job alert on the strongest pages. Track visits from shares, alert opt-ins and subsequent searches. [Texas Data Analyst classification](https://hr.sao.texas.gov/Compensation/Archives/2025/JobDescriptions/R0652.pdf) · [BLS wage statistics](https://www.bls.gov/oes/)

7. **Start with student organizations, then run one launch test (medium impact, low effort).** Computing, analytics and international student groups offer audience fit. A newsletter blurb linking to a free ungated tool takes manual coordination and reaches a small audience per send. On Reddit, contribute a relevant résumé or search checklist, disclose affiliation, and follow each community's rules. Ask moderators before posting links when their policy is unclear. Ask Handshake's partner team about an educational resource. Third-party recruiter posting has separate rules and is unsuitable for an aggregator signup funnel. Product Hunt can provide a free burst of feedback with weaker student fit. BetaList has an early adopter audience and editorial selection. Try relevant free directories after establishing referral baselines. Judge each channel by completed searches and repeat visits as well as signups and paid activations. [Handshake third-party rules](https://support.joinhandshake.com/hc/en-us/articles/115007120207-Third-Party-Recruiters-in-Handshake) · [Reddit community guidance](https://support.reddithelp.com/hc/en-us/articles/28012014962580-How-do-I-keep-spam-out-of-my-community) · [Product Hunt launch guide](https://help.producthunt.com/en/articles/17734306-1-how-product-hunt-works) · [BetaList submission guidance](https://betalist.com/help)

Verification on main at 2f51b18. The React production build passed for 15 entry pages. Root npm test recorded 228 passing and 31 failing tests, primarily legacy inline page checks. This audit changes documentation only.
