# Fortune Jobs AI launch readiness — updated 31 October 2026

This is the current release handoff, not a claim that every launch gate is closed. The target is December 1. Keep Stripe and commercial newsletter sending off until the business and legal setup is complete.

## Verified October 29

- The public landing, Find Jobs, results, résumé search, profile, privacy, contact and shared assets returned HTTP 200 in `node scripts/production-health.cjs` at 14:32 UTC.
- A real public Quick Match for `Data Analyst` returned 10 relevant, recent job cards and selected-job details. The Find Jobs page showed 10 real recent listings from both Adzuna and the older imported source group. No fake preview jobs were inserted.
- `node scripts/catalogue-health.mjs` at 14:32 UTC reported 2,941 open jobs, 2,619 posted within 30 days, recent listings in all 50 states, and a newest source sighting 0.4 hours old. Source counts were Adzuna 2,264, Dice 540 and Indeed 137. These totals do **not** promise a job for every role in every state, and the older Dice/Indeed sources are not refreshing.
- `npm test` passes 251/251, including the new `tests/live-search-release-guard.cjs`. A timing-sensitive DOCX review test now waits for the actual review state instead of a fixed 100 ms.
- The reviewed `live-search` function was redeployed from current main on October 29 after Supabase CLI sign-in. `node scripts/live-search-preflight.mjs` passed every public, no-cost check: browser CORS, request validation, minimal status response, and the dry-run guard.
- Live Search is paused on the published results page at commit `e39904c`. A real browser visit to `results.html?mode=live&q=Data+Analyst` showed the unavailable state and Quick Match option; it did not start a paid search.

## Live Search update, October 30

- Claude confirmed a keyed dry run returned 202, `dry_run: true`, and a pending admission without contacting Make. The old direct Make scenario is inactive and its public webhook was deleted; the new gateway-only scenario is inactive with an empty queue.
- Franklin configured the Make API key and the two gateway secrets. The first real gateway request returned `unconfirmed`, but Make recorded no request or execution, so Apify was not run. A malformed webhook URL is likely but not proven; network/TLS failure remains possible. See `docs/live-search-cutover-checklist-2026-10-25.md`.
- The gateway now validates the configured Make URL before admission and reports `make_url_valid` on an authorized dry run. Production was redeployed and the public no-cost preflight passed. The configured URL still needs a keyed dry-run validation after Franklin recopies it.

## Public checks, October 31

- The public landing, Find Jobs, results, résumé search, profile, privacy and contact pages, plus checked assets, returned HTTP 200. This is availability only; it does not prove sign-in, search relevance or payments.
- The catalogue reported 4,190 open jobs, 3,802 posted within 30 days, and recent listings in all 50 states. The newest source sighting was under one hour old. This does not guarantee a match for every role and state or a working application link on every listing.
- The public Live Search preflight passed its validation, CORS and dry-run guard checks. The authenticated dry-run check was skipped by this script because the key was not provided to the local process; Claude separately recorded a successful authenticated dry run on October 30.

## Gates still open

The October 31 read-only quality and security smoke audit is recorded in `docs/launch-audit-2026-10-31.md`. It identified two legacy HTTP apply links, 677 legacy listings without descriptions and an untested real backup/restore path. These remain open rather than being counted as launch-ready.

Later October 31, Franklin replaced the mismatched Make webhook URL himself after first declining Codex's attempt. On the refreshed Supabase dashboard, its SHA-256 digest starts `770372c7`, matching the gateway-only hook. The separate test and gateway secrets start `e04d2732` and `b722d3f5`. Claude documented a keyed dry run with `make_url_valid: true`. The Make keychain value remains unreadable, so only a guarded real dispatch can establish that the shared secret matches. Live Search stays paused.

At 11:29 p.m. ET, Franklin approved one capped paid test. The gateway accepted one `Data Analyst` search; Make completed it, and the gateway reported nine results. The database has nine jobs plus a `signal=success` completion marker. Claude deactivated the gateway-only Make scenario after the run. The shared key is therefore verified. Make charged **45.5 credits for this single search**, versus the approximately 10 credits estimated beforehand. Claude traced 28.34 credits to AI ranking and 10 to row writes. Apify charged $0.001, below its $0.10 per-run cap. Some returned listings were over 30 days old, so freshness also needs correction. The public site remains paused while the Make workflow is optimized and a safe production budget is set. The prepared site switch is on `codex/live-search-cutover-ready-1031`, not on main.

