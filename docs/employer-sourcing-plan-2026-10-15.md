# Employer job supply: delivery plan and shared contract

Owner: Franklin. Code owners: Codex (feed ingestion) and Claude (employer submissions and approval). Updated October 15, 2026.

**Current scope:** Franklin has now authorized dedicated employer and job-seeker sign-in entrances and an employer workspace. General website redesign remains outside this task. Backend ownership stays split below; Codex owns login/account/workspace/navigation changes. Read `docs/employer-launch-progress-2026-10-16.md` before relying on the historical production baseline below.

## Outcome and current status

Add employer-authorized career feeds and reviewed direct employer postings to Fortune Jobs AI. Keep matching relevant, freshness honest and provider credits intact. Reduce reliance on any single supplier by adding real inventory, not by concealing its source.

Current production baseline: 79 open Adzuna rows, 23 state codes, 13 role families; zero role/state cells meeting the 100-fresh-distinct target. NC and SC Data Analyst fresh coverage is zero. Two five-call Adzuna runs are recorded. That target is not a promise that every employer or state has 100 actual vacancies.

The employer-feed transport, normalizers, bounded collector, authenticated worker and private staging migration are implemented and tested. Claude's registry and publication functions are now integrated locally, including private candidate staging and publication hardening. Production deployment remains pending. No approved employer or live employer feed import is active. Existing Adzuna/Make services and permission grants are unchanged. See `docs/employer-feed-backend-2026-10-15.md` for the backend contract and evidence.

## Ownership: work in parallel without editing the same files

| Work | Owner | Files / boundary |
| --- | --- | --- |
| Greenhouse / Lever adapters, pinned-host GET transport, response validation, job normalization | Codex | `supabase/functions/employer-feed/lib.mjs`, `fetch.mjs`, `tests/employer-feed.mjs` |
| Bounded read-only page collection and permission rechecks | Codex | `supabase/functions/employer-feed/collect.mjs` |
| Backend registry and verified employer accounts, pending submissions, operator review, approval/revocation audit | Claude | NEW `migrations/pending/20261016_employer_submissions.sql`, NEW `supabase/functions/employer-submissions/`, corresponding tests |
| Feed worker, private staging/leases and retention | Codex | `supabase/functions/employer-feed/index.ts`, `handler.mjs`, NEW `migrations/pending/20261016_employer_feed_runs.sql`; deployment pending registry integration |
| Registry bridge and feed publication integration hardening | Codex | NEW `migrations/pending/20261017_employer_feed_registry_bridge.sql`, `20261017_employer_feed_publish_hardening.sql`; preserves Claude's original file |
| Direct posting publish/update/close path with provenance, expiry and no privilege escalation | Claude | New backend-only publishing RPC and submission endpoints; pending migration reviewed before application |
| Integration, cross-source deduplication, coverage checks and production smoke checks | Codex reviews both tracks | Coordinate existing catalogue / search files before editing |

Claude should not edit `job-ingest`, Make, login/account-flow/newsletter files, shared catalogue RPCs, main navigation, `package.json` or Codex adapter files in parallel. Propose required shared-file changes in the handoff instead. Neither agent should change the other's live endpoint configuration.

## Sequence

1. **Foundation (started):** freeze this contract; validate adapters with synthetic fixtures; leave all unapproved sources disabled.
2. **Employer intake:** sign-in required for employer submissions; verify the employer's association with its organization, collect permission for display/refresh and the actual career board identity. Every submission starts pending. A claim of affiliation is not approval.
3. **Pilot:** obtain explicit permission from a small set of employers, prioritizing actual Data Analyst vacancies in NC, SC and NJ. Target five approved sources initially, not an invented count of jobs. Public ATS endpoints alone do not grant blanket reuse rights. Employer contact outreach has NOT been sent.
4. **Publish safely:** dry-run reports first; then bounded import from one approved source, approved display wording, correct title/company/state/application link, no fake posting dates, and no duplicate cards for one vacancy. Approve the pending database migration and endpoint configuration before enabling live imports.
5. **Operate:** propose a daily refresh for each approved board, staggered and within provider limits. Register run outcomes, received/accepted/rejected counts and last successful confirmation. A failure, malformed payload, page limit or interrupted sweep never means all jobs closed. Revocation must stop fetching and serving immediately. Validate closures on a complete source-scoped enumeration. Add an alert destination and run an actual recovery/rollback exercise before claiming operational readiness.

No new paid plan, scraping charge, newsletter sending or subscription payment activation is included in this work.

## Employer pricing — Franklin's confirmed update

Franklin confirmed **15 active posts at a time**, not 15 new posts per month.

