# Employer feed refresh: implemented and deployed, collection disabled

The employer feed backend now connects collection, employer selections, shared
quota publication, vacancy closure, private operational logs and a scheduled
runner. The database upgrade and `employer-refresh` Edge Function were applied
to project `hqgakkcxcyspqhnlnscv` on October 16, 2026. This is not a claim that
new employer jobs have been collected: there are zero employer organisations,
zero reviewers and zero approved sources. The existing 736 open catalogue jobs
were preserved. Billing remains disabled.

## What changed

- The coordinator admits one source at a time with a 180-second ticket. A source
  must already have independently reviewed, current employer permission and
  domain verification. Its URL cannot be supplied in an HTTP request.
- It reuses the tested Greenhouse/Lever collector: at most six provider requests
  and 500 records per run. Existing host/tenant restrictions, response-size limits
  and permission rechecks remain in place. Provider requests receive no project
  keys, ingest secret or user information.
- Settlement verifies the current approval snapshot/revision, latest registered
  run, current collection lease, exact immutable staging payloads and ticket
  expiry **after** blocking locks. Old workers cannot settle a newer collection.
- Only selected candidates in that run can publish. The existing database
  publisher still enforces the combined manual/feed allowance of 15 active jobs
  per company; the paid entitlement switch remains off.
- A clean, complete enumeration closes missing or deselected source jobs before
  publishing into freed slots, in one transaction. Rejected rows or partial
  pagination suppress closure. Provider/staging/settlement failure never commits
  a closure. Existing seven-day listing validity still applies during an outage.
- A completely empty feed needs two clean empty enumerations at least five
  minutes apart under the same approval revision. A failed, partial, nonempty or
  superseding expired attempt interrupts that confirmation sequence.
- Settlement is idempotent. An unexpected publisher error rolls back publication
  **and** closure; a separate failure call records a sanitised operational code.
- Normal refresh interval is six hours. Failures back off from 15 minutes up to
  six hours. An employer changing selections wakes the queue, with a five-minute
  minimum from that source's previous attempt.
- Saving choices now uses one owner-scoped transaction instead of separate
  select/deselect requests. Both the legacy toggle and new replacement API lock
  the acting account before the company, matching publication/deletion order.
  Candidate choices show only the latest registered batch at the current source
  revision. Saving never claims that publication happened immediately.

## Controls and monitoring

`employer_refresh_control`, `employer_refresh_schedule` and
`employer_refresh_attempts` have RLS enabled and no ordinary-role table grants.
Claim/fail/finish/health RPCs are service-only; PUBLIC EXECUTE is revoked.
The trigger helper is not executable by service_role either. The new choice RPC
is available only to authenticated users and resolves company membership from
the authenticated identity, not request metadata. No real user was given a role.

`employer-refresh` retains Supabase's platform JWT verification. The scheduled
runner supplies the website's **public** project key to satisfy that gate and
also supplies the private `INGEST_SECRET`, which is the actual caller authority.
The secret is never put in source code, output or command-line arguments.
Requests missing the ingest secret return the worker's own 401 response.

The private health action returns aggregate counts: enabled/busy, expired ticket,
eligible/overdue sources, failed/degraded attempts over 24 hours and last success.
It does not return approval evidence, company members or raw provider errors.
Attempts retain sanitised outcomes for 30 days, pruned in batches on admission.
The existing feed payload retention function remains separate; scheduling that
payload-retention maintenance is still pending and is not implied by this work.

The GitHub workflow runs at minutes 7, 22, 37 and 52, **only if** repository
variable `EMPLOYER_REFRESH_ENABLED` equals `true`. It invokes one due source and
then checks health. Failures, expired tickets, overdue sources or degraded runs
produce a failed workflow; healthy/idle runs do not. No email sender or external
alert destination was configured. GitHub notification preferences remain the
owner's settings. Both repository opt-in and the database switch are currently
off; scheduled collection and alerting are not active.

At one source per 15-minute tick, nominal six-hour capacity is 24 sources before
retries. Normalisation currently accepts supported U.S. roles with explicit state
evidence. Larger boards may exceed the 500-record bound and need a separately
reviewed pagination budget; incomplete collection never authorises a closure.
This is a bounded pilot configuration, not proof of nationwide coverage,
unlimited feeds, 100 concurrent users or a production load test. GitHub schedules
can be delayed. Scale from measured provider latency and queue health.

