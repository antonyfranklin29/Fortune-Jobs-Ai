# Fortune Jobs AI production status — October 18, 2026

This reconciles the October 17 audit with the October 18 handoff. Counts can change; do not treat this as a live dashboard.

## Search paths

| Visitor feature | Published route | Current state |
| --- | --- | --- |
| Quick Match | Browser reads `pre_scraped_jobs` from Supabase | Works independently of Make. The October 17 audit's “736 all Adzuna” was incorrect: a direct source count on October 18 found 540 Dice, 137 Indeed and 79 Adzuna open rows before the separate freshness filter. Coverage and freshness still need work. |
| Live Search | Published `index.html` posts directly to the Make webhook and polls `job_matches` by search ID | Make is still part of production. Do not infer visitor failures from gateway admissions. Test the direct Make path separately before declaring it healthy. |
| Live Search gateway | Supabase `live-search` function | Deployed version 10 rejects missing Make configuration before admitting a search. Its Make URL and shared secret are absent from the project's custom secret list, and the published website does not yet use the gateway. The 13 `gateway_not_configured` admissions and three expirations are historical gateway activity, not proof of 16 failed visitor searches. |

The gateway cutover still needs the Make scenario's shared-secret check, the corresponding Supabase secrets, a zero-cost dry run, and one explicitly budgeted end-to-end search. Keep the published direct path until that is complete; then remove it and rotate the old webhook address.

## Employer backend

The company-domain registration rule is live. A read-only check found its marker in `employer_register_org`, anonymous EXECUTE denied, authenticated EXECUTE allowed, and zero employer organizations. No real employer signup has exercised it yet. The checked-in SQL source is kept in `migrations/pending/` because the bundle and tests read that path, but its header marks it as applied. The production migration ledger contains entry `20261017225112` for that rule. Earlier employer migrations are absent from the ledger although their objects exist; they were applied manually. Do not replay the first-install bundle on this production database. Future migration work should compare each function and table to its source and establish a baseline first.

Employer Plus billing is disabled, and there are no real employer feeds or posts. The employer cleanup schedule remains in dry-run mode.

## Adzuna catalogue

The October 15 runs were manual five-call tests. No `job-ingest` schedule was installed. The feed has not “crashed”; it has not been invoked again. The recovery patch fixes cursor movement after failed writes, accounts for provider calls while a run is active, blocks overlapping runs, and adds an optional lifetime limit. The private lifetime-counter SQL was applied on October 18; effective privileges are anon/authenticated denied and service role allowed, and it returned 10 used calls. The recovered worker was deployed on October 18 and its source was checked after reload against the tested file. `ADZUNA_LIMIT_TOTAL=25` was saved, so the worker is capped at 25 recorded lifetime calls. This is not a scheduler, and no provider call was made during deployment. Do not schedule it against a 25-call test allowance or assume 500 calls/day is available. The documented full pass is roughly 5,304 pages; at six calls/hour it takes about 37 days, so the intended coverage needs a budget and scope redesign.

The recovery review found that `recordSpend` ignored a failed or non-2xx database PATCH. The worker now reserves each call in the run ledger before contacting Adzuna and fails closed if that reservation fails. A fixture test confirms a failed ledger write makes zero provider calls. This change is deployed. An automatic schedule still needs an approved allowance and coverage plan. The counter sees worker-recorded calls only; any Adzuna calls made outside this worker must be reconciled against the provider dashboard before using the remaining test allowance.

Later October 18 budget hardening is also deployed (`ad8feb2`). The worker's default minute/day/week/month ceilings are now 25/250/1,000/2,500, matching Adzuna's published standard limits; the 25-call lifetime cap remains separately configured. A running job remains reserved for two hours, preventing a second invocation from treating a 20-minute job as abandoned. Failed ledger reservation returns a distinct 503 and makes no provider request. A successful cell is next due after six days. This does not activate a schedule or fetch new jobs.

The source-aware follow-up is live as well: `ingest_source_coverage` counts eligible listings by provider, and the Adzuna planner reads only Adzuna's cells. The view is service-role-only; a production privilege query showed anon/authenticated SELECT denied and service-role SELECT allowed. At verification, Adzuna had 79 eligible role/state listings and Indeed 13 in this view. The deployed worker source was checked against the tested file. No live provider test was run, and the account dashboard's actual remaining calls, plan and trial status are unverified.

## Security findings

Read-only effective-privilege checks: RLS is enabled on `job_matches`, `pre_scraped_jobs`, `profiles`, `saved_jobs`, `search_history` and `live_search_admissions`. Anonymous visitors can SELECT the two public listing tables but cannot INSERT into either; they cannot SELECT admissions or profiles. Authenticated INSERT on profiles/history/saved jobs is subject to owner policies. The permissive `job_matches` INSERT policy is inert while table INSERT privilege is revoked, but should be removed when the result pipeline is migrated safely. Gateway RPCs are not executable by anonymous or authenticated roles. Six `fja_*` helpers remain executable by them; `fja_insert_batch` is invoker-rights and cannot write the locked table. Review and retire these helpers if unused.

Supabase Free lacks leaked-password protection and automatic database backups. Leaked-password protection requires Pro; the owner previously chose to keep the upgrade pending. Do not list this as a free toggle. Public GraphQL visibility follows the intended public SELECT on listing tables; any personal text placed in `job_matches.match_reason` would also be public. The current browser keeps account profile details local when dispatching Live Search. The other authenticated employer functions need their internal authorization checks reviewed individually; the advisory count alone is not evidence of a breach.

No 100-user paid load test or restore drill has been run. Stripe and subscriptions are deferred by the owner.

## Next release gates

1. Reconcile Adzuna's own usage with the worker's 10 recorded calls, decide a provider allowance and practical coverage scope, then schedule a capped refresh.
2. Verify current direct Make searches with a capped test; install the secret filter and gateway secrets, then cut over and rotate the direct webhook.
3. Test employer registration with a real company-domain account and reviewer approval without granting a fabricated employer production rights.
4. Review the public result fields, owner-scoped account data, helper RPCs, backups and restore procedure. Keep the paid Supabase upgrade pending unless the owner changes that decision.
5. Validate account, cancellation and payment-failure flows after the billing provider is selected.