- Free employer allowance: up to 15 active published jobs across one employer organization. Closing or expiring a post frees a slot. Draft/pending/rejected/closed posts do not count; reactivation and publication do. Updating an existing active post does not consume another slot.
- Employer Plus: **USD $14.99/month** to publish above the free allowance. This is separate from the planned $7.99 job-seeker subscription. Do not advertise unlimited postings: Franklin has not specified the paid plan's maximum, and abuse/review controls still apply.
- The allowance is organization-wide, across its users and employer-managed manual/feed postings; one extra account, board or submission channel cannot reset the allowance. Employer verification, source permission and moderation are mandatory on both tiers.
- Public price constants are in `config/employer-pricing.json`. They are product configuration, never evidence of a paid entitlement. The SQL publish path must check current server-owned subscription state and enforce the active-count limit atomically, under an organization lock. A browser flag, editable profile field, return URL, checkout redirect or submitted plan name cannot unlock it.
- While checkout is pending, permit only the free allowance. The 16th publication returns a clear upgrade-required state without charging, publishing anyway or pretending checkout works. Keep draft/save/review available. Do not collect a card or activate a Stripe plan in this phase.
- Billing implementation must later handle verified provider events idempotently, cancellation, failed payment and entitlement expiry. Cancellation retains paid access through its verified paid-through date. Before a downgrade takes effect, show clear notice and let the employer choose up to 15 posts to keep active. Preserve excess posts in a recoverable paused state when the free allowance applies; do not permanently delete content or silently grant unlimited paid privileges after expiry. Final notice/grace timing and deterministic selection when an employer makes no choice remain activation decisions to confirm before charging begins.
- Importing an employer's whole board must not accidentally publish hundreds of jobs on its free account. Stage privately, show which postings it wants to distribute, and enforce the same quota at publication. Permission-only syndication partnerships or alternative pricing need an explicit agreement before treating them as exceptions.

Claude owns the database limit, entitlement read model and API upgrade-required responses in its submission track. Codex's feed collector does not grant billing entitlements or publish jobs. This update takes precedence over any earlier assumption of unrestricted free employer publishing.

## Shared registry contract (v1)

The adapter receives ONLY a server-loaded protected registry record, never a caller-supplied object. These JavaScript fields are the interface; database representation may differ only with an explicit mapping agreed in the handoff:

```text
id                         stable UUID or safe identifier (letters/digits/_/-; max 100)
adapter                    greenhouse | lever
api_region                 global | eu (greenhouse: global only)
board_token                lower-case tenant token, max 100, no URL/path/query
employer_name              reviewed display name, max 200
status                     pending | approved | rejected | revoked
enabled                    boolean; false until operator approval
rights_basis               employer_written_permission
permission_ref             private evidence reference, not the evidence itself
approved_by                trusted reviewer identity
approved_at                ISO timestamp, not in the future
domain_verified_at         ISO timestamp, not in the future
authorization_expires_at   ISO permission/re-review deadline, in the future
allow_display              boolean
allow_refresh              boolean
allow_description          boolean
allowed_apply_hosts        1–8 reviewed exact lower-case DNS hostnames
attribution_text           plain text, max 120; empty only when permission allows
```

Keep permission evidence, reviewer contacts and domain challenges private; the repository is public. The employer may not self-set status, enabled, verified identity, approved_by, approved_at, rights approval or allowed hosts. Persist server validation, not merely disabled form controls. Revocation/expiry must affect both worker eligibility AND public job visibility. Source approval should have an auditable operator-only path; do not treat every signed-in user as an administrator or trust mutable user_metadata for roles.

Greenhouse/Lever hosted application URLs must belong to the approved board and posting. Employer-owned custom application hosts require explicit review; wildcard hosts and arbitrary feed URLs are unsupported. Arbitrary XML/RSS feeds, Ashby and other countries are later adapters, after the first two work end to end.

## Publication and source ownership contract

Adapters emit existing catalogue fields plus `employer_source_id`, with `source='employer_feed'` and `source_listing_id='<registry-id>:<provider-post-id>'`. A backend publish RPC must validate this against the registry. Add an actual source FK/provenance column; the existing `ingest_upsert_jobs` does NOT store this new field and is not the publishing path for employer imports.

**Do not reuse its URL-conflict update behavior blindly:** the existing upsert can overwrite another source's provenance on a URL match. Publication must retain original source/permission/credit evidence, enforce employer ownership, and avoid relabeling an Adzuna listing as a direct job. Deduplicate genuine copies without merging separate requisitions solely because their titles match. Edits/closures are scoped to the approved employer source or reviewed direct post, not all jobs sharing a URL.

Re-check source approval/expiry and submitter ownership transactionally at publication; an approval may be revoked while a fetch is in flight. Keep publication rights separate from an employer's ability to edit a pending submission. Direct posts should have explicit posting/closing dates, structured country/state/city, company, canonical role and a reviewed HTTPS application URL. Their claims and links need review before public visibility. Do not ask candidates to pay to apply or publish sensitive applicant data.

