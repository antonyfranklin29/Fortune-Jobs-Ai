# Employer concurrency review — Claude, 2026-10-16

Follow-up to `docs/claude-employer-access-review.md` (commit `f852633`, branch
`claude/employer-access-review`). This branch is built on that commit. Backend only. Nothing is
applied to production, deployed, granted or enabled. Payments remain disabled and no reviewer has
been granted access. Codex's files and the pending migrations already in the repo are unchanged.

## Question

With two or more requests running at once, do quotas, company ownership and publication
permissions stay correct? In particular: an account deleted or banned during a publication, two
owners deleted at the same time, and two companies verifying the same domain at the same time.

## Answer

No, not on the chain before this branch. Twelve of the sixteen interleavings fail there. Every
failure in the results table is reproduced by a deterministic interleaving on PostgreSQL. The
risks listed at the end are not tested, and are marked as such. The most serious defects are:

- A publish that is already in flight when its actor is banned still goes live (S02).
- An owner's close and an operator's close can each leave a live listing behind a closed post (S03, S04).
- An operator takedown can be re-opened by the owner (S16).
- Owner deletion deadlocks with approval in both orders, so a deletion can fail with `deadlock detected` (S07–S10).
- Operator review and owner close deadlock, as do operator close and owner re-activation (S05, S06).
- A domain collision during verification surfaces as a raw `duplicate key value` error (S12).

The quota (S13) and the two-owners deletion (S11) already held. One new migration,
`migrations/pending/20261019_employer_concurrency_hardening.sql`, fixes all of the above. With it,
all sixteen scenarios pass, and the existing suites still pass.

## Method

- Disposable PostgreSQL 16.15 (`/var/tmp/fjpg`, port 54329). Never a Supabase project.
- The Supabase role and auth shim, the ingest migrations and every pending employer migration are
  applied in dependency order to a template. Each scenario runs in its own database cloned from
  that template, so the scenarios cannot affect one another.
- `tests/sql/employer-concurrency-fixtures.sql` creates company A (owner A, co-owner X, member M),
  company B (single owner B), company C users, and an operator. Verification follows the access
  suite: DNS proof by the service role, then operator verification with a note.
- Each actor is a persistent `psql` session with `set role authenticated` and the user's JWT claim.
  A statement is "blocked" only when `pg_stat_activity` reports `wait_event_type = 'Lock'`, so each
  interleaving is forced in order rather than hoped for.
- Two-transaction races (the domain race) use an explicit open transaction, so the second statement
  overlaps the first's uncommitted state.
- Where a scenario needs an approved but unpublished post, the fixture sets the state directly and
  then runs the real publish path. Everything else goes through the real RPCs.
- Assertions check the outcome, not just the absence of an error. For example, a close is correct
  only if the post and its open listing agree, and an approval is correct only if the job is open.

## Results

Command: `FJ_PG_DISPOSABLE=1 PGHOST=/var/tmp/fjpg PGPORT=54329 PGUSER=postgres node --test tests/employer-concurrency-db.mjs`
Baseline is the chain through `20261018_employer_access_hardening.sql`. With fix adds
`FJ_CONC_FIX=1`, which also applies `20261019_employer_concurrency_hardening.sql`.

| # | Scenario | Baseline | With 20261019 |
|---|---|---|---|
| S01 | Ban applied before activation (control) | PASS | PASS |
| S02 | Ban committed while an activation is waiting on the organisation lock | **FAIL** | PASS |
| S03 | Owner close vs publish, unpublished approved post | **FAIL** | PASS |
| S04 | Operator close vs publish, unpublished approved post | **FAIL** | PASS |
| S05 | Operator review vs owner close (lock order) | **FAIL** | PASS |
| S06 | Operator close vs owner re-activation of a live post (lock order) | **FAIL** | PASS |
| S07 | Owner deletion, approval already queued (approval first) | **FAIL** | PASS |
| S08 | Owner deletion first, approval queued behind it | **FAIL** | PASS |
| S09 | Last owner deleted, approval queued (deletion first) | **FAIL** | PASS |
| S10 | Last owner deleted after approval (approval first) | **FAIL** | PASS |
| S11a | Two owners deleted at once, A first | PASS | PASS |
| S11b | Two owners deleted at once, X first | PASS | PASS |
| S12a | Two companies verify one domain, C1 first | **FAIL** | PASS |
| S12b | Two companies verify one domain, C2 first | **FAIL** | PASS |
| S13 | Quota at 14 with three concurrent publishers | PASS | PASS |
| S16 | Owner re-activates an operator-closed post | **FAIL** | PASS |
| | **Total** | **4 pass, 12 fail** | **16 of 16 pass** |

