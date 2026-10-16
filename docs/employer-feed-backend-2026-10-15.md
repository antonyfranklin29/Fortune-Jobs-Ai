# Employer feed backend — October 15, 2026

Scope is backend only, following Franklin's latest instruction. No website HTML, design or account interface changed.

## Implemented

- `supabase/functions/employer-feed/index.ts`: Supabase entry point using the existing INGEST_SECRET, disabled unless EMPLOYER_FEED_ENABLED is explicitly true. Default dry-run. No public catalogue publishing or closure path exists in this worker.
- `handler.mjs`: independent authentication, 4 KiB streamed request bound, strict request fields, server registry lookup, bounded collection and private staging. Does not accept a source object, caller-supplied permission/paid flag or arbitrary URL. No response contains lease tokens, registry evidence or credentials.
- `migrations/pending/20261016_employer_feed_runs.sql`: private run records, one lease row per source and immutable per-run staging batches. RLS enabled, no anon/authenticated grants, no PUBLIC function execution. Backend functions are service_role-only, with fixed search_path and schema-qualified table references.
- Lease claim uses a single INSERT ... ON CONFLICT conditional update. It does not depend on a non-atomic read-then-insert count. Lease lifetime is bounded to 180 seconds and the approval expiry, whichever is sooner. Each run gets a random fencing token. A replaced worker cannot stage against or release its successor's lease.
- Staging validates source/revision/token, source-bound namespaced IDs, duplicate IDs, batch limits and summary counts. A repeat stage cannot replace an already staged batch. Partial results remain explicitly partial and have no authority to close old jobs.
- Failed collection discards rows and records a safe reason; failed cleanup leaves only the bounded lease. Provider/registry exceptions are not returned verbatim.
- Backend-only retention routine: expire abandoned collecting runs; remove completed payloads and copied source snapshots after seven days; retain aggregate run records for 30 days. The routine is implemented and tested, but no cleanup schedule is active because the migration is not deployed.

## Registry bridge required from Claude

Provide `public.employer_feed_source_snapshot(p_source_id text) returns jsonb` with effective EXECUTE limited to service_role (revoke PUBLIC, anon, authenticated). It must read actual protected registry/organization state, not caller-provided approval claims. Return null for missing/ineligible sources, or:

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

No FK to a guessed registry table was introduced: source_id remains a private text reference pending review of Claude's actual schema. Before production integration, agree a typed source relationship and deletion/revocation handling. The missing registry bridge currently results in a sanitized 503 before any provider request; covered by an entry-point test.

## Worker protocol

POST with x-ingest-secret. Body:

```json
{"source_id":"approved-source-id","max_requests":2,"dry_run":true}
```

Only these keys are accepted. max_requests is an integer from 1 to 6. **Dry-run fetches provider data**, but creates no staging run; it is not a zero-request mode. All development tests inject synthetic provider responses instead of calling any employer API.

With dry_run=false, the worker claims the source lease, collects, then persists one private batch. It returns a run ID and accepted/rejected/request counts, with published=0. Pending/revoked/expired sources are refused. Busy source -> 409 before fetching; invalid body -> 400; absent/incorrect secret -> 401; disabled/unavailable backend -> 503. No browser CORS or public employer account invocation is provided.

The worker intentionally does NOT call ingest_upsert_jobs, any publishing RPC, Make, Adzuna or newsletter sending. Private staging is not an active job and does not consume or bypass the employer's 15-active-post allowance. Claude's actual publication transaction must enforce that allowance organization-wide and require verified entitlement for above-limit publishing. Paying still does not bypass review or source approval.

## Verification

- Full Node suite: **133 passing tests**, including 14 new backend/SQL tests and 18 adapter/collector tests.
- Deno cold-start/entry-point wiring: **3 passing tests**, with no sockets/network. Exercises disabled/auth gates, actual HTTP-to-RPC argument wiring, no credential forwarding to providers, zero publication and a missing registry bridge.
- Deno entry-point type check passes with the repository's local edge-runtime declaration mapping.
- The pending migration executes in an isolated in-memory PostgreSQL engine (PGlite); these are tests of the actual SQL, not a JavaScript imitation. Effective privileges and actual denied calls are verified.
- PGlite has one connection. The competing-claim test checks two queued claim attempts and the atomic SQL outcome, not a real multi-client Supabase stress test. Live permission checks, real concurrent transactions and an approved real source remain integration gates.
- No migration applied to Supabase; no function deployed; no feature flag enabled; no employer data fetched or staged in production; no payments activated.

Commands:

```text
npm test
npm run test:employer-backend
npx deno check --import-map=tests/deno/import_map.json supabase/functions/employer-feed/index.ts
npx deno test --allow-env --allow-read --import-map=tests/deno/import_map.json tests/employer-feed-entrypoint.ts
```

PGlite 0.5.10 is a pinned development dependency for isolated SQL tests, not a website runtime dependency. No account credentials or customer records are used by these tests.

## Next integration steps (backend only)

1. Review Claude's registry/organization/publication schema, quota enforcement and service-only snapshot bridge. Reconcile source identifiers and ownership. Do not change Claude's pending migration independently.
2. Review/apply the private feed-run migration together with the registry prerequisites. Validate effective privileges in the actual project and multi-client lease races.
3. Deploy the worker with its feature flag off. Verify unauthorized/disabled gates, then enable only for one actually approved source and perform a bounded private preview/staging run.
4. Configure the backend retention job. Keep automatic refresh off until its provider allowance, permission window and monitoring destination are established.
5. Connect reviewed staged rows to Claude's source/organization-scoped publishing transaction. Verify the 15th/16th post, concurrent publications, duplicate/retry behavior, revocation, attribution/provenance and closure safeguards before any public employer jobs are activated.