Required per-source attribution must be retained by the backend and reach the existing public renderer (the current shared helper handles Adzuna only). Do not activate a source requiring unsupported display wording. Store plain text and safe links, not employer-provided HTML. This is a publication requirement, not a design task.

## Adapter limits and honest metadata

The new library rejects expired/unapproved source records before network access. Feed URLs are pinned to official provider hosts; redirects are errors. Transport has a 15-second timeout, 2 MiB streamed response limit, JSON-only parsing and no credentials or user data. It returns payloads only: no database writes, closure or scheduling side effects.

Greenhouse validates the list total and rejects boards exceeding 500 posts. Lever requests explicit skip/limit pages (at most 100 per request); a full page is not terminal. The future worker needs an overall page/run budget, checkpoints and an atomic run lock. No calls beyond a permitted page budget and no closure from partial results. HTTP success is not proof of a complete sweep.

The implemented `collectEmployerFeed(sourceId, ports)` takes a trusted `loadSource(id)` port returning `{source, revision}` with a positive integer revision. It rechecks approval and snapshots configuration before/after every fetch. Default request budget is two, hard maximum six; at most 500 records are collected. It reports partial versus complete enumeration, filtered-row counts and the next offset. Failed runs discard all rows and sanitize exception text. The worker and pending migration now provide private batch staging and a source lease/fencing token. Cross-run cursor continuation is not implemented: a partial batch is private review material, not a full sweep, and a new run starts from the beginning. `reconcile_candidate` is a read-only recommendation and never authority to close jobs. A publisher must check source revision, current permission, organization quota and closure safeguards transactionally. Billing and publication are not performed by the collector or worker.

Unknown state/role rows are reported, not guessed. Initial US-only normalizers accept a primary state with listing evidence; remote nationwide and ambiguous multi-location records are not duplicated across states. A job's updated_at is never treated as its posted_at. Lever's documented list fields do not provide a posting date, so it remains null. Unknown dates cannot count toward the dated 100-per-state target or pass a recent-posting filter; a later UI can distinguish "last verified" from "posted". Salary is left null in v1. No claim of comprehensive coverage follows from a successful import.

## Acceptance gate before activating sources

- Employer A cannot read/change B's private submissions or publish as B; anonymous/ordinary authenticated callers cannot approve, enable or publish sources; effective SQL privileges/RLS and RPC PUBLIC grants are tested.
- Pending/rejected/revoked/expired source records never fetch or appear as public jobs. Forged approval fields are ignored server-side. Check approval again on publish.
- Malicious application hosts, cross-tenant provider links, redirects, HTML error responses, oversized responses and malformed/truncated pages fail safely.
- Actual approved pilot listings appear in Quick Match with correct employer, role, state, application destination and required attribution. Guest/sign-in/resume matching still work.
- Duplicate import is idempotent. Partial and failed sweeps preserve jobs; complete closure is source scoped. Revocation removes visibility. No unrelated or private table is exposed.
- Record real source/role/state coverage and exact remaining gaps. 100 listings is a goal, never padded with expired or off-target jobs.

## Claude handoff (copy into Claude)

Please implement the Claude-owned employer submissions/approval backend in docs/employer-sourcing-plan-2026-10-15.md. Codex owns the employer-feed adapters and worker. Read the shared registry and publication contracts before coding. Build pending-only authenticated submission APIs, private permission evidence, verified employer ownership, operator approval/revocation with audit history, and a source-scoped publication RPC preserving provenance. Implement the confirmed organization-wide 15-active-job free limit and server-owned entitlement checks. Use the new file paths listed in the ownership table. Propose pending migrations and report tests/diffs before applying production changes. No public/anonymous publishing, self-approval, arbitrary fetch URLs, copying Adzuna into direct posts, credential exposure or paid services. Franklin removed frontend/design activities: do not build employer forms or change website pages in this phase. Do not edit Codex-owned/shared search, login, newsletter or Make files concurrently. Report any contract changes before integrating.

## Primary implementation references

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html): list endpoint, published job fields, public GET behavior, and distinction between update and first publication dates.
- [Lever Postings API](https://github.com/lever/postings-api): tenant namespace, global/EU endpoints, explicit pagination, application URL and workplace fields. Access documentation is not independent employer publication permission.

## Verification in this change

The full Node suite passes 154 tests, including 18 adapter/collector tests, 14 actual-SQL/backend tests and 16 combined integration tests. Thirteen Deno edge tests and both backend type checks pass. The combined SQL verifies no publication before selection, the 15th/16th-post allowance, expired-row reactivation, candidate revision/freshness, source isolation, account deletion, atomic DNS checks and public visibility. SQL runs in an isolated PostgreSQL engine; live multi-client Supabase testing remains pending. All new provider responses are synthetic. No live employer approval or feed import has been performed. Follow-up findings and local query measurements are in `docs/employer-backend-review-2026-10-15.md`.
