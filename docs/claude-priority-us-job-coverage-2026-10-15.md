# Claude priority: U.S. state-by-role job coverage

Franklin has explicitly reprioritized this work above newsletters and the account-deletion UI. Reach a safe stopping point in other work, then own this ingestion/coverage task. Codex retains newsletter/Resend setup; sending stays disabled.

## Requested outcome
Target at least 100 distinct, current, relevant job listings per supported canonical role in each of the 50 U.S. states; track DC separately as an additional region. This is a data-coverage target, not the number of free cards displayed: preserve the existing free allowance and subscription behavior. Do not promise 100 where the upstream market/source does not have 100 genuine listings. Report the gap and source constraints rather than padding results.

## Start with the reported defect
Search Data Analyst statewide in North Carolina and South Carolina separately. Verify whether the shortage comes from a sparse catalogue, provider query/input, city-versus-region scope, country/state metadata, filtering before a candidate limit, title synonym matching, or display limits. Preserve exact state scope. A city-only request is not a statewide collection. Carolina is ambiguous: offer North Carolina and South Carolina instead of silently choosing one. Include Raleigh, Charlotte, Durham and other verified NC locations via statewide coverage; do not substitute South Carolina or unrelated roles for missing NC jobs. Keep remote work separate and only include it where the listing explicitly supports the selected location.

## Inspect current production before changing it
Count active, recent listings by role/state and original posting dates. Repository autocomplete currently has 2,340 suggested titles; many overlap or are variants. Establish a documented canonical role taxonomy plus reviewed aliases rather than treating all suggestions as unrelated scrape targets. Begin with Data Analyst in NC/SC, then expand the same worker/config to all states and agreed supported canonical roles. Do not silently declare the entire requested scope complete after the pilot.

## Build the durable ingestion workflow
- Verify Adzuna activation and permitted feed/API access first. Its last known state was pending. Use approved job APIs/employer feeds; a test scraper success does not establish a redistribution agreement. No new paid plan, unbounded scraping, provider credential disclosure, or higher run charges without an explicit budget. If access is blocked, build and test the worker with fixtures while recording the exact activation dependency.
- Config-driven state and role queries, bounded pagination, quota and cost ceilings, queue/concurrency controls, backoff and resumable checkpoints. Avoid multiplying 2,340 aliases by 50 states by 100 jobs without deduplication/cost estimates.
- Normalize country/state using evidence from the listing; preserve source, source listing ID, source URL, application URL, original posted date, expires/closed state, fetched_at and last_seen_at. Attribute listings as required by the actual provider terms.
- Upsert/deduplicate by provider ID and canonical application URL; deal with reposts deliberately. Never invent company, salary, posted date, state or a match reason. Reject invalid application URLs.
- Respect provider caching, retention and refresh rules. Handle expired/removed jobs and transient fetch failures separately; do not purge the last good catalogue after a failed source response. Include a reviewed freshness schedule and stale-data alerts/health reporting.
- Keep job writes backend-only; no anon/authenticated INSERT grants. Credentials remain in server secrets. Never include user résumé/identity in ingestion requests. Migrations need effective permission checks, rollback/recovery and compatibility with current Quick Match.

## Acceptance evidence
Provide a coverage matrix: canonical role, state, fresh distinct count, target=100, shortage, newest/oldest posting dates, last successful refresh, source and failures. A cell passes only with 100 eligible distinct listings, not fetched count or duplicates. Report unsupported and sparse cells explicitly. Verify user-visible counts separately from the ten-card free allowance.
Test statewide NC/SC isolation, other-state rejection, title relevance/aliases, date/freshness/expiry, duplicate IDs/tracking URLs, pagination and quota exhaustion, retry recovery, no fake dates, backend-only writes, and failure-safe catalogue retention. Use a bounded authorized production pilot before expanding. Demonstrate that an automated later refresh adds genuinely newer data; manually filling a table once does not complete this task.

Deliver focused code/config/migrations/tests, actual production measurements, the coverage report and remaining blockers. Coordinate any index.html/generated-page changes with Codex. Leave Google auth, newsletter files, Resend secrets and payments unchanged. Do not mark search accuracy or global coverage complete merely because ingestion runs.
