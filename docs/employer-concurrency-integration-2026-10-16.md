# Employer concurrency integration — October 16, 2026

## Ownership and changes

Claude authored the publication/status locking migration and the original 16-scenario concurrency harness in commit 16cf506. Codex reviewed it and cherry-picked it as 22c8fdc, preserving attribution.

Codex then:
- Included both the existing pending-claim deletion fix and the new migrations in every full test chain and first-install builder.
- Ported persistent race-test sessions to independent node-postgres connections so Windows process-output buffering cannot stall the harness; pinned pg 8.23.1 as a development dependency. Required lock waits now fail on a deadline, and close/review assertions check actual outcomes.
- Added the server-derived can_activate hint to the existing owner-scoped read model. Employers can reopen their own still-approved posts; reviewer takedowns withdraw approval and offer no reopen button. The mutation RPC independently enforces permission. No reinstatement or reviewer-appeal approval path was invented.
- Added regression tests for owner reopening, reviewer takedown, expiry/unreviewed/inactive eligibility, private helper privileges and a banned actor.
- Built and tested an incremental function-only deployment with ACL comparison, private-helper checks, billing guards and a repeat-application guard. It preserves existing user/company/catalogue rows.

## Independent validation

Production reports PostgreSQL **17.6**. Codex ran the complete migration chain on a disposable, loopback-only **PostgreSQL 17.11** server on Windows, using official vendor binaries. This matches the major version, not the production minor version or full Supabase environment.

- Before the fix: **12 of 16** deterministic race scenarios fail, reproducing Claude's findings on PostgreSQL 17.
- With the fix: **16 of 16** pass, including concurrent bans, closures, owner deletion in both orders, two owner deletions, domain conflicts and three publishers competing for the final free slot.
- Native access and submissions suites: **4 tests pass**, including a separate simultaneous-publication quota test.
- Full application suite: **178 tests pass**, zero failures/skips. The PDF and DOCX extraction tests pass in this checkout.
- The incremental SQL bundle is actually executed against an isolated existing installation; old records and effective function grants are retained and a second application is refused.

Evidence: employer-concurrency-pg17-results.json and employer-concurrency-live-api-checks.json in this directory. The baseline test intentionally exits nonzero because it asserts the correct behavior against the unfixed functions. It is not a failure of the final code.

## Live deployment

The function-only transaction for 20261019_employer_concurrency_hardening.sql and 20261020_employer_post_actions.sql committed in Supabase and returned employer_concurrency_upgrade_applied_payments_disabled. Existing migrations were not rerun. The historical sources remain in migrations/pending; these two files are now applied.

Public-key-only live probes confirm private company/state/lock functions refuse anonymous access with 401/42501; public job reads remain 200. No credential was extracted, no real account deleted, no company or reviewer granted, and no employer listing/feed imported. Paid publishing remains disabled.

Frontend release verification is recorded below when the Pages deployment completes.

## Remaining scope

These tests cover the named interleavings, not arbitrary stress or 100-user load. Feed/source publication and revocation, draft editing and downgrade concurrency still need independent coverage. The employer-feed worker remains undeployed/disabled. Account bans do not automatically suspend a shared company or remove all previously published jobs. A future membership-removal path must take the company lock. Operator takedown reinstatement requires an explicit reviewed design; self-service reinstatement is unavailable.

## Next task for Claude

Pull latest main before branching. Review and test concurrent employer feed publication/closure, source approval/revocation, draft editing and downgrade behavior, including owner/reviewer deletion. Start from the full deployed chain, including pending-claim cleanup, concurrency hardening and post-action hints. Use a disposable PostgreSQL 17 database and independent sessions; prove that revocation cannot leave visible unauthorized jobs, quota stays at 15 across manual/feed jobs, edits cannot inherit stale approval, and deletion does not deadlock. Keep any fixes in a new additive migration and a separate branch. Do not edit login/account/workspace files, deploy to production, grant reviewers, enable feeds/payments or call paid providers. Report failing baseline interleavings, passing fixes and untested risks.
