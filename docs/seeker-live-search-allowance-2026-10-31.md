# Seeker Pro Live Search allowance — prepared, not active

Franklin chose **$7.99/month for 50 Live Searches per billing period** on October 31. The subscription and checkout remain disabled while incorporation, legal review, and Stripe setup are pending. Quick Match and the ten free job cards are separate from this allowance. Fifty searches means fifty accepted Live Search requests, not fifty job listings or a guarantee of fifty matches.

## Prepared implementation

- `config/seeker-pricing.json` records the price and allowance with `billing_enabled: false`.
- The browser sends its Supabase session token when available. The gateway asks Supabase Auth for the user ID; it ignores any `user_id` in the request body. A forged ID or invalid bearer token cannot claim another person's allowance. Guests remain possible.
- `migrations/pending/20261031_seeker_live_search_quota.sql` stages a server-owned entitlement table and an atomic admission check under the existing advisory lock. The paid switch defaults off. When later enabled, only an active entitlement with a current billing period receives 50 searches. Failed or expired searches release the allowance. The response carries the remaining count for the results page to display after an accepted search.
- The staged configuration proposes three free Live Searches per rolling 30 days once billing is enabled. Its 200-search global rolling 30-day pilot cap would apply as soon as the migration is installed. These numbers need a release decision; no production limit has changed.
- `migrations/pending/20261031_job_matches_write_lockdown.sql` removes the permissive INSERT policy and keeps public write privileges revoked while preserving public reads. Claude verified production already denies `anon` and `authenticated` INSERT through missing grants; this migration prevents a future grant from reopening marker writes. Apply it before the quota migration.

## Release gates

1. Review the pending SQL against the live Supabase schema. Both migrations passed isolated embedded PostgreSQL checks (`node tests/seeker-live-quota.mjs` and `node tests/job-matches-write-lockdown.mjs`); neither has been applied to production. The free count combines account and client use, so creating a new account on the same client does not reset it. Shared office IPs may still hit client limits and need product review before launch.
2. Deploy the token-validation gateway and matching results page together. Run free forged-ID, expired-token and concurrency checks.
3. After legal and Stripe setup, build a signature-verified billing webhook. It alone may create or update entitlements with the provider's billing period. A checkout return URL or browser field never unlocks Pro.
4. Confirm the free monthly allowance and global Make credit budget. The 200-search pilot cap would serve at most four paid members using all 50 searches, so it must be raised with a funded Make allowance before advertising Pro broadly. The optimized Make scenario is inactive and its 12–14-credit cost is still an estimate. Test it once with separate approval before public Live Search is enabled.
5. Show remaining searches and the renewal date to a signed-in Pro user, including before the first search. Handle cancellations, failed payment, refunds, and billing-period changes in the entitlement sync.
