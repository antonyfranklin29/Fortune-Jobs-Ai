# Job ingestion deployment — October 15, 2026

Pulled Claude commits 3a6acbd and 092ce54. All 100 pre-change Node tests and all 15 Deno worker tests passed. Source attribution addition increases Node tests to 101.

Deployed job-ingest using Supabase browser editor, loading repository index.ts, lib.mjs and generated config.mjs without modifying worker code. Dashboard reported successful deployment. Legacy JWT gate disabled for this endpoint; the worker itself requires x-ingest-secret. Public POST without it returned 401 unauthorised, proving runtime boot and the secret gate. No secret value was read. No provider call has yet been made by Codex.

Prepared Test panel: POST {"mode":"feed","budget":5}, header name x-ingest-secret, value blank for owner entry. This is at most five provider requests including retries; up to 250 fetched listings is a ceiling, not a guarantee of 250 stored jobs. Nationwide category feed is not proof of 100 jobs per role/state. Scheduler remains unapplied. Default worker allowance assumes the paid plan, so do not schedule it on the 25-total-test-call account. Verify actual account limits and add lifetime allowance accounting before any ongoing test-plan runs.

Frontend: Quick Match now requests source/closed_at, filters closed_at=is.null, orders posting date descending before candidate cap, propagates source to cards, and renders fixed-link Adzuna label (minimum 116x23 display area) for Adzuna jobs. Saved-job cards detect the Adzuna redirect URL. Main/generated pages rebuilt. A schema check caught absent pre_scraped_jobs.source_metadata after an initial push; corrected immediately to actual columns and confirmed public query 200 before any ingestion.

Awaiting first bounded authorized provider response; no jobs imported yet by Codex. Commercial plan/display permission and accurate provider attribution/retention rules still need to be confirmed for ongoing use; no plan purchase or agreement acceptance.
