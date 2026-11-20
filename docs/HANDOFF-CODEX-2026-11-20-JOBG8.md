# Codex brief — Nov 20 2026: Jobg8 XML feed import (build in December, live in January)

## Why
Jobg8 (Sue Conway, Head of Sales) will send us a custom XML feed of U.S. jobs and **pay us per click** (click-to-apply model). Agreed on the Nov 20 call and in Sue's email of Nov 20:
- Feed mix: about 50% healthcare, 25% transport & logistics, 25% IT (tuned by our keyword list).
- **QA mode first**: a live feed with billing off. Claude/Franklin tell Jobg8 before switching to live; payments are never back-dated.
- Free for 90 days after going live. After that it stays free at 50+ transactions a month, or costs $35/month (or we switch it off).
- Target: build and test in QA mode in December; go live in January.

**Blocked on:** the feed URL/credentials (after Franklin signs Jobg8's terms) and the three Jobg8 PDFs, which Claude could not download. Franklin will drop them in `docs/partners/jobg8/` (technical integration guide = mandatory; source tracking and conversion tracking guides = optional). **Read the technical guide before coding and follow it over anything in this brief.**

## Rules from Jobg8 (must follow)
1. **Refresh every 60–240 minutes** (they rebuild hourly). Aim for hourly. Each run treats the XML as a full snapshot:
   - insert jobs that are new,
   - update jobs whose fields changed,
   - **close** (`closed_at = now()`) every open `source='jobg8'` job that is no longer in the snapshot.
   They keep a deleted job clickable for only 12 hours; clicks after that are unpaid.
2. **Full job description must be visible** on our job detail view. No iframes.
3. The apply link must be **Jobg8's tracking URL exactly as given in the feed** (no rewriting, no shortening, no extra redirects of ours). Students land on the employer's page; Jobg8 only intercepts suspected bots.
4. **Source parameter** (per the source tracking guide): append the traffic source to each Jobg8 click URL at click time (e.g. `instagram`, `facebook`, `linkedin`, `threads`, `organic`, `email`), using the parameter name the guide specifies. Take it from the visitor's `utm_source` (store it in sessionStorage on landing); default `organic`.
5. Don't send clicks Jobg8 won't pay for: no automated clicks, no prefetching/prerendering of apply URLs, no link-checkers hitting tracking URLs, and no duplicate clicks from our own code.
6. Store the **CPC/price** field if the feed has one (Claude may use it later to rank). Don't show prices to users.

## Build (branch `codex/jobg8-feed`, one PR)
1. New edge function `supabase/functions/jobg8-ingest/` following the `ats-ingest` pattern (`source`, `source_listing_id`, `last_seen_at`, close-missing step, `ingest_runs` row per run).
   - Stream-parse the XML (it may be large); don't load it all into memory if avoidable.
   - Map fields to `pre_scraped_jobs`: title, company, description (sanitised HTML → our existing cleaner), city/state → `location` as **"City, ST"** plus `state_code`, `country='us'`, posted date, salary text if present, apply URL, category/sector → our `category` and `canonical_role` where possible, `source='jobg8'`, `attribution` = "Jobs by Jobg8" (or the exact wording the guide requires), price → a nullable numeric column (migration file only).
   - Write in batches of ≤500 rows; the database is Supabase Pro Micro — keep each statement small.
   - Feed URL and any key in edge-function secrets (`JOBG8_FEED_URL`), never in the repo.
   - A `JOBG8_MODE` secret (`qa` | `live`) recorded in each `ingest_runs` row, so the nightly report can show which mode we're in.
2. Schedule: a `pg_cron` job every 60 minutes calling the function. **Write the migration only; do not apply it.**
3. Front end:
   - Jobg8 jobs appear in search like other sources, with the "Jobs by Jobg8" credit.
   - Apply button: Jobg8 URL + source parameter (rule 4), opened in a new tab with `rel="noopener noreferrer"`.
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