The baseline run's test result is `fail 1`, because the test asserts that every scenario passes.
The per-scenario lines above are the ones that matter.

Observed values from the logged runs (the exact text the harness recorded):

- S02 baseline: `ban committed while publish waited: true; publish: {"published": true}; open jobs: 1`.
  Fix: `ban committed while publish waited: false`.
- S03 baseline: `post status closed; open jobs 1`. Fix: `post status closed; open jobs 0`.
- S04 baseline: `post status published; open jobs 1`. The operator's takedown was overwritten by
  the in-flight publish. Fix: `post status closed; open jobs 0`.
- S05, S06, S08, S09, S10 baseline: `deadlock detected`. S07 baseline: approval published, deletion
  failed with `ERROR: deadlock detected`.
- S12 baseline, loser's error: `duplicate key value violates unique constraint "employer_orgs_domain_claimed_uq"`
  (from the server log). The safety property held (`verified 1`). Only the error text was wrong.
  Fix: loser gets `domain_already_claimed`.
- S16 baseline: the owner's activation returned `{"published": true}` with one open job after the
  operator closed the post. Fix: `review_required`, no open job.
- S13, both runs: `published 1, upgrade_required 2, active 15`.
- S11, both runs: `org suspended; active owners 0; suspension audit rows 1; errors: false`.

### Regression, with 20261019 applied

- `tests/sql/employer-access.sql` on the chain plus 20261019: `PASS: employer access review`.
- `npm run test:employer-access` (chain without 20261019): 1 pass, 0 fail.
- `tests/employer-submissions-db.mjs` (native harness): 3 of 3.
- `tests/employer-feed-integration.mjs tests/employer-feed-backend.mjs tests/employer-submissions.mjs`: 35 of 35.
- `npm test`: 154 tests, 152 pass. The two failures are in `tests/resume-extraction.cjs`
  (PDF and DOCX parsing). They are the same two that failed on `origin/main` before this work.

## Defects demonstrated and their fixes

**D1 — Stale close (S03, S04, S16).** `employer_close_post` read the post without a lock, took the
organisation lock, and then closed the job id it had read before the lock. A publish that committed
in between left a closed post with a live listing. `operator_close_post` took no organisation lock
at all. A publish in flight could therefore re-open a post the operator had just closed, because
publication accepts `closed` as a starting status. Fix: both closes take the organisation lock, then
re-read the post `for update` and close the job they find there. The operator close also clears
`reviewed_revision`, so an owner cannot re-activate a takedown. S16 showed this was reachable.

**D2 — Lock-order deadlocks (S05, S06).** Operator review locked the post and then the organisation,
while publication and owner close locked the organisation and then the post. Operator close locked
the job before the post. Fix: one order everywhere. The actor and the post's parties are locked
first, then the organisation, then the post, then the job.

**D3 — Ban during an in-flight publish (S02).** `employer_caller()` checks eligibility when the call
starts. A ban committed while the publish waited for the organisation lock was ignored. Fix:
publication share-locks the actor's `auth.users` row before taking the organisation lock. A ban
then waits for an in-flight publish, and a publish that starts after the ban is refused with
`account_banned`. The lock-order check in the same function also re-checks membership after the
lock, so a removal committed first is honoured.

**D4 — Owner deletion vs approval (S07–S10).** This was not predicted by code reading, and the
mechanism was found by experiment. Every update of an `employer_posts` row runs the foreign-key
check on `created_by` and `reviewed_by`. That check takes `FOR KEY SHARE` on the referenced
`auth.users` row. Account deletion holds that row exclusively and then waits for the organisation
lock. An approval that already holds the organisation lock then waits on the deleted creator's row.
That is a cycle. Confirmed by experiment: with only `SELECT ... FOR UPDATE` on owner A's auth row
held open, an approval of A's post blocked with `canceling statement due to lock timeout` while
locking the `FOR KEY SHARE` check on `users`. The same approval on company B's post, while owner A's
delete was uncommitted, completed. Fix: the post's creator and reviewer are key-share locked before
the organisation lock (`employer_lock_post_parties`), which matches the deletion's order.

