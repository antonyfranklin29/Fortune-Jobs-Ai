# Codex brief — Nov 21 2026: four improvements before the Jobg8 launch (January)

Context: Franklin approved these after the Jobg8 call (Nov 20). Jobg8 pays per click that converts to applications, needs fresh jobs, and needs ≥50 paid clicks a month after a 90-day free period. Live Search now shows only paying partners (WhatJobs; Jobg8 from January); Quick Match shows our own catalogue and links to Live Search.

Do these as **four separate PRs** (branches below), in this order. Each: tests, no merge, no deploy, no migrations applied, no cron changes. `npm test` has 32 known failures on main; add none.

## 1. Source tracking — `codex/source-tracking`
Know which channel brings job seekers who click partner jobs.
- On any page load, read `utm_source`, `utm_medium`, `utm_campaign` (and a `ref` fallback). Store in `sessionStorage` (`fj_src`) only if not already set this session. Lowercase, `[a-z0-9_-]`, max 40 chars. Default `organic`.
- Our social posts already use `utm_source=instagram|facebook|linkedin|threads`; keep those values.
- When a user clicks a **partner** job (WhatJobs now, Jobg8 later), append tracking to the outbound URL **without changing anything else in it**:
  - Jobg8: `&source=<src>&method=<search|live|match|jobpage|alert>&campaign=<campaign>` (per Jobg8's Performance Tracking guide).
  - WhatJobs: do **not** modify their URL (Elena: "don't change any of the text or links"). Only log the click internally.
- Log each partner click to a new table `partner_clicks` (migration file only): `id, created_at, partner, source, method, campaign, job_key, country_hint` — no IP, no user id, no user agent. Insert via an edge function or RPC callable by anon with a simple rate limit; never block the navigation if logging fails.
- Build URLs on click only (no prefetch, no prerender of partner URLs).
- Tests: utm capture/precedence, sanitising, Jobg8 param appending (keeps existing query, no double-append), WhatJobs URL untouched, logging failure doesn't block.

## 2. Healthcare & transport landing pages — `codex/healthcare-transport-pages`
Jobg8's U.S. feed is ~50% healthcare and ~20% transport; healthcare pays the most.
- Extend the public job pages generator (`jobs/catalogue.mjs`, existing `/jobs/<role>/<state>/` pages) with roles: registered-nurse, licensed-practical-nurse, certified-nursing-assistant, medical-assistant, pharmacy-technician, physical-therapist, respiratory-therapist, home-health-aide, cdl-truck-driver, delivery-driver, warehouse-associate, forklift-operator, dispatcher, logistics-coordinator.
- Only generate a role/state page when it has ≥5 open jobs (no thin pages).
- Add these roles to the job-title suggestions and the Job Category filter.
- Copy: "job portal" wording; no "straight from employers"; no Google for Jobs/JobPosting markup.
- Tests: page generation thresholds, sitemap entries, no empty pages.

## 3. Weekly job-alert email — `codex/weekly-alerts`
Bring users back (target: 50+ paid clicks/month after the free period).
- Reuse `job-alerts` (daily). Add a **weekly** option (Mondays) to alert settings; default for new sign-ups = weekly.
- Email: up to 10 new jobs matching the user's saved role/location from our catalogue, plus a "See live jobs for <role>" button linking to `results.html?mode=live&q=<role>&location=<loc>&utm_source=email&utm_medium=alert`.
- Unsubscribe link in every email (existing mechanism). No partner tracking URLs inside the email itself (clicks must come from the site, by a user action).
- Migration file only for any new column. No cron change — describe the cron line needed in the PR; Claude adds it after approval.
- Tests: weekly selection, de-dupe vs last week, unsubscribe link present, UTM on the live link.

## 4. Bot protection on search pages — `codex/bot-protection`
Partners don't pay for bot clicks and can cut a feed with too much invalid traffic. Needed before any paid ads.
- Edge functions `whatjobs-search` and `jooble-search` (and later Jobg8 click logging): per-IP rate limit (e.g. 30 searches/10 min) using the existing `live_search_limits` pattern; reject obvious bots by user-agent (headless, curl, python-requests, etc.) with an empty result, not an error page.
- Front end: never render partner URLs into `href` before a user action if avoidable (build on click); add `rel="nofollow sponsored noopener noreferrer"`.
- Add `robots.txt` disallow for `/results.html?mode=live` query pages; keep public job pages crawlable.
- Recommend (don't implement) Cloudflare Turnstile or Cloudflare bot rules for later; note cost/effort in the PR.
- Tests: rate-limit window, UA filter, robots rules.

## Reply with
Four PR links, each with a 3-line plain-English summary for Franklin.
