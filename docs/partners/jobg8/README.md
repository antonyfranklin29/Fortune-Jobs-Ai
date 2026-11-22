# Jobg8 feed: review build, not enabled

Fortune Jobs AI is a job portal. This importer has been tested only against the fictional five-job ZIP/XML fixture in `tests/fixtures/jobg8/five-jobs.xml`. No feed URL has been supplied, no application URL was visited, and nothing here authorises production changes.

## Dependencies and release order

1. Merge the reviewed source-tracking PR #25 and bot-protection PR #28 before this branch. This PR is stacked on `codex/bot-protection` so its diff is limited to the feed integration.
2. Merge healthcare/transport PR #26 before importing its new roles. Resolve the taxonomy-generator worker list by keeping **job-ingest, usajobs-ingest, ats-ingest and jobg8-ingest**; run `node scripts/build-ingest-sql.cjs` and `node scripts/build-jobg8-core.cjs`. The configuration parity test prevents stale embedded roles. Do not apply a historical migration as a substitute for the pending healthcare taxonomy migration.
3. Franklin approves the pending feed migration; Claude applies it and deploys `jobg8-ingest` and `partner-click`, both with `--no-verify-jwt`. These functions authenticate ingestion via `INGEST_SECRET` and anonymous click logging via origin/bot/rate checks, respectively. No deployment is part of this PR.
4. Set `JOBG8_FEED_URL` privately after receiving the secure HTTPS URL. It is never placed in source, responses or logs. `JOBG8_MODE` defaults to `qa`; allowed values are `qa` and `live`. Existing Supabase service credentials and `INGEST_SECRET` are reused. Every configured attempt records its mode in `ingest_runs`.
5. Approve and apply `migrations/pending/20261122_jobg8_schedule.sql` only after the endpoint works in QA. Its proposed hourly time is minute 23; it reads the existing Vault `ingest_secret`. No schedule was installed.

## Collection and safety

The worker HEADs the secret URL, compares Last-Modified with the last successful snapshot, and GETs only a changed version (or when the server supplies no timestamp). A database lease fences overlapping/stale workers. Persistent GET admission allows at most two downloads in any rolling ten minutes, including failed downloads. Fetches refuse redirects and do not expose the feed URL on failure.

The ZIP is consumed in small chunks through pinned fflate and saxes parsers. Exactly one XML member is accepted, DTDs/external entities are refused, and unknown job fields are ignored. An invalid mandatory field, duplicate reference, broken XML/ZIP or failed write prevents snapshot completion. Limits: 100 MiB compressed, 512 MiB inflated, 200,000 jobs and 100,000 characters per XML field; descriptions are kept up to the provider's 10,000-character limit. An oversized feed fails safely and needs a reviewed capacity adjustment rather than a silently incomplete catalogue.

Rows are staged and then published in batches of at most 500. Existing source/reference rows are amended only when content changes; `posted_at` remains the first-seen date. Other sources' URLs are never taken over. Only a fully parsed, fully published snapshot can close missing Jobg8 rows, immediately. Interrupted publication may refresh some rows but cannot close missing rows; the next successful snapshot reconciles it. An unchanged HEAD releases its lease without closing anything. A valid empty `<Jobs/>` snapshot closes the feed; malformed/truncated empty responses do not.

Jobg8 rebuilds hourly and requires collection every **60–240 minutes**. Deleted jobs remain clickable for only **12 hours**: monitor `ingest_runs` and pause exposure if freshness cannot be maintained. There is no automatic retry that could bypass the GET allowance.

## Field mapping

| Feed | Catalogue |
| --- | --- |
| SenderReference | source_listing_id; source is internal `jobg8` |
| AdvertiserName | company; empty names and the provider name are rejected |
| Position | job_title, capped at 300 characters |
| Description | sanitized plain text via the existing partner cleaner, active blocks removed, up to 10,000 characters; displayed in full |
| Area + Location | `City, ST`, state_code from the shared US state map |
| Country | country=`us`; non-US rows abort this US snapshot |
| ApplicationURL | exact HTTPS string; never canonicalised, fetched, checked or rendered as a prefetchable application href |
| SalaryMinimum/Maximum/Currency/Period | salary text when actual amounts exist |
| EmploymentType | employment_type |
| Classification | canonical_role/category from title rules when recognised; raw classification/subclassification retained in source_metadata |
| AdditionalClassification1–4, AdvertiserType, DisplayReference, ConversionType, LogoURL, Language, StartDate, Duration, WorkHours, SalaryAdditional | source_metadata (optional nodes omitted, URLs never visited) |
| SellPrice | nullable jobg8_sell_price (numeric) |
| SellPriceCurrency | nullable jobg8_sell_price_currency |
| RevenueType | nullable jobg8_revenue_type |
| JobType | nullable jobg8_job_type |
| First observation | posted_at, preserved on amendment; fetched_at/last_seen_at refresh |

The provider's mapping spreadsheet is still pending. Raw classification values are retained; no invented numeric mappings are used. Unknown titles are imported with a null canonical role so legitimate non-IT jobs are not discarded. Regenerate the shared taxonomy after PR #26 before importing healthcare/transport roles.

## Search and clicks

Quick Match includes open Jobg8 catalogue rows, considers still-open jobs older than 30 days, and can place a comparably relevant paid result in each group of four. A five-point tolerance prevents jumping over clearly better title/location matches. Live Search reads only stored Jobg8 rows plus WhatJobs, interleaves Jobg8 first, de-duplicates and keeps the caller's free/Pro cap. No remote provider feed is requested by visitor searches.

Cards show the advertiser name, never a provider-as-employer label. Full descriptions need no iframe or second paid visit. Apply is a button: on the user's click only, the existing tracker appends missing source/method/campaign parameters without reserialising the original URL or duplicating parameters, then opens a new tab with noopener/noreferrer. WhatJobs URL bytes remain unchanged. Static job-area pages also use action buttons for Jobg8 links. Attribution comes from the first session landing; default source is organic. Optional redirectionURL/customtext are deliberately omitted.

The new `partner-click` logger uses the bot-protection IP-hash admission before writing the existing minimal click schema; raw IPs, user IDs and agents are not stored in partner_clicks. Logging is best-effort after navigation. Its shared search/click bucket is 30 admissions per ten minutes. There are no automated Apply tests against a real URL.

## QA → live requires explicit approval

QA mode **does not itself turn provider billing off**: Jobg8 must configure billing off for the QA feed. Franklin/Claude must confirm this with Jobg8. No amounts are shown to candidates. Do not run automated application-link checks in either mode.

Before live: validate the real field shapes and mapping spreadsheet, confirm billing state, check snapshot freshness and one explicitly authorised human Apply, and tell customer.support@jobg8.com tracking is enabled. Franklin/Claude then agree the live date with Jobg8 and change JOBG8_MODE to live. Do not launch immediately before a weekend or bank holiday. Payments are not back-dated. The 90-day free period and subsequent 50-transactions/$35 terms need owner review, not automated purchasing. Click discrepancies must be raised within 90 days.

## Fixture evidence

`node --test tests/jobg8-feed.mjs tests/source-tracking.cjs` uses local ZIP bytes and disposable PGlite only. Initial snapshot: **5 inserted / 0 updated / 0 closed**. Changed snapshot: **1 inserted / 1 updated / 1 closed**. It also checks unchanged HEAD, the two-GET limit, permissions, stale leases, duplicate IDs, incomplete snapshots, other-source conflicts, 500-row batches and sanitisation. Application hosts are fictional `.test` addresses and never fetched.
