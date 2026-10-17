# Authorized-employer pilot checklist

Status: **prepared, not executed.** No pilot has run. No employer has been invited, verified or granted reviewer access. No feed worker is enabled, no provider has been called, and paid publishing remains off.

Where each item stands is marked as one of:

- **Verified** — checked by a test or a read-only production check, with the evidence named.
- **Decision** — needs an explicit product or operator decision before the pilot.
- **Operational** — a real-world step that no automated check can complete.

## 1. Current state (as of October 16, 2026)

- **Verified.** Production runs PostgreSQL 17.6 (read-only check). `20261021` and `20261022` are applied in production. Migrations were not re-run; the first-install bundle must not be rerun on this project. Source: [integration report](employer-feed-integration-2026-10-16.md).
- **Verified.** Production has a unique index on `pre_scraped_jobs.apply_url`.
- **Verified.** Anonymous private employer RPC permissions: 0. Ordinary-role direct private table grants: 0. Paid publishing: false. Existing 15-active allowance and USD 1499-cent price unchanged. Open catalogue jobs: 736. Companies and reviewers: 0 and 0.
- **Verified (test databases only).** Migration `20261023_employer_lease_selection_url_hardening.sql` passes 12 of 12 lease and URL scenarios on PostgreSQL 17.10, and the upgrade preserves existing rows on a test database. It is **not** applied to production. See [review](employer-lease-selection-url-review.md).

## 2. Decisions required before any pilot

- **Decision — apply `20261023` to production?** Needs explicit approval. Steps: read-only confirmation of production state, `node scripts/build-employer-backend.cjs --lease-upgrade`, a single-transaction apply, and a post-apply read-only check that the upgrade is recorded and the second run is refused. No production apply is authorised by this document.
- **Decision — does deselecting a published listing withdraw it?** Today, deselecting a candidate does not close its live listing (C3). Choose: keep as is (withdraw only through the explicit close path), or withdraw on deselect. Recommend deciding before the pilot so employers know what deselect does.
- **Decision — should company suspension withdraw manual post approvals?** The integration report retains the current policy: a closed listing stays closed after re-verification, and an eligible member must reactivate deliberately. Confirm this policy for the pilot, or change it as a separate product change.
- **Decision — reviewer grants.** Independent reviewers have not been granted. Decide who reviews, and grant separately from the pilot, with a named person and an audit note.
- **Decision — feed worker.** It stays disabled. Decide whether any pilot employer's feed is enabled at all, and if so which source, what schedule and what request limit. This is a separate approval from the pilot itself.
- **Decision — paid publishing.** Stays off for the pilot unless separately approved.

## 3. Pilot eligibility and authorisation

- **Operational — written authorisation from each employer.** A signed permission letter naming the legal entity, an authorised contact, the application URLs and sources they permit, and the date range. Store it outside the repository and link the reference from the company record.
- **Operational — domain verification.** Confirm the employer controls the domain they claim, using the existing domain-check flow. Do not verify a domain on the employer's behalf.
- **Operational — named owners.** Each company has at least one owner who is a real person with a working email. Last-owner deletion closes live listings (see section 7).
- **Operational — no synthetic employers in production.** Test companies and fixtures stay in disposable databases.

## 4. Operational steps for each employer

1. Employer signs in with their own account. Staff do not sign in as the employer.
2. Employer verifies their domain and completes company profile.
3. Operator approves the feed source for that employer, if a feed is in scope. Approval must match the authorisation letter.
4. A feed collection runs only when the feed worker is enabled for that source (section 2). Otherwise the pilot is manual-only.
5. Employer selects candidates from a current collection. Publication requires a current selection and a fresh collection; a stale selection is refused.
6. Employer submits a manual post or an approved listing; an eligible member approves it.
7. Operator confirms each published listing once, against the employer's application URL. Check that the URL is the employer's and not a third-party aggregator's, unless the letter permits that.
8. Record the pilot outcome per employer: published, skipped (with reason), refused, or closed.

## 5. Monitoring during the pilot

Check at least daily, read-only:

- Open feed listings versus the active allowance (must not exceed 15 per company).
- Count of `apply_url_already_listed` skips. A rising count means two companies are competing for the same URL; investigate before the next batch.
- Partial and failed batch counts, and `stale_batch` rejections. A rising count means lease or run problems.
- Any listing open for a company that is suspended, rejected or deleted (should be zero, per the deletion fixes).
- Audit log entries for approvals, closes, revocations and deletions.
- Database errors in the Postgres log, particularly `unique_violation` raised outside the handled block.

## 6. Rollback

- **Pausing one source.** `operator_revoke_source` revokes the source and closes its open feed listings. Verify with the monitoring counts.
- **Pausing one company.** Suspend the company through the operator path. Listings close; they are not deleted.
- **Pausing the whole feed path.** Keep the feed worker disabled. This needs no database change.
- **Rolling back `20261023`.** **Gap:** no down-migration script is prepared. The fix replaces three functions with the same signatures, so rolling back requires restoring their previous definitions from `20261021` and `20261022` in a reviewed script. Prepare and test that script on a copy of production before any apply.
- **Data rollback.** The fixes do not delete rows. Closed listings keep their records and can be reopened only through the normal approval and re-activation checks.

## 7. Deletion and retention

- **Verified.** Deleting an approving operator or the last owner closes the affected feed or manual listings in the same transaction (20261021 fixes; L6 and deletion scenarios). Records are retained.
- **Decision — retention period.** Define how long `employer_feed_runs`, `employer_feed_leases`, `employer_feed_staging` and audit rows are kept, and who can see them.
- **Operational — deletion requests.** Confirm the process for an employer asking for deletion, including the time to close listings and the time to remove retained personal data.

## 8. Known gaps and risks

- The cross-company URL race is proven only with a deterministic insert pause, not an organic race.
- The registry `stale_batch` branch is reached under the single-lease design but is otherwise practically unreachable.
- Catalogue data was not in the upgrade test fixture. Production has 736 open catalogue jobs. Check preservation on a copy of production before any apply.
- Duplicate `apply_url` on catalogue ingest on fresh installs was not checked.
- The full `npm test` suite and Deno checks were not run in the latest pass.
- The paused-card behaviour in the employer workspace is verified with synthetic SQL fixtures, not a real employer. Verify in a real pilot session before relying on it.

## 9. Exit criteria for the pilot

The pilot is complete only when all of these hold:

- Every pilot employer has a written authorisation, verified domain and named owner.
- No listing is open for a company that should not have one, per the monitoring checks, at the end of the pilot.
- No `apply_url` collision led to a lost claim, a silent overwrite, or a batch that aborted without reporting.
- Every batch outcome (complete, partial, failed) was recorded accurately.
- Each open decision in section 2 has an explicit answer recorded in the repository.
- The rollback for `20261023` is prepared and tested on a copy, if the migration has been applied.

Until these are met, do not describe the employer feed as launched.
