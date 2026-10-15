# Job ingestion deployment — October 15, 2026

Pulled Claude commits 3a6acbd and 092ce54. All 100 pre-change Node tests and all 15 Deno worker tests passed. Source attribution addition increases Node tests to 101.

Deployed job-ingest using Supabase browser editor, loading repository index.ts, lib.mjs and generated config.mjs without modifying worker code. Dashboard reported successful deployment. Legacy JWT gate disabled for this endpoint; the worker itself requires x-ingest-secret. Public POST without it returned 401 unauthorised, proving runtime boot and the secret gate. No secret value was read. No provider call has yet been made by Codex.

Prepared Test panel: POST {"mode":"feed","budget":5}, header name x-ingest-secret, value blank for owner entry. This is at most five provider requests including retries; up to 250 fetched listings is a ceiling, not a guarantee of 250 stored jobs. Nationwide category feed is not proof of 100 jobs per role/state. Scheduler remains unapplied. Default worker allowance assumes the paid plan, so do not schedule it on the 25-total-test-call account. Verify actual account limits and add lifetime allowance accounting before any ongoing test-plan runs.

Frontend: Quick Match now requests source/closed_at, filters closed_at=is.null, orders posting date descending before candidate cap, propagates source to cards, and renders fixed-link Adzuna label (minimum 116x23 display area) for Adzuna jobs. Saved-job cards detect the Adzuna redirect URL. Main/generated pages rebuilt. A schema check caught absent pre_scraped_jobs.source_metadata after an initial push; corrected immediately to actual columns and confirmed public query 200 before any ingestion.

Commercial plan/display permission and accurate provider attribution/retention rules still need to be confirmed for ongoing use; no plan purchase or agreement acceptance.

## Owner-run import verified

The owner replaced INGEST_SECRET after reporting that the literal PowerShell generator command had been saved instead of its random output. The stored digest changed; no secret value was read or copied by Codex.

The owner submitted the prepared five-call test. Its response was HTTP 200, status succeeded: 250 fetched, 43 kept, 25 inserted, 18 updated, no write rejects/conflicts, no closures. Rejected inputs: 179 no_role, 9 out_of_scope, 19 no_state_evidence. Feed pass remains incomplete (outcome more, last_page 8); this is not a complete nationwide refresh.

Read-only production SQL confirmed two successful runs, each using five provider requests. The earlier run inserted 54; the latest inserted 25 and updated 18. Catalogue now contains 79 open Adzuna rows across 23 state codes and 13 canonical roles. Recorded provider usage is 10 calls. Coverage view reports zero role/state cells reaching 100; fresh eligible Data Analyst counts for NC and SC are both zero. This view does not imply there are no legacy cards on the site.

No additional import request was run during verification. Scheduler remains unapplied. Next ingestion priority is a bounded, targeted NC/SC Data Analyst pilot rather than assuming the broad IT feed has met the owner's coverage target; confirm remaining account allowance before further provider requests.
