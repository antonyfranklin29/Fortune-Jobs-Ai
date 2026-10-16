# Employer backend integration review — 2026-10-15

Claude's `1d2fe3d` is integrated with the private collector, registry bridge and publisher hardening. All employer migrations remain pending. No employer registration, reviewer grant, feed import, payment or new function deployment has been activated in production. Franklin removed frontend/design activities; this change is backend code, tests and documentation only.

## Fixed in this review

### DNS proof must claim before resolving

The original endpoint read `checked_at`, resolved DNS, then updated the timestamp. Concurrent requests could all pass that read. It also ignored the verification RPC's boolean, so a challenge/status change could be reported as a successful proof even though the database did not verify it. Suspended organizations with an old domain verification timestamp could be reported as verified.

`20261017_employer_domain_checks.sql` provides service-only claim/finish RPCs. Claim locks the organization, verifies confirmed membership and current status, then reserves the minute before any DNS work. Finish checks the attempt UUID, current challenge token, membership, current organization state and a two-minute freshness limit. Finishing consumes the attempt; old/replayed attempts cannot verify anything. Status changes use the same organization lock. The old service helper remains for compatibility but cannot mark suspended/rejected organizations verified.

The edge endpoint resolves identity via Auth, passes only that verified user ID to the private RPC, accepts exactly action/org_id, streams a byte-limited 1,000-byte JSON body, bounds DNS wait and returns sanitized upstream failures. It reports success only from the finish RPC. No supplied domain, user ID, role or approval flag is accepted.

### Employer records must not block account deletion

Eight new attribution FKs originally referenced auth.users without an on-delete action; some were NOT NULL. The existing delete-account endpoint would remove other personal data and then fail to delete an employer/reviewer account.

`20261017_employer_account_deletion.sql` makes attribution nullable with ON DELETE SET NULL and indexes these FK columns. A private BEFORE DELETE trigger locks affected organizations in UUID order. If the departing person is the last active owner, it suspends the organization, immediately hiding its listings through RLS. Another active owner keeps a shared company live. Ordinary members never inherit ownership automatically. Membership/operator records already cascade; audit actor references are unlinked. Company/job operational history is retained; free-text permission evidence and company content are not represented as fully erased personal data.

Deleting a reviewer pauses their approved feeds as pending/disabled and increments the revision before the reviewer FK is cleared. This preserves the source's CHECK constraint and requires independent review before refresh/publication resumes. It can affect multiple organizations; this behavior must be included in operational account-closure guidance. Existing account deletion still handles storage and other account tables, with the auth user deleted last. No real account was deleted in this work.

Real simultaneous owner deletions, publication and status changes remain a disposable multi-connection PostgreSQL/Supabase verification gate. The local engine serializes statements; do not treat its tests as concurrency load evidence.

### Public visibility must not add a per-row RPC cost

The original catalogue policy called employer_listing_visible for each employer job. A 50,000-job local fixture (half employer listings, 100 organizations, some suspended/expired) showed roughly 600 ms query execution. An ordered index alone was not selected by that local planner, so no unused index is included.

`20261017_employer_search_visibility.sql` replaces the correlated helper with an uncorrelated hashed subplan. The permission key set is computed once per statement and contains only organization/source pairs already represented by eligible public catalogue jobs. The helper returns no private registry-only sources, permission evidence or company details. Anonymous callers already have SELECT access to these keys on visible job rows; the helper intentionally has read-only EXECUTE permission. Every employer write/helper RPC remains private. Claude's privilege test now explicitly allows the two read-only visibility helpers, rather than assuming there can be only one.

The permission function must be owned by the catalogue owner or a role that bypasses RLS; confirm ownership/privileges after applying. Its definition independently checks current organization/source status, source ownership, display permission, source expiry, listing expiry and closure. It does not cache across requests. Source revocation, organization suspension and last-owner deletion affect the next statement. Legacy listings short-circuit on null employer_org_id.

The local optimized queries took approximately 120–130 ms, with exactly the same visible set as explicit trusted permission checks. See `docs/employer-search-probe-2026-10-15.json` and re-run `node scripts/check-employer-search.mjs`. These are warmed in-memory PostgreSQL query timings, not end-to-end production measurements or a user load test. The final Supabase query plan and latency still need a canary before activation.

## Tests and scripts

- Full Node suite: 154 passing, including the combined original workflow/quota SQL and seven additional account/domain/visibility scenarios.
- Deno: 13 passing edge tests; worker and domain endpoint type checks pass.
- Both the native disposable-Postgres harness and in-memory integration harness now apply all pending migrations in dependency order.
- Native multi-connection harness is registered as `npm run test:employer-native-db`. It skips unless explicitly configured with FJ_PG_DISPOSABLE=1 and local PostgreSQL tools. No new claim of a native race-test pass is made here.
- Claude's existing five helper/page tests are registered in the normal suite. No page was edited.

## Remaining activation gates

Apply and verify the migration chain in the backend runbook; deploy with the worker disabled; verify effective live privileges, auth deletion and domain proof using disposable authorized accounts; establish real permission evidence for a pilot source and independently approve it; check required attribution support; then run a bounded private import before any public publication. Review paid-post maximum/downgrade policy and billing separately; paid publishing remains disabled. Automatic refresh, closure, retention scheduling, and a native concurrent canary are not enabled by this patch.
