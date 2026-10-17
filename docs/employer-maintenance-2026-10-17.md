# Private employer maintenance — October 17, 2026

Codex owns maintenance, retention and monitoring. Claude owns the separate
[approval-flow rehearsal and fixes](claude-employer-approval-flow-task-2026-10-17.md).
No general interface redesign or payment work is included.

## Behaviour

The old unscheduled, unbounded feed-prune function is replaced by a compatibility
entry point into a bounded, approval-gated maintenance function. New installation
creates only private controls/functions and an index; it enables no deletion.
The default operation computes a dry-run report and updates a singleton status
record. No job, account, resume, source permission or audit record is removed.

The proposed policy uses the existing seven-day retention for old staging
payloads and copied source snapshots, and 30 days for terminal run summaries.
The latest registered batch is protected regardless of age, as are collecting
runs, sources with a live lease and sources associated with an admitted refresh.
Old protected batches and abandoned collecting runs are reported for review.
Registry permission evidence, employer candidate choices, accounts, public
catalogue rows and audit records are outside the cleanup scope.

A batch selects at most 25 run records by default (maximum 50), removes at most
1,000 staging payload rows, and never deletes a parent run while child payloads
remain. Eligible counts are bounded candidate counts, not a promise that every
candidate can be removed in one batch. Locked rows are skipped, not waited on.
When actual cleanup is eventually approved, it takes the coordinator control
before lease/run locks, rechecks eligibility after locking, and refuses to run
while an admission is outstanding. A subtransaction rolls back all removals if
any cleanup step fails, then records a sanitised failure outside that rollback.
No exception message, permission reference or payload is returned in reports.

The public HTTP handler accepts only maintenance_preview and maintenance_health
under the existing private ingest-secret and project JWT gates. Preview always
calls the database with p_apply=false and a fixed limit of 25. It rejects apply,
retention-day, source and arbitrary-action overrides. There is no HTTP purge
route. The legacy employer_feed_run_prune alias also respects cleanup_enabled.
The private internal candidate selector is not executable even by service_role;
only the owning functions can invoke it. Ordinary roles cannot read the control
or execute any maintenance function.

## Schedule and monitoring

The daily database job is named fortunejobsai-employer-maintenance-dry-run and
its command is fixed to: select public.employer_maintenance_run(false,25);
Its saved schedule is 15 8 * * * (08:15 GMT, the verified database cron timezone).
It contains no token, HTTP call, provider call or external destination.
The database control remains cleanup_enabled=false. Even changing that control
alone will not make this scheduled command purge records.

The scheduler schema and tables are restricted from PUBLIC, anon and
authenticated. Supabase-owned extension functions may retain PUBLIC EXECUTE
because their owner controls those grants; denying schema USAGE prevents
ordinary roles from calling them. Local role-switched tests verify that both
scheduler calls and table reads fail even with function EXECUTE retained.
Installation grants no scheduler access to visitors or signed-in users.
The installer verifies the effective schema gate before
committing, refuses to overwrite a conflicting command with the same job name,
and can be safely re-run for the same approved dry-run command.

Maintenance health distinguishes last_checked_at from last_cleanup_at. A
successful preview never claims that cleanup occurred. It reports failed or
missing checks (36-hour threshold), stale collecting runs, protected old batches,
the scheduler's active flag and last execution status. Only aggregate counts and
operational timestamps are returned.

A separate GitHub monitor is prepared for 08:45 UTC. It only reads private health
and fails the workflow for overdue, failed or inactive maintenance. It requires
repository variable EMPLOYER_MAINTENANCE_MONITOR_ENABLED=true and the owner-entered
INGEST_SECRET Actions secret. These GitHub settings are not enabled by this
release; no email, Slack or other external alert message is sent. The database
preview schedule does not depend on GitHub credentials.

## Validation

- 211 application tests pass, including 13 maintenance/policy/monitor cases.
- 18 Deno entrypoint/security tests pass; the exact deployed bundle passes its
  four entrypoint cases with provider/database network replaced by fixtures.
- Three new native PostgreSQL 17.11 interleavings pass: a worker holding a lease,
  a locked old run, and cleanup finishing before a waiting worker. The last case
  also verifies that overlapping maintenance gets busy and that the new lease
  and collecting run survive.
- The existing six native coordinator scenarios and native access suite pass
  against the combined chain. The older 49-scenario report remains historical;
  all 49 were not rerun in this change.
- Local synthetic tests verify preview immutability, approval gating, latest-batch
  protection, row/run caps, failure rollback, missing/failed monitoring, schedule
  idempotency and refusal to overwrite a differently configured job. No real
  account, resume or job was used in destructive testing.

## Deployment and safe operation

Applied to production on October 17, 2026. The additive installer committed with
all existing employer function ACLs preserved, and every unrelated function
definition unchanged. The old prune alias is the only replaced definition.
The employer-refresh bundle was deployed through the authenticated dashboard;
platform JWT verification remains on, with the existing private secret gate.
Bundle: 36,299 bytes, SHA-256
967cddcbecd82ceb2a27db2437e247841f6b3cbad7586041b6404cd43481c13c.

The scheduled command was rehearsed at minute cadence without changing its
false argument, then restored to the daily schedule. Cron recorded succeeded
at 18:00:00 UTC; last_status is dry_run, cleanup_enabled is false and
last_cleanup_at is null. Eligible and removed counts were zero. The live
catalogue remains at 736 open rows; there are zero employer organisations,
reviewers and feed runs. Collection and paid publishing remain disabled.
Current catalogue/function digests in the evidence are explicitly current
snapshots, not comparisons to older reports using a different digest expression.

The public key receives 401/42501 for the maintenance RPC and control table,
401/unauthorised for the worker without its private secret, and 200 for public
job reads. The authorised HTTP path was exercised with fixtures in the exact
bundle, not with a retrieved production secret. The actual database health and
scheduled preview were verified in production. External GitHub alerts remain
disabled pending owner-entered runner configuration.

Evidence: [live status](employer-maintenance-live-2026-10-17.json),
[schedule rehearsal](employer-maintenance-schedule-live-2026-10-17.json),
[anonymous access probes](employer-maintenance-anon-probes-2026-10-17.json).

The migration identifier is 20261025_employer_maintenance.sql; identifiers follow
the repository's sequence and are not claims about the deployment date.
Build the additive upgrade with node scripts/build-employer-maintenance.cjs.
Never rerun the first-install employer bundle on the existing project.

The database dry-run schedule is generated by:

    node scripts/build-employer-maintenance.cjs --schedule --install-extension

The extension flag is used only when pg_cron is available but not installed.
This uses Supabase's existing Postgres module, with no external account or
payment setup. See the official [installation documentation](https://supabase.com/docs/guides/cron/install)
and [Cron guide](https://supabase.com/docs/guides/cron).

Build the single-file employer-refresh Edge Function with the same pinned
esbuild command as the existing refresh runbook. Keep project JWT verification
on. The two maintenance routes reuse the existing runtime service credentials;
no secret was retrieved, replaced, printed or copied into source control.

Stop the schedule reversibly by setting only this job's active flag false with
cron.alter_job; do not drop the extension, since that would remove all jobs.
Do not restore the old unbounded prune definition as a rollback. Leaving the
new control disabled is the safe state while investigating.

Actual data removal remains pending review of the dry-run policy and separate
approval. Activating destructive cleanup or replacing the job's false argument
with true is not authorised by this implementation. Review proposed counts,
verify recovery arrangements and use a bounded batch only after approval.
This is a maintenance feature, not a claim that backups, a real employer pilot,
provider coverage or every launch-security check is complete.
