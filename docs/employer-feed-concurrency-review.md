# Employer feed, revocation, draft and deletion concurrency review

**Codex integration update (October 16):** The original report is preserved below. Its fixes are now integrated and applied with the private paused-state follow-up. Independent PostgreSQL 17.11 runs reproduce the four baseline failures and pass all 31 combined race scenarios. Read [the integration report](employer-feed-integration-2026-10-16.md) for current deployment status, retained approval policy, evidence and remaining scope. The pending/deployment statements below describe the original handoff.

Base: `origin/main` at `7080006`. Branch: `claude/employer-feed-concurrency-review`.
Database: PostgreSQL 17.10 (embedded binaries, loopback, disposable cluster). Each scenario runs in its own database cloned from a migrated template, with independent backend sessions. A session counts as blocked when `pg_stat_activity` reports `wait_event_type = 'Lock'`.

Not changed: production, payments, frontend, login, account or workspace files, grants, and no reviewers granted. No paid provider was called. No feed or payment was enabled.

## Scope

Chain tested: the full main chain through `20261020_employer_post_actions.sql`, plus the new additive `20261021_employer_feed_concurrency_hardening.sql` in the fixed run.

Covered: feed publication (`employer_publish_feed_jobs`), feed close (`employer_close_feed_jobs`), source revocation (`operator_revoke_source`), source approval, draft editing (`employer_save_post`, `employer_submit_post`), approval and activation, keep-on-downgrade and downgrade (`employer_set_keep_on_downgrade`, `employer_apply_downgrade`), and owner and operator deletion (`employer_before_account_deleted`).

## Baseline: 4 of 13 interleavings fail on main

| | Scenario | Baseline (main chain) |
|---|---|---|
| F01 | feed publish parked on a candidate, revocation queued behind it | pass |
| F02 | revocation and feed publish both queued on the organisation lock | pass |
| F03 | shared 15-slot quota: manual activation and two-listing feed publish | pass (one slot taken, active 15) |
| F04 | edit committed while approval of the prior revision is queued | pass (approval refused, `revision_changed`) |
| F05 | live post edited: listing keeps approved text | pass |
| F06 | approved post edited: old approval unusable | pass |
| **F07** | **keep-on-downgrade committed during a downgrade** | **FAIL** |
| F08 | downgrade parked, manual publish queued behind it | pass (active 15) |
| F09 | submitting owner deleted during a feed publish | pass (no deadlock) |
| **F10** | **approving operator deleted: feed listings left open** | **FAIL** |
| **F11** | **last owner deleted: live listing left open** | **FAIL** |
| F12 | revocation and owner deletion queued together | pass (no deadlock) |
| **F13** | **re-verification after suspension revives the listing** | **FAIL** |

Observed failures:

- **F07.** The owner marked post 15 to keep while the downgrade was parked between its count and its pause. The keep commit went through, and the downgrade still paused post 15 (`keep_on_downgrade = true`, `status = paused`). The downgrade used a stale snapshot of the flag. The employer's choice was lost.
- **F10.** Deleting the approving operator demoted the source to `pending` and hid it, but its open feed listing stayed open. Result: `open feed jobs 1`, `active 1`. The listing was hidden, but it still held an allowance slot.
- **F11.** Deleting the last owner suspended the organisation, but its open listing stayed open (`open 1`, `active 1`).
- **F13.** After F11, re-verifying the organisation made the pre-suspension listing visible again (`visible 1`), with no review.

## Fix: `migrations/pending/20261021_employer_feed_concurrency_hardening.sql`

Additive. Two functions are replaced with the same signatures. No table, column, data, index or grant changes. It must be applied after `20261020_employer_post_actions.sql`.

1. **F07.** `employer_set_keep_on_downgrade` takes the organisation lock (the one the downgrade holds) before it updates the flag. A keep choice therefore commits before the downgrade's count or after it finishes, never in between. The membership check is repeated after the lock.
2. **F10, F11, F13.** `employer_before_account_deleted` keeps every rule from `20261019_employer_pending_account_cleanup` and adds two behaviours. Listings from a source that the deletion demotes are closed in the same transaction. A suspended or rejected organisation's open listings are closed, as operator suspension already does. Lock order is unchanged (organisation row first, then its listings). Closing the listings also removes the F13 revival path.

## Fixed chain: 13 of 13 pass

Every interleaving passes with the fix, including F07 (the keep update blocks until the downgrade commits, then pauses correctly), F10 (`open feed jobs 0`, `active 0`), F11 (`open 0`, `active 0`) and F13 (`visible 0`).

## Existing suites (fixed chain)

- `test:employer-concurrency`: 16 of 16 pass. The suite's fix chain now includes `20261021`. This is the only edit to an existing test file.
- `test:employer-native-db`: 3 of 3 pass, 0 skipped.
- `test:employer-access`: 1 of 1 pass, 0 skipped.
- `test:employer-backend`: 77 of 77 pass.

Not run: full `npm test`, the Deno checks (`check:employer-worker`, `test:employer-entrypoint`) and the edge-function paths.

## Reproduce

```
FJ_PG_DISPOSABLE=1 PGHOST=127.0.0.1 PGPORT=54417 PGUSER=postgres npm run test:employer-feed-concurrency
FJ_FEED_FIX=0 ... npm run test:employer-feed-concurrency   # baseline: main chain without 20261021
```

Results are in `docs/employer-feed-concurrency-pg17-results.json`.

## Untested risks

1. **Registry lease path.** `employer_feed_stage_registered_run` (run leases, checkpoints, `stale_batch`) is not exercised. Candidates are staged directly as the database owner through `employer_stage_feed_candidates`.
2. **Candidate selection vs publish.** `employer_select_feed_jobs` racing an in-flight publish is not tested.
3. **Cross-organisation apply URL.** Two organisations' publishes take different organisation locks, so the `apply_url_already_listed` check is not serialised across organisations. Not tested. I did not check whether `pre_scraped_jobs.apply_url` has a unique index.
4. **Reactivation after suspension (policy).** After an operator re-verifies a suspended organisation, a remaining member can re-activate an approved post. The publish path reopens the closed listing under the existing approval. This is by design but untested, and a product decision: should suspension also withdraw the approval?
5. **Behaviour change in deletion (review needed).** Deleting the last owner now closes the organisation's manual listings. Previously they stayed open but hidden. Posts keep `status = published` with a closed job until they are re-activated. This matches operator suspension, but it is a visible change.
6. **Re-approval after demotion.** A demoted source that is re-approved, and its stale candidates from an earlier revision, are not tested.
7. **Interleaving coverage.** Interleavings are deterministic (parked locks), not randomised. Timing windows that no lock parks are not covered.
8. **Database version.** Tests run on PostgreSQL 17.10 embedded binaries. The production Supabase minor version is not confirmed.
