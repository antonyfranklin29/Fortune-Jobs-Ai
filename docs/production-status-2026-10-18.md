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

The October 15 runs were manual five-call tests. No `job-ingest` schedule was installed. The feed has not “crashed”; it has not been invoked again. The recovery branch fixes cursor movement after failed writes, accounts for provider calls while a run is active, blocks overlapping runs, and adds an optional lifetime limit. Those changes are in the repository, but the new allowance SQL is not applied and the recovered worker is not deployed. Do not schedule it against a 25-call test allowance or assume 500 calls/day is available. The documented full pass is roughly 5,304 pages; at six calls/hour it takes about 37 days, so the intended coverage needs a budget and scope redesign.

Before deploying, review how `recordSpend` handles a failed or non-2xx database PATCH: the current worker ignores that failure, which can undercount calls. Add a regression test that fails when spend recording fails, and make the worker stop further provider calls. This is a launch blocker for any automated limited-quota run.

## Security findings

Read-only effective-privilege checks: RLS is enabled on `job_matches`, `pre_scraped_jobs`, `profiles`, `saved_jobs`, `search_history` and `live_search_admissions`. Anonymous visitors can SELECT the two public listing tables but cannot INSERT into either; they cannot SELECT admissions or profiles. Authenticated INSERT on profiles/history/saved jobs is subject to owner policies. The permissive `job_matches` INSERT policy is inert while table INSERT privilege is revoked, but should be removed when the result pipeline is migrated safely. Gateway RPCs are not executable by anonymous or authenticated roles. Six `fja_*` helpers remain executable by them; `fja_insert_batch` is invoker-rights and cannot write the locked table. Review and retire these helpers if unused.

Supabase Free lacks leaked-password protection and automatic database backups. Leaked-password protection requires Pro; the owner previously chose to keep the upgrade pending. Do not list this as a free toggle. Public GraphQL visibility follows the intended public SELECT on listing tables; any personal text placed in `job_matches.match_reason` would also be public. The current browser keeps account profile details local when dispatching Live Search. The other authenticated employer functions need their internal authorization checks reviewed individually; the advisory count alone is not evidence of a breach.

No 100-user paid load test or restore drill has been run. Stripe and subscriptions are deferred by the owner.

## Next release gates

1. Fix and test durable Adzuna spend accounting, decide a provider allowance and practical coverage scope, then schedule a capped refresh.
2. Verify current direct Make searches with a capped test; install the secret filter and gateway secrets, then cut over and rotate the direct webhook.
3. Test employer registration with a real company-domain account and reviewer approval without granting a fabricated employer production rights.
4. Review the public result fields, owner-scoped account data, helper RPCs, backups and restore procedure. Keep the paid Supabase upgrade pending unless the owner changes that decision.
5. Validate account, cancellation and payment-failure flows after the billing provider is selected.
