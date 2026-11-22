# Codex brief — Nov 20 2026: Jobg8 XML feed import (build in December, live in January)

## Why
Jobg8 (Sue Conway, Head of Sales) will send us a custom XML feed of U.S. jobs and **pay us per click** (click-to-apply model). Agreed on the Nov 20 call and in Sue's email of Nov 20:
- Feed mix: about 50% healthcare, 25% transport & logistics, 25% IT (tuned by our keyword list).
- **QA mode first**: a live feed with billing off. Claude/Franklin tell Jobg8 before switching to live; payments are never back-dated.
- Free for 90 days after going live. After that it stays free at 50+ transactions a month, or costs $35/month (or we switch it off).
- Target: build and test in QA mode in December; go live in January.

**Blocked on:** the secure feed URL (after Franklin signs Jobg8's terms). Claude read Jobg8's "Receive Jobs – Technical Integration" v1.7 (9 Nov 2026) and "Performance Tracking" v1.1 on Nov 21; the details below come from them.

## The feed (from the technical guide)
- **Delivery:** Jobg8 gives a secure URL; we collect it. The file is **ZIP-compressed** XML. Send a **HEAD request first** and compare `Last-Modified`; only GET when it changed. **At most 2 GET requests per 10 minutes.** No reply to Jobg8 is needed after collection.
- **Snapshot:** the file holds every live job. Compare with the previous run: new = Post, changed = Amend, missing = Deletion (close it immediately).
- **XML:** `<Jobs><Job>…</Job></Jobs>`; only nodes with a value are present; new nodes may be added later (ignore unknown ones). Fields:
  `AdvertiserName`, `AdvertiserType`, `SenderReference` (Jobg8's unique id → our `source_listing_id`), `DisplayReference`, `Classification`, `SubClassification`, `Position` (CDATA, title), `Description` (CDATA, up to 10,000 chars, HTML), `Country`, `Location` (county/state), `Area` (city/town), `PostalCode`, `ApplicationURL` (https, the click URL), `Language`, `EmploymentType`, `StartDate`, `Duration`, `WorkHours`, `SalaryCurrency`, `SalaryMinimum`, `SalaryMaximum`, `SalaryPeriod`, `SalaryAdditional`, `AdditionalClassification1–4`, `LogoURL`, `JobType` (APPLICATION | ATS | TRAFFIC), `SellPrice` (what we're paid per click/application, decimal, e.g. 0.20), `SellPriceCurrency`, `RevenueType` (CPA | CPC), `ConversionType` (AS, CPA, CPR, DCA, None).
- Classification values come from a mapping spreadsheet Jobg8 will send; keep their values and map to our categories ourselves (Jobg8 charges to map for us).

## Rules from Jobg8 (must follow)
1. **Refresh every 60–240 minutes** (they rebuild hourly). Aim for hourly. Each run treats the XML as a full snapshot:
   - insert jobs that are new,
   - update jobs whose fields changed,
   - **close** (`closed_at = now()`) every open `source='jobg8'` job that is no longer in the snapshot.
   They keep a deleted job clickable for only 12 hours; clicks after that are unpaid.
2. **Full job description must be visible** on our job detail view. No iframes.
3. The apply link must be **`ApplicationURL` exactly as given** (only appending query parameters, and it must still work afterwards). Open it as a **new page, never in an iframe**. Students land on the employer's page; Jobg8 only intercepts suspected bots.
3b. **Show `AdvertiserName` as the company. Never display the advertiser as "Jobg8".** (So no "Jobs by Jobg8" label on the card — the listing shows the real employer/advertiser name.)
3c. Optional: append `redirectionURL=<url-encoded fortunejobsai search URL>` so candidates who click an expired job come back to our search instead of Jobg8's job-seeker site. Use the job's role + state as the search.
3d. Optional: append `customtext=<our click id>` (≤ alphanumeric) so Jobg8's click reports can be matched to our own logs.
4. **Tracking parameters** (Performance Tracking guide): append `&source=<value>&method=<value>` (and optionally `&campaign=<value>`) to `ApplicationURL` at click time. Values: alphanumeric, ≤ 256 chars; anonymised codes are fine. `source` = the visitor's `utm_source` captured on landing (sessionStorage; e.g. `instagram`, `facebook`, `linkedin`, `threads`, `reddit`, `email`), default `organic`. `method` = where on our site the click happened (`search`, `match`, `jobpage`, `alert`). `campaign` = `utm_campaign` if present. Tell Jobg8 customer support (customer.support@jobg8.com) once switched on; don't go live the day before a weekend or bank holiday.
5. **Application URLs may ONLY be accessed by a user action.** No automated clicks, no prefetch/prerender (`rel` and speculation rules must exclude them), no link checkers, no QA scripts hitting them repeatedly — Jobg8 blocks/disables URLs that are checked too much. A repeat click on the same job in the same session isn't paid. Click discrepancies must be raised within 90 days (Jobg8 can give IP + user-agent breakdowns).
6. Store `SellPrice`, `SellPriceCurrency`, `RevenueType`, `JobType` (nullable columns, migration file only). Don't show prices to users.

## Build (branch `codex/jobg8-feed`, one PR)
1. New edge function `supabase/functions/jobg8-ingest/` following the `ats-ingest` pattern (`source`, `source_listing_id`, `last_seen_at`, close-missing step, `ingest_runs` row per run).
   - Stream-parse the XML (it may be large); don't load it all into memory if avoidable.
   - Map fields to `pre_scraped_jobs`: `Position` → title; `AdvertiserName` → company; `Description` (sanitised HTML via our existing cleaner, shown in full); `Area`, `Location` → `location` as **"City, ST"** plus `state_code`; `Country` → `country='us'`; salary min/max/period → our salary text; `ApplicationURL` → apply URL; `Classification` → our `category`/`canonical_role` where possible; `SenderReference` → `source_listing_id`; `source='jobg8'`; `posted_at` = first time we saw it; price fields as in rule 6.
   - Collection: HEAD with stored `Last-Modified` → skip when unchanged; GET + unzip only when changed; never more than 2 GETs in 10 minutes (store the last GET time).
   - Write in batches of ≤500 rows; the database is Supabase Pro Micro — keep each statement small.
   - Feed URL and any key in edge-function secrets (`JOBG8_FEED_URL`), never in the repo.
   - A `JOBG8_MODE` secret (`qa` | `live`) recorded in each `ingest_runs` row, so the nightly report can show which mode we're in.
2. Schedule: a `pg_cron` job every 60 minutes calling the function. **Write the migration only; do not apply it.**
3. Front end:
   - Jobg8 jobs appear in search like other sources, showing the advertiser's name (never "Jobg8").
   - Apply button: `ApplicationURL` + `source`/`method` (+ optional `redirectionURL`, `customtext`), opened in a new tab with `rel="noopener noreferrer"`, built only on the click (no `href` prefetching; use a click handler or `rel="nofollow noopener noreferrer"` with no prerender).
   - Full description shown in the job detail panel.
4. Tests: XML fixture (5 jobs) → mapping; snapshot diff (new / changed / missing → closed); source-parameter appending (utm → param, default organic, no double-append); HTML sanitising of descriptions.
5. A short `docs/partners/jobg8/README.md`: how the import works, how to switch QA → live, and the 12-hour/60–240-minute rules.

## Rules
- Branch + PR only. Do NOT merge, deploy, apply migrations, set secrets or change crons. Claude reviews; Franklin approves.
- No Google for Jobs / JobPosting markup.
- `npm test` has 32 known failures on main; don't add new ones.
- Copy: "job portal"; no "straight from employers" / "skip the middleman".

## Reply with
PR link, the field mapping table, and a sample run's counts from the fixture (inserted / updated / closed).
