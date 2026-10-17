> Codex integration note (October 17, 2026): This is Claude’s original handoff against 0d600ec, preserved for attribution. It does not include the already deployed refresh coordinator. Do not apply its proposed staging-time closure migration. See [the integration review](employer-url-integration-2026-10-17.md) for the reconciled changes, current pilot gates and deployment status.

# Employer feed leases, candidate selection and shared application URLs — review

Base: `origin/main` at `0d600ec`. Branch: `claude/employer-lease-selection-url-review`.
Database: PostgreSQL 17.10 (embedded binaries, loopback, disposable cluster). Each scenario uses its own database cloned from a migrated template, with independent backend sessions. A session counts as blocked when `pg_stat_activity` reports `wait_event_type = 'Lock'`. Parking is deterministic: held row locks, session advisory locks, and a test-only insert trigger (`fj_test_insert_pause`) that exists only in disposable test databases.

Not changed: production, payments, frontend, login, account or workspace files, grants. No reviewers were granted. No feed or payment was enabled. No paid provider was called. Nothing was deployed.

## Scope

Three areas were requested:

1. **Registry lease and staging against revocation and re-approval** (`employer_feed_run_begin`, `employer_feed_stage_registered_run`).
2. **Candidate selection against publication** (`employer_select_feed_jobs`, `employer_publish_feed_jobs`).
3. **Two companies publishing the same application URL**, from both the manual path and the feed path.

Chain for the baseline: the applied chain through `20261022_employer_paused_post_state.sql`.
Chain for the fix: the same chain plus the new additive `20261023_employer_lease_selection_url_hardening.sql`.

## Baseline: 8 of 12 pass on the applied chain

| | Scenario | Baseline | Fixed |
|---|---|---|---|
| L1 | revocation between claim and batch | pass | pass |
| L2 | batch parked on org lock, revocation queued | pass | pass |
| L3 | lease takeover: expired run cannot promote | pass | pass |
| L4 | approval withdrawn and re-granted before old batch | pass | pass |
| L5 | partial batch does not withdraw selections | pass | pass |
| **L6** | **complete batch withdraws absent listings** | **FAIL** | pass |
| C1 | deselect while publication waits | pass | pass |
| C2 | refresh of a selected listing keeps its selection | pass | pass |
| C3 | selection change behind publication | pass | pass |
| **U1** | **two companies, one application URL (manual)** | **FAIL** | pass |
| **U2a** | **feed batch behind manual claim, one application URL** | **FAIL** | pass |
| **U2b** | **manual claim behind feed batch, one application URL** | **FAIL** | pass |

Observed baseline failures:

- **L6.** A complete enumeration that no longer contains a previously published listing left that listing open and selected. The batch was accepted, but the absent listing was never withdrawn.
- **U1.** The second company's manual publish hit the `pre_scraped_jobs.apply_url` unique constraint and surfaced a raw `unique_violation` (`Key (apply_url)=… already exists`) instead of a structured conflict.
- **U2a.** A feed batch that reached a URL already claimed by a manual publish aborted the entire batch, so no other candidate in that batch was published.
- **U2b.** The mirror case: a manual publish that reached a URL already claimed by a feed batch raised the raw constraint error.

## Fix: `migrations/pending/20261023_employer_lease_selection_url_hardening.sql`

Additive. Three functions are replaced with the same signatures. No table, column, data, index or grant changes. It must be applied after `20261022_employer_paused_post_state.sql`.

1. **L6 — complete-batch withdrawal.** `employer_feed_stage_registered_run` now, for a complete enumeration only, deselects candidates and closes live feed listings that are absent from the staged batch. Partial batches do not withdraw anything (L5 still holds).
2. **U1, U2a, U2b — losing URL claims never overwrite another source.** `employer_publish_post_internal` wraps its insert/update in a unique-violation handler. It returns `apply_url_already_listed` and sets `publish_state` instead of raising. `employer_publish_feed_jobs` handles each candidate in its own handler. A losing candidate is recorded as `skipped` with reason `apply_url_already_listed`, and the batch continues with the remaining candidates.

The URL constraint itself already existed (`pre_scraped_jobs_apply_url_key`, from `migrations/20261015_ingest_catalogue.sql`). No new index was added. Production was checked read-only and has a valid, unconditional, single-key unique index on `pre_scraped_jobs.apply_url` (see [the integration report](employer-feed-integration-2026-10-16.md)).

### Decision: C2 fix reverted

