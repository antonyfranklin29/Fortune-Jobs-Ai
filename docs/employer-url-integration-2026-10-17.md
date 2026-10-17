# Claude review integration — October 17, 2026

Claude's branch `claude/employer-lease-selection-url-review` (8962a74, 8682283)
was based on 0d600ec, before the deployed Codex refresh coordinator. Its work was
reviewed against current main, rather than merged wholesale.

## Adopted and adjusted

The two publisher savepoint changes are integrated in
`migrations/pending/20261024_employer_url_conflicts.sql`:

- A direct employer post that loses a concurrent application-URL claim returns
  `apply_url_already_listed` instead of a raw uniqueness error.
- A feed batch skips the colliding candidate and can publish its other valid,
  selected candidates within the existing company allowance.
- Codex narrowed both handlers to the actual public catalogue's valid,
  unconditional single-key unique index on `apply_url`. An unrelated uniqueness
  failure is re-raised and remains visible to the failure/rollback path.

No index, role, grant, entitlement, company or job row is added by the upgrade.
Both replaced functions keep their existing signatures and effective grants.

## Deliberately not adopted

Claude's proposed replacement of `employer_feed_stage_registered_run` closes
missing listings as soon as a batch is staged. It checks only staged status,
which means a complete response with rejected rows, or a single empty response,
can close previously valid listings. A later settlement failure also cannot undo
those earlier committed closures. This bypasses the deployed coordinator's
clean-enumeration, empty-confirmation and atomic-settlement rules.

The staging replacement was therefore excluded. The coordinator remains the
only HTTP refresh path that reconciles vacancies: clean complete sweeps only,
two clean empty observations at least five minutes apart, current permission
and lease fences, and publication/closure in the same transaction. Partial or
failed collection preserves existing listings. Existing expiry rules still apply.

The historical reports are preserved with an integration warning. Their
proposed migration is not included in the integrated migration chain. Do not
apply that branch's original lease-upgrade bundle to the production project.

## Independent verification

- Updated baseline: 9/12 of Claude's scenarios pass on the already deployed
  coordinator, with the three expected URL races failing. The previous L6 gap is
  already handled at settlement, not staging.
- Integrated fix: all 12/12 pass on disposable PostgreSQL 17.11 with independent
  sessions and observed lock waits. L6 explicitly proves staging leaves the old
  listing open, then clean coordinator settlement closes it. C1 now queues the
  selection first under the shared company lock introduced by the coordinator.
- All existing 31 employer/feed race scenarios and six coordinator scenarios
  pass, for 49 named native concurrency scenarios in the combined runs. Native
  role/access, workflow and 15-slot quota scenarios also pass.
- Full application suite: 198/198 pass, including a regression showing unrelated
  unique violations are not misreported as duplicate URLs.
- Forward upgrade, repeated-upgrade refusal, rollback, repeated-rollback refusal
  and re-application preserve all 736 synthetic catalogue rows, company/account
  records, audit entries, control state and exact staging/closure definitions.
- First-install bundle also passes. No production user or employer was used in
  a test, no provider was called and no job was deleted for testing.

Evidence: `employer-url-baseline-pg17-2026-10-17.json` and
`employer-url-fixed-pg17-2026-10-17.json`. Claude's original PostgreSQL 17.10
results remain separately attributed in
`employer-lease-selection-url-pg17-results.json`.

## Deployment

Applied to production on October 17, 2026. Both publisher fixes are confirmed
present. The before/after digest of every catalogue record is identical, with
736 open jobs. The exact staging and coordinator closure definitions are also
identical. Anonymous private function execution and ordinary-role private table
grants remain zero. Companies and reviewers remain zero; refresh and billing
flags remain false. Public catalogue and site reads pass. No Edge Function or
frontend deployment was needed for this SQL-only update.

Post-deployment verification is recorded in the live-before/live-after evidence
files. The upgrade is built with:

~~~sh
node scripts/build-employer-backend.cjs --url-upgrade
~~~

The builder requires the deployed refresh baseline, disabled collection and
billing, retains all existing effective ACLs, and verifies that every unrelated
employer function definition is unchanged. It refuses a repeated apply.

Rollback is prepared and tested:

~~~sh
node scripts/build-employer-backend.cjs --url-rollback
~~~

It restores only the two previous publisher definitions. The refresh coordinator,
staging, selections, vacancy closure, controls, records and grants remain intact.
Pause collection before either operation. The rollback is for restoring previous
behaviour; it deliberately restores the former URL-race error behaviour too.
Never run the first-install bundle on this existing project.

## Current pilot gates

The first employer pilot remains pending. A real employer must grant permission,
verify its domain and have its exact source approved by an independently named
reviewer. Employers cannot approve their own posts or feeds. No reviewer is
created by this integration. The owner must enter the ingest secret directly
into the GitHub runner configuration before scheduling is enabled.

For that reviewed source, first collect without selections, choose a small set
through the employer workspace, then verify public search, attribution, the
application destinations and the shared 15-active limit. Test withdrawal only
with a controlled vacancy authorised by the employer. Confirm health monitoring,
notifications and source revocation before scheduling routine collection.

The six-hour source interval and one-source-per-15-minute runner remain the
bounded pilot defaults. Collection, payments and reviewer grants stay off until
their separate prerequisites are met. This review is not an employer launch,
a nationwide-coverage claim or a 100-simultaneous-user load test.