**D5 — Raw domain-collision error (S12).** The unique index on verified or suspended domains held,
so the safety property was never broken. The loser nevertheless received the raw unique-violation
text. Fix: `operator_set_org_status` maps `unique_violation` to `domain_already_claimed`.

Not defects, confirmed by the same runs: two owners deleted at once suspend the organisation exactly
once and leave no active owner (S11). Three concurrent publishers at 14 active allow exactly one
into the fifteenth slot (S13). The ban control (S01) refuses the activation.

## Migration summary (`migrations/pending/20261019_employer_concurrency_hardening.sql`)

- Refuses to run unless `20261018_employer_access_hardening.sql` is already applied.
- Adds `employer_lock_actor(uuid)`, which share-locks the actor and enforces confirmation, deletion and ban.
- Adds `employer_lock_post_parties(uuid)`, which key-share-locks the post's creator and reviewer.
- Redefines `employer_publish_post_internal`, `employer_activate_post`, `employer_close_post`,
  `operator_review_post`, `operator_close_post` and `operator_set_org_status`.
- Signatures and grants are unchanged (`create or replace`). The new helpers are revoked from
  PUBLIC, `anon`, `authenticated` and `service_role`.
- Changes no existing migration.

## Changes on this branch

New:
- `migrations/pending/20261019_employer_concurrency_hardening.sql`
- `tests/employer-concurrency-db.mjs` (16 scenarios; `FJ_PG_DISPOSABLE=1` to run; `FJ_CONC_FIX=1` to include the fix; `FJ_CONC_ONLY=S07` to run one)
- `tests/sql/employer-concurrency-fixtures.sql`
- `docs/claude-employer-concurrency-review.md` (this report)

Edited:
- `package.json` — one script, `test:employer-concurrency`.

Not touched: frontend files, login and account flows, navigation, Codex's files, and every existing
pending migration.

## Unresolved risks

1. **Membership removal is not covered.** No removal function exists in the backend migrations. The
   publish path now re-checks membership after the organisation lock, which narrows the window, but
   a removal function must itself take the organisation lock, or the race returns.
2. **A ban does not suspend the organisation or close the banned owner's live listings.** This is
   by code reading (the ban check only reads `auth.users`). It is not tested. Those listings stay
   live until an operator acts.
3. **Feed and source paths are not exercised.** `employer_publish_feed_jobs`,
   `employer_close_feed_jobs`, `operator_review_source`, `operator_revoke_source`,
   `employer_apply_downgrade`, `employer_submit_source` and `employer_save_post` are not in the
   concurrency harness. `employer_save_post` takes only the post lock, which by reading creates no
   cycle with publication, but that is unverified.
4. **Operator takedowns are now final unless a new decision is made.** Owners cannot edit a closed
   post (`post_closed`), and an operator approval needs a pending revision. After this migration a
   takedown can be undone only by adding a reinstatement path. This is a product decision for
   Franklin and Codex, not something to decide in code.
5. **Interleavings are deterministic, not exhaustive.** Each scenario forces one ordering. Random
   or stress interleavings were not run.
6. **Version dependence.** The tests run on PostgreSQL 16.15 with the Supabase shim. The
   foreign-key locking behaviour (D4) should be confirmed on the Supabase project's PostgreSQL
   version before the fix is relied on.
7. **Other chains do not include 20261019.** The native submissions harness, the feed integration
   test and the access runner keep their own migration lists without the new file. Whoever applies
   the migration must add it to those lists. It requires 20261018 first.
8. **The domain race fix depends on the unique index.** The index is the real guard. The handler
   only changes the message.

## Deployment blockers

1. Codex review of this branch, the new migration and the fixture changes.
2. Apply after review, in dependency order: the 20261016 and 20261017 files, then
   `20261018_employer_access_hardening`, then `20261019_employer_concurrency_hardening`.
3. Re-run `tests/employer-concurrency-db.mjs` with `FJ_CONC_FIX=1` against the chain as it will be
   applied.
4. Decide the reinstatement path for operator takedowns (risk 4), and whether a membership removal
   function is needed before launch (risk 1).
5. Payments and reviewer grants stay off until Franklin decides.
