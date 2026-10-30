# Fortune Jobs AI launch readiness — 29 October 2026

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

## Gates still open

| Priority | Owner | Gate | Evidence needed |
| --- | --- | --- | --- |
| 1 | Franklin + Codex | Correct or verify `MAKE_LIVE_WEBHOOK_URL`. The first real gateway request never appeared in Make. | Copy the gateway-only webhook URL directly from Make into Supabase without quotes or whitespace, then run an authorized dry run and confirm `make_url_valid: true`. No Apify run is needed for this check. |
| 1 | Claude + Codex + Franklin | Complete guarded Live Search cutover before offering it again. | Recheck the new scenario's empty queue, activate it, observe one capped real search from gateway through jobs and completion marker, then release the prepared gateway-only site switch. If the retry is unconfirmed with no Make log, stop and diagnose before another paid attempt. |
| 1 | Franklin + independent reviewer | Prove employer onboarding and review with real accounts. No reviewer is currently appointed; a company owner cannot review its own company. | Verify company authority through a separate channel, appoint a trusted independent reviewer, and test one post from submission through approval or rejection. |
| 1 | Franklin + legal counsel | Confirm operator identity and review public policies before the December 1 announcement. | Incorporation details, jurisdiction, business contact/address, privacy data-flow and retention decisions, terms acceptance, and counsel review. See `docs/legal-readiness-2026-10-24.md`. Keep the commercial newsletter off: an email address alone does not complete its identification requirements. |
| 1 | Franklin + Codex | Complete a real backup and isolated restore drill for database and private résumé files. | First successful off-site backup, independent recovery key, object counts, and a test-project restore. Existing backup tooling has only synthetic tests. |
| 2 | Codex | Continue job-quality and logo audits. | Check role/state coverage, application links and employer identity. Unverified or ambiguous employers retain initials; no provider can honestly supply every official logo. |
| 2 | Franklin + Codex | Review security settings and recovery access. | Supabase Free lacks leaked-password protection and managed backups; review plan options and access before changing. Static employer authorization tests pass, but production reviewer behavior needs the real pilot above. |
| Deferred | Franklin | Set up Stripe and paid subscriptions after Inc/legal paperwork. | Keep the $7.99 seeker and $14.99 Employer Plus offers marked coming soon; the employer free allowance is 15 **active** posts, not 15 per month. |
| Deferred | Product + privacy owner | Generative AI résumé and employer-post drafting. | Current résumé builder and fit estimate are local, evidence-based tools. Model generation, provider choice, costs, data notices, and real-user review are still open in `docs/next-ai-features-checklist.md`. |

## Release rule

Quick Match can continue serving the current US catalogue while Live Search is paused. Do not unpause Live Search or publish the prepared cutover branch until the new gateway, Make authentication, capped end-to-end result, and retirement of the exposed old webhook are all verified. Do not claim worldwide job coverage or a guaranteed 100/100 hiring outcome.
