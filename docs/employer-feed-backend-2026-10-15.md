# Employer feed backend — October 15, 2026

**Deployment update, October 16:** Employer database migrations through `20261019_employer_pending_account_cleanup.sql` have now been installed, and the `employer-submissions` domain-verification function is deployed. The feed worker itself remains undeployed/disabled; no reviewer, employer, feed or paid entitlement was created. Read `docs/employer-launch-progress-2026-10-16.md` for current evidence and the separate sign-in/workspace release. The historical implementation status below predates this deployment.

Scope is backend only, following Franklin's latest instruction. No website HTML, design or account interface changed.

## Implemented

- `supabase/functions/employer-feed/index.ts`: Supabase entry point using the existing INGEST_SECRET, disabled unless EMPLOYER_FEED_ENABLED is explicitly true. Default dry-run. No public catalogue publishing or closure path exists in this worker.
- `handler.mjs`: independent authentication, 4 KiB streamed request bound, strict request fields, server registry lookup, bounded collection and private staging. Does not accept a source object, caller-supplied permission/paid flag or arbitrary URL. No response contains lease tokens, registry evidence or credentials.
- `migrations/pending/20261016_employer_feed_runs.sql`: private run records, one lease row per source and immutable per-run staging batches. RLS enabled, no anon/authenticated grants, no PUBLIC function execution. Backend functions are service_role-only, with fixed search_path and schema-qualified table references.
- Lease claim uses a single INSERT ... ON CONFLICT conditional update. It does not depend on a non-atomic read-then-insert count. Lease lifetime is bounded to 180 seconds and the approval expiry, whichever is sooner. Each run gets a random fencing token. A replaced worker cannot stage against or release its successor's lease.
- Staging validates source/revision/token, source-bound namespaced IDs, duplicate IDs, batch limits and summary counts. A repeat stage cannot replace an already staged batch. Partial results remain explicitly partial and have no authority to close old jobs.
- Failed collection discards rows and records a safe reason; failed cleanup leaves only the bounded lease. Provider/registry exceptions are not returned verbatim.
- Backend-only retention routine: expire abandoned collecting runs; remove completed payloads and copied source snapshots after seven days; retain aggregate run records for 30 days. The routine is implemented and tested, but no cleanup schedule is active because the migration is not deployed.

## Registry integration

Integrated Claude's commit `1d2fe3d`. The worker calls its existing `public.employer_source_for_worker(p_source text) returns jsonb`, with effective EXECUTE limited to service_role. It reads protected registry/organization state and returns null for missing/ineligible sources, or:

```json
{
  "revision": 1,
  "source": {
    "id": "the-source-id",
    "adapter": "lever",
    "api_region": "global",
    "board_token": "approved-tenant-token",
    "employer_name": "Reviewed Employer Name",
    "status": "approved",
    "enabled": true,
    "rights_basis": "employer_written_permission",
    "permission_ref": "private-evidence-reference",
    "approved_by": "trusted-reviewer-id",
    "approved_at": "2026-10-15T00:00:00Z",
    "domain_verified_at": "2026-10-15T00:00:00Z",
    "authorization_expires_at": "2026-11-15T00:00:00Z",
    "allow_display": true,
    "allow_refresh": true,
    "allow_description": false,
    "allowed_apply_hosts": ["jobs.lever.co"],
    "attribution_text": ""
  }
}
```

This is a synthetic contract example, not an approved employer. Increment a positive integer revision whenever organization, permission, enabled/status, attribution, board or host settings change. Mapping must preserve field types and return consistent values. The collector rechecks approval and configuration between requests. The later publication RPC must independently recheck the authoritative registry inside its transaction; an old staged snapshot is not authorization.

The raw run log retains a private source text reference for its bounded audit lifetime. `20261017_employer_feed_registry_bridge.sql` adds a candidate checkpoint with a real FK to Claude's employer_sources table. Its service-only `employer_feed_stage_registered_run` rechecks the actual organization/source state and exact approved snapshot under the organization/source locks, stages an immutable batch and copies it to employer_feed_candidates in the same transaction. A newer batch watermark prevents late old batches from overwriting newer candidates. Candidates remain unselected unless the employer has explicitly selected them; this path never publishes.

If the registry reader is absent in the target project, the worker returns a sanitized 503 before any provider request; covered by an entry-point test. The migrations remain unapplied in production.

## Publication hardening found during integration review

The original service-only feed publisher checked the source revision but not each stored candidate's revision. It also treated an expired row with closed_at=null as an ordinary update, which could reactivate it above the 15-active-post limit. Existing refresh updates left application/search metadata stale.

`20261017_employer_feed_publish_hardening.sql` preserves the public RPC signature and Claude's original migration while tightening the deployed definition when this integration migration is eventually applied:

