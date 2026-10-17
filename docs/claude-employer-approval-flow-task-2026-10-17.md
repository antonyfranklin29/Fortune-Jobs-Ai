# Task for Claude: employer approval flow

Continue from current main (including Codex's b677dec URL integration and the maintenance follow-up). Work on a separate branch.

Own the employer approval-flow rehearsal and reproduced fixes. Use disposable local accounts and PostgreSQL to test company registration, domain verification, independent reviewer approval/rejection, revision changes, permission expiry, source revocation and the feedback employers receive. Fix defects you can reproduce, while preserving the shared 15-active-job allowance and the refresh coordinator's safe closure rules.

Read docs/employer-url-integration-2026-10-17.md first, then the maintenance report. Employers must never approve their own jobs or feeds. Existing source approval must remain tied to the exact reviewed revision. Do not grant real reviewers, enable feeds/payments, call paid providers or change production. Keep synthetic accounts and jobs out of production. Leave maintenance, retention, scheduling and monitoring files to Codex.

Return commits, local test evidence, exact reproduced problems fixed and remaining pilot blockers. Do not merge or deploy your branch until the combined migration chain has been reviewed.