An earlier draft cleared a candidate's selection whenever its payload changed on refresh. That broke the existing backend test "feed refresh updates existing search metadata" (test 21). Employers grant refresh permission for selected listings, and the test expects a refresh to update the live listing without reselection. The change was reverted. C2 now asserts that refresh keeps the selection. The migration does not change this behaviour.

### Decision: upgrade path

`scripts/build-employer-backend.cjs --lease-upgrade` builds an incremental upgrade for an installation that already has 20261021 and 20261022 applied. It refuses to run when:

- the feed-deletion guard (`feed_closed_approver_deleted`) is absent,
- the lease/URL upgrade is already present ("Lost a concurrent URL claim" in `employer_publish_post_internal`),
- the ACLs on the replaced functions differ from the expected set,
- billing is enabled.

Verified on a database built by applying the chain through 20261022 with the employer fixture data loaded (2 organisations, 4 members, 9 auth users, 6 audit rows, no catalogue rows):

- first run: exit 0; row counts for organisations, members, auth users, catalogue and audit are unchanged;
- second run: refused (exit 3, "lease and URL upgrade already present; review before applying"), as shown in an earlier probe.

The first-install bundle was also applied to an empty database and completed.

## Verification

| Suite | Result |
|---|---|
| Lease and URL scenarios (`tests/employer-lease-selection-url-db.mjs`) | baseline 8 of 12; fixed 12 of 12 |
| `test:employer-feed-concurrency` | 15 of 15 pass |
| `test:employer-concurrency` | 16 of 16 pass |
| `test:employer-native-db` | 3 of 3 pass, 0 skipped |
| `test:employer-access` | 1 of 1 pass, 0 skipped |
| `test:employer-backend` | 79 of 79 pass |
| `tests/employer-feed-integration.mjs` | 26 of 26 pass |
| Upgrade on chain-through-20261022 database | exit 0; rows unchanged; rerun refused |

The six existing suites now include `20261023` in their migration chains, after `20261022`, using the same gating as `20261022`. The only change to existing test files is that chain list.

Results: `docs/employer-lease-selection-url-pg17-results.json` (baseline and fixed, per scenario, with observed values).

Not run in this pass: full `npm test`, the Deno checks (`check:employer-worker`, `test:employer-entrypoint`), and the edge-function paths.

## Untested or partly tested risks

1. **Production has not been upgraded with 20261023.** Production runs PostgreSQL 17.6 (read-only check); the tests run on 17.10. The upgrade has only been run on the test database. Applying it to production needs separate approval.
2. **Deselecting an already-published listing does not withdraw it (C3).** Deselect changes the selection, but the live listing stays open until something else closes it. This is consistent with the rule that publication requires a current selection, but whether deselect should withdraw a live listing is a product decision. Not changed.
3. **Cross-company URL race is deterministic only.** U1 and U2 widen the window with a test-only insert pause. An organic race between two organisations' transactions has not been reproduced. A concurrent collision can still abort the publishing transaction at the database level; the handlers only convert it into a structured result when it is raised inside the handled block.
4. **Registry `stale_batch` branch.** Under the single-lease design, the stale-batch rejection (L3) is reached, but other paths into that branch are practically unreachable and are not exercised.
5. **Catalogue data is not in the upgrade fixture.** The upgrade preservation check used no catalogue rows. Production has 736 open catalogue jobs. Preservation of populated catalogue rows is not proven by this run.
6. **Duplicate `apply_url` on catalogue ingest for fresh installs.** Not checked in this pass.
7. **Interleaving coverage.** Interleavings are deterministic (parked locks, advisory locks, test-only insert pause), not randomised. Timing windows that no lock parks are not covered.
8. **Re-approval after demotion with stale candidates.** Covered by the integration suite, not by this pass's native scenarios.

## Reproduce

```
FJ_PG_DISPOSABLE=1 PGHOST=127.0.0.1 PGPORT=54417 PGUSER=postgres npm run test:employer-feed-concurrency
FJ_PG_DISPOSABLE=1 PGHOST=127.0.0.1 PGPORT=54417 PGUSER=postgres npm run test:employer-concurrency
FJ_LEASE_FIX=1 FJ_LEASE_RESULTS=<path> node tests/employer-lease-selection-url-db.mjs   # fixed
FJ_LEASE_FIX=0 FJ_LEASE_RESULTS=<path> node tests/employer-lease-selection-url-db.mjs   # baseline
node scripts/build-employer-backend.cjs --lease-upgrade > lease-upgrade.sql             # upgrade script
```