- Reject selected candidates from older source revisions or last staged seven or more days ago.
- Validate known ATS links against the approved tenant and provider posting ID, along with current host permissions, title/role evidence, location/state evidence and posting dates.
- Count expired-row reactivation against the same organization quota as a new job.
- Refresh application URL, company, search_text, category, location/work metadata and attribution together; refuse URL conflicts rather than overwrite another source.
- Bound listing validity by both source permission expiry and seven days since confirmation, instead of keeping an unrefreshed vacancy visible until a long permission deadline.

Nine combined actual-SQL integration tests pass, including Claude's complete scripted permission/workflow/quota scenarios with all the pending migrations applied. This is an integration override for review, not a change applied behind Claude's back to its original file.

## Worker protocol

POST with x-ingest-secret. Body:

```json
{"source_id":"approved-source-id","max_requests":2,"dry_run":true}
```

Only these keys are accepted. max_requests is an integer from 1 to 6. **Dry-run fetches provider data**, but creates no staging run; it is not a zero-request mode. All development tests inject synthetic provider responses instead of calling any employer API.

With dry_run=false, the worker claims the source lease, collects, then atomically persists one private batch and eligible private candidate records. It returns a run ID, candidate count and accepted/rejected/request counts, with published=0. Pending/revoked/expired sources are refused. Busy source -> 409 before fetching; invalid body -> 400; absent/incorrect secret -> 401; disabled/unavailable backend -> 503. No browser CORS or public employer account invocation is provided.

The worker intentionally does NOT call ingest_upsert_jobs, any publishing RPC, Make, Adzuna or newsletter sending. Private staging is not an active job and does not consume or bypass the employer's 15-active-post allowance. Claude's actual publication transaction must enforce that allowance organization-wide and require verified entitlement for above-limit publishing. Paying still does not bypass review or source approval.

## Verification

- Full Node suite: **154 passing tests**, including 14 backend/SQL tests, 18 adapter/collector tests, 16 combined SQL integration tests and Claude's five existing helper/page regression checks.
- Deno edge tests: **13 passing tests**, with no sockets/network. Includes three worker cold-start tests and ten employer-domain endpoint tests covering identity, atomic claim wiring, byte-limited bodies, status changes, replay invalidation and sanitized upstream failures.
- Both Deno entry-point type checks pass with the repository's local edge-runtime declaration mapping.
- All pending migrations execute together in an isolated in-memory PostgreSQL engine (PGlite); these are tests of the actual SQL, not a JavaScript imitation. Effective privileges and actual denied calls are verified. The combined test imports 16 synthetic candidates, publishes zero before selection, then permits 15 selected publications and blocks the 16th.
- PGlite has one connection. The competing-claim test checks two queued claim attempts and the atomic SQL outcome, not a real multi-client Supabase stress test. Live permission checks, real concurrent transactions and an approved real source remain integration gates.
- No migration applied to Supabase; no function deployed; no feature flag enabled; no employer data fetched or staged in production; no payments activated.

Commands:

```text
npm test
npm run test:employer-backend
npx deno check --import-map=tests/deno/import_map.json supabase/functions/employer-feed/index.ts
npx deno test --allow-env --allow-read --import-map=tests/deno/import_map.json tests/employer-feed-entrypoint.ts
npx deno test --allow-env --allow-read --import-map=tests/deno/import_map.json tests/employer-submissions-edge.ts
node scripts/check-employer-search.mjs
```

PGlite 0.5.10 is a pinned development dependency for isolated SQL tests, not a website runtime dependency. No account credentials or customer records are used by these tests.

## Next integration steps (backend only)

1. Review the combined pending migrations and publication hardening. Account deletion and query visibility now have tested local integration fixes (see the review report below); production checks, required source attribution and the deferred paid-plan decisions remain activation checks.
2. Apply in dependency order after review: ingest prerequisites; `20261016_employer_feed_runs.sql`; Claude's `20261016_employer_submissions.sql`; `20261017_employer_feed_registry_bridge.sql`; `20261017_employer_feed_publish_hardening.sql`; `20261017_employer_domain_checks.sql`; `20261017_employer_account_deletion.sql`; `20261017_employer_search_visibility.sql`. Validate effective privileges and multi-client lease/publication races in the actual project. The domain endpoint now requires its new claim/finish RPCs: apply its migration before deploying that endpoint.
3. Deploy the worker with its feature flag off. Verify unauthorized/disabled gates, then enable only for one actually approved source and perform a bounded private preview/staging run.
4. Configure the backend retention job. Keep automatic refresh off until its provider allowance, permission window and monitoring destination are established.
5. The candidate/selection/publication integration passes locally. Before enabling actual public employer jobs, repeat with a permitted source and disposable authorized accounts, including the 15th/16th post, real concurrent publications, duplicate/retry behavior, revocation, attribution/provenance and complete-sweep closure safeguards. Automatic closure is still not connected to the worker.

## Follow-up backend review

See `docs/employer-backend-review-2026-10-15.md` for the domain-check race, auth-user deletion constraints and row-by-row visibility cost found during integration. The fixes are separate pending migrations; Claude's original employer migration remains intact. No frontend activity or live deployment is included.
