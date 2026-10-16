# Employer feed review integration — October 16, 2026

## Result and ownership

Claude's aed3abc is reviewed and integrated as 3897f42, preserving authorship. Its 20261021_employer_feed_concurrency_hardening.sql and Codex's 20261022_employer_paused_post_state.sql are now applied in production in one incremental transaction. Files remain in migrations/pending as historical sources. Do not rerun the first-install bundle on this project.

Claude fixed keep-choice serialization during downgrade, feed listings left open after approver deletion, listings left open after last-owner deletion, and automatic reappearance after company re-verification. Closing these listings frees their allowance slots and retains their records.

Codex added:

- The migrations to every complete test chain and the first-install builder.
- A fingerprinted incremental feed upgrade with existing-ACL comparison, ordinary-role table checks, disabled-billing guard and repeat-application refusal. The actual upgrade executes in an isolated existing installation in the test suite and preserves user/company/catalogue records.
- Accurate private workspace state: a post with a closed backing listing displays **Paused**, rather than Live. Existing approved posts offer deliberate reactivation only when the company is verified, the approval is current, the post has no unreviewed edits and the closing date permits it. The mutation still rechecks authority and quota.
- SQL regressions proving that company re-verification alone does not republish a listing, and that a re-approved feed cannot reuse old-revision candidates. A fresh collection is required before publication succeeds.
- Two additional native deletion interleavings (F14/F15) and stronger error/outcome assertions in the feed harness. The suspected extra deletion deadlock did not reproduce with Claude's fix, so no extra lock helper or permission was added. F14 requires the new org lock and is excluded from the pre-fix baseline; it is not a fifth defect.

## Validation

Production was checked read-only: PostgreSQL **17.6**. Codex independently used a disposable loopback-only PostgreSQL **17.11** cluster on Windows with the full combined migration chain.

| Check | Result |
| --- | --- |
| Original feed scenarios before the fix | 4 of 13 fail: F07/F10/F11/F13, reproduced |
| Fixed feed scenarios plus two regressions | 15 of 15 pass |
| Previous publication/deletion/domain races, with new migrations | 16 of 16 pass |
| Native access/submissions tests | 4 pass, including a separate quota race |
| Full application suite | 180 pass, zero failures/skips |
| Deno edge tests | 14 pass |
| Both employer entrypoint type checks | pass |

The intentionally failing baseline confirms test sensitivity. The fixed runs pass. This is coverage of named deterministic interleavings, not an exhaustive race proof or 100-user production load test. Detailed observations are in employer-feed-integration-pg17-results.json; Claude's original report/results are preserved separately.

## Deployment evidence

The dashboard transaction returned **employer_feed_upgrade_applied_payments_disabled**. Existing migrations were not reapplied, and no actual account was deleted or employer/reviewer created.

Post-deploy metadata confirms:

- Feed deletion cleanup and paused-state projection are installed.
- Anonymous private employer RPC permissions: 0.
- Ordinary-role direct private table grants: 0.
- Paid publishing: false; existing 15-active allowance and USD 1499-cent price are unchanged.
- Open catalogue jobs: 736; companies/reviewers: 0/0.

Public-key-only probes return 401/42501 for private state, keep preference and company reads, while public catalogue reads return 200. See employer-feed-live-database-checks-2026-10-16.json and employer-feed-live-api-checks-2026-10-16.json. The existing authenticated session successfully reloaded employer onboarding after the update, with no browser errors. No company or new account was created. Paused-card behavior is verified with synthetic SQL fixtures; a real employer pilot remains pending.

## Approval policy retained

This integration does not make company suspension withdraw every manual post approval. Closed listings stay closed after company re-verification; an eligible member must deliberately reactivate an already approved post, subject to the normal checks. An individual **operator takedown** still withdraws that post's approval and cannot be reopened by its employer. No new reinstatement path was added. Changing the company-suspension approval policy remains a product decision.

## Remaining work

The automatic employer-feed worker remains undeployed/disabled, and paid publishing remains disabled. An authorized employer pilot, independent reviewers and operational scheduling are still needed before claiming the full employer-feed launch complete. No real employer feed/provider request or paid scraping was performed.

Production has a valid, unconditional, single-key unique index on pre_scraped_jobs.apply_url (verified in the dashboard). It prevents duplicate URL inserts across companies. A concurrent collision can still abort a publication transaction; friendly conflict handling and the full cross-company race are not proven by this check.

The remaining native gaps are registry lease/checkpoint staging racing approval/revocation, candidate selection racing publication, and a cross-company URL collision. Existing offline/integration tests cover leases, stale batch/candidate revisions and revocation during collection, but are not a substitute for independent-session tests of these exact interleavings.

## Next bounded task for Claude

Pull latest main and read this report. On a separate branch, test registry lease/checkpoint staging against revocation/re-approval, candidate selection against publication, and two companies publishing the same application URL. Use the full applied chain through 20261022 and independent PostgreSQL 17 sessions. Keep losing URL claims from overwriting another source, report partial/failed batch behavior honestly, and require a fresh/current selected candidate before any publication. Submit only proven fixes in a new additive migration; leave frontend/auth files, production deployment, reviewer grants, provider calls, feed enablement and payments unchanged. Then provide an authorized-employer pilot checklist identifying operational steps still needed, without claiming that the pilot has run.