| Priority | Owner | Gate | Evidence needed |
| --- | --- | --- | --- |
| 1 | Claude + Codex + Franklin | Control Live Search cost and freshness before offering it publicly. The webhook URL, shared key, Make result and completion marker are verified. | Reduce the AI ranking payload and row-write costs, filter reliably stale listings, verify the new workflow with separate approval for a paid run, set a viable production budget and limits, then coordinate activating Make and merging the prepared site switch. Do not run another paid test on the earlier approval. |
| 1 | Franklin + independent reviewer | Prove employer onboarding and review with real accounts. No reviewer is currently appointed; a company owner cannot review its own company. | Verify company authority through a separate channel, appoint a trusted independent reviewer, and test one post from submission through approval or rejection. |
| 1 | Franklin + legal counsel | Confirm operator identity and review public policies before the December 1 announcement. | Incorporation details, jurisdiction, business contact/address, privacy data-flow and retention decisions, terms acceptance, and counsel review. See `docs/legal-readiness-2026-10-24.md`. Keep the commercial newsletter off: an email address alone does not complete its identification requirements. |
| 1 | Franklin + Codex | Complete a real backup and isolated restore drill for database and private résumé files. | First successful off-site backup, independent recovery key, object counts, and a test-project restore. Existing backup tooling has only synthetic tests. |
| 2 | Codex | Continue job-quality and logo audits. | Check role/state coverage, application links and employer identity. Unverified or ambiguous employers retain initials; no provider can honestly supply every official logo. |
| 2 | Franklin + Codex | Review security settings and recovery access. | Supabase Free lacks leaked-password protection and managed backups; review plan options and access before changing. Static employer authorization tests pass, but production reviewer behavior needs the real pilot above. |
| 2 | Franklin + Codex | Decide the first app release scope and platform. There is no app shell or mobile project in this repository yet. | Choose installable web app, iOS, Android, or a staged combination; set an app-specific release date and owner. The December 1 website launch does not imply an app is ready. |
| Deferred | Franklin | Set up Stripe and paid subscriptions after Inc/legal paperwork. | Keep the $7.99 seeker and $14.99 Employer Plus offers marked coming soon; the employer free allowance is 15 **active** posts, not 15 per month. |
| Deferred | Product + privacy owner | Generative AI résumé and employer-post drafting. | Current résumé builder and fit estimate are local, evidence-based tools. Model generation, provider choice, costs, data notices, and real-user review are still open in `docs/next-ai-features-checklist.md`. |

## App creation checklist (new track)

- [ ] Choose the first format and release date: installable web app (PWA), native iOS/Android, or a staged release. Confirm whether the app is part of December 1 or follows the website launch.
- [ ] Define a small first release: Quick Match, job details and external apply links, saved jobs, account/profile, and résumé tools. Keep employer sign-in and workspace distinct. Include Live Search only after the guarded website path passes its end-to-end test.
- [ ] Design mobile navigation and accessibility, including readable job cards, filters, empty/error states, and clear labels for estimated résumé fit scores.
- [ ] Reuse the existing backend with mobile-specific sign-in redirects and secure session storage. Keep service keys and Make/Apify credentials off the device; verify account deletion and employer permissions on mobile.
- [ ] Set privacy and store requirements: data-use disclosures, résumé handling, consent for optional notifications, and an account deletion path. Set up Apple/Google developer accounts only if native store distribution is chosen.
- [ ] Build an internal beta, test on real devices and slow connections, verify job links and sign-in, add crash monitoring, then submit or publish only after review.

## Release rule

Quick Match can continue serving the current US catalogue while Live Search is paused. Do not unpause Live Search or publish the prepared cutover branch until the lower-cost Make workflow and freshness rule are verified and a production budget is approved. Do not claim worldwide job coverage or a guaranteed 100/100 hiring outcome.