## Validation

- Full application suite: 196 passing after final integration (including 12 new
  SQL/coordinator cases, three runner cases and an atomic-chooser UI case).
- Deno: 17 Edge Function entrypoint/security cases pass. The exact 35 KB bundled
  deployment artifact also passes its three entrypoint cases with no network.
- Native PostgreSQL 17.11: all existing 31 named concurrency scenarios and six
  new refresh scenarios pass, using independent connections and observed lock
  waits. Native access/workflow/quota scenarios also pass. These are synthetic
  local databases, not real production employers.
- New native scenarios cover two scheduler claims, revocation during settlement,
  a newer collection lease, concurrent selection change, expiry while waiting for
  a candidate lock and simultaneous settlement replays.
- Incremental deployment was tested against existing rows and grants, including
  refusal of a repeated installation; the production transaction retained the
  same existing function ACLs and verified disabled billing and refresh flags.
- Production effective ordinary-role refresh-function/table privileges: zero.
  Anonymous API probes return `401 / 42501`; the Edge Function returns its own
  `401 / unauthorised`. Public catalogue reads still work (`206` for a one-row
  range with `Prefer: count=exact`, total 736). No provider collection ran.

Evidence: `employer-refresh-live-api-2026-10-16.json` and
`employer-refresh-live-db-2026-10-16.json`.

## Deployment and pilot handoff

The migration filename remains under `migrations/pending/` for dependency/test
history. **It has been applied to production. Do not rerun it there**, and do not
run the first-install bundle on this existing project.

For a different existing installation at the previous baseline:

```sh
node scripts/build-employer-backend.cjs --refresh-upgrade
```

For a repeatable single-file dashboard deployment, from the repository root:

```sh
npx --yes esbuild@0.25.12 supabase/functions/employer-refresh/index.ts --bundle --format=esm --platform=neutral --external:jsr:* --outfile=../employer-refresh.bundle.ts
```

The active dashboard deployment is this bundle in `index.ts`, using the existing
project runtime service-role environment and `INGEST_SECRET`. No secret values
were retrieved or changed. Keep platform JWT verification on. The old standalone
staging-only `employer-feed` endpoint is still undeployed; do not enable a second
independent scheduled collector.

Before enabling collection:

1. Register one real employer through the separate employer entry point, verify
   its domain and obtain explicit display/refresh permission for its ATS tenant.
2. Have the owner designate a trusted reviewer through the established access
   process. This release creates no reviewer. The reviewer must be independent
   of the company and must approve the exact source revision, rights and expiry.
3. The owner enters the existing ingest secret into GitHub Actions secret
   `INGEST_SECRET` directly. Do not send it through chat or commit it.
4. Enable the database control only for the reviewed pilot, then perform an
   authenticated manual workflow run. Initially there are no selections, so the
   first run stages candidates but publishes zero jobs.
5. Select a small set in the employer workspace. After the bounded next refresh,
   verify public search, employer attribution, application destinations and the
   active count. Exercise a controlled withdrawal on the employer's test feed;
   do not remove a real vacancy merely for a test.
6. Enable repository variable `EMPLOYER_REFRESH_ENABLED=true` after the pilot
   passes, then verify workflow notifications and due-source capacity.

Safe stop: set the repository opt-in false and the database control enabled=false.
A worker that has not yet locked settlement is refused once the database switch
takes effect; an already committed settlement is not undone. To withdraw a
source's jobs immediately, use the existing reviewer revoke action; stopping the
scheduler alone does not withdraw already approved listings. Payment activation,
source agreements, a real pilot and retention scheduling remain separate work.

## Coordination with Claude

Codex owns this coordinator, migration 20261023, atomic selection API and runner.
The older function signatures and quota publisher remain compatible. Existing
`employer_select_feed_jobs` now takes the actor/company locks; reviewers should
include this migration when assessing the selection race. Claude's independent
lease/selection/cross-company URL review can continue on top of this commit.
No claim is made here that cross-company application-URL contention now has a
graceful return value: the unique URL constraint still safely rolls back an
unexpected conflict, which this coordinator records as a retryable failure.
