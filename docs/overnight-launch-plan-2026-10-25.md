# Fortune Jobs AI overnight handoff — 25 October 2026

Starting point (9:15 p.m. ET): Quick Match has 756 open stored rows but no source refresh since 17 October. The Adzuna account is on a 25-call Pending Activation trial. Live Search still uses the public Make webhook; the Supabase gateway switch and Make shared-secret filter are off. Billing for seeker and employer subscriptions remains deferred.

## Parallel work

| Owner | Tonight's work | Evidence to finish |
|---|---|---|
| Codex | Hide stale imported listings from Quick Match without hiding active employer posts; verify the public site after deployment; reconcile Adzuna access and prepare a capped refresh; check US state coverage and launch behavior. | Tests, deployment check, public catalogue report and exact coverage limits. |
| Claude | Verify Make success/failure completion signals; stop empty webhook requests before paid modules if authorized; prepare the separate gateway-only scenario and free gateway dry-run if authorized; document cutover and rollback. | Saved Make configuration read back after reload, no-cost checks, branch/commit and a list of remaining prerequisites. |

## Boundaries and dependencies

- Franklin will enter billing and card details directly with Adzuna. Do not buy or activate a plan on his behalf. Confirm the active plan and provider usage before spending any new calls.
- No paid Apify run tonight. A production success marker already observed by Claude may satisfy the success-path check; retain evidence in the Make runbook.
- The Adzuna worker currently has `ADZUNA_LIMIT_TOTAL=25`. Do not invoke or schedule it after the upgrade until the provider's actual allowance is confirmed and that cap is intentionally revised. The pending hourly schedule uses 3 calls per run, at most 2,232 in a 31-day month, inside the worker's existing 2,500/month cap; it also requires an `INGEST_SECRET` copy in Supabase Vault, entered by Franklin without sharing it in chat.
- Keep the direct Live Search path working until the separate gateway-only scenario, secret check, frontend switch, cached-page drain and rollback path have been verified as one coordinated cutover. Never expose a webhook URL, API key or secret in documentation or chat.
- Do not claim 100 jobs in every role and state. Measure real coverage. The Adzuna US IT feed covers 18 tracked IT roles; Canada, the UK and India need separate source approval and scope.

Ending point for the morning handoff: identify changes shipped, checks passed, actual Adzuna plan/call budget, current catalogue freshness and state gaps, Live Search cutover readiness, and each blocker that still needs Franklin.
