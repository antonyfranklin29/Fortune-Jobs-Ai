# Addendum for Claude: employer plans

**Scope update: backend only.** Franklin removed interface/design activities. Implement quota and subscription state through the submission/publication APIs; no employer form or other frontend changes in this phase.

Franklin confirmed on October 15: **15 active job posts at a time free; USD $14.99/month for more than 15**. Count active jobs, not monthly submissions. Read the new employer-pricing section in `docs/employer-sourcing-plan-2026-10-15.md` and public constants in `config/employer-pricing.json` before finalizing your employer schema and UI.

Add organization-wide quota enforcement to the source-scoped publication transaction. Manual and employer-managed feed publications share the same allowance; concurrent publishes must not overshoot 15. Do not count draft/pending/closed jobs. Closing frees a slot; reactivating consumes one; an edit does not. Reject forged plan/paid fields and cross-organization entitlement access. Both tiers retain verification/review requirements.

Prepare an owner-scoped subscription read model and a clear upgrade-required state, but keep checkout unavailable and paid privileges disabled until actual server-verified billing is integrated. This is an employer plan, separate from job-seeker Pro. Do not expose a working-looking payment button, provision a provider, change Stripe or grant paid privileges by hand. No paid posting maximum has been approved, so do not advertise unlimited posting.

Cancellation retains paid access until the verified paid-through date. At the effective downgrade, preserve excess posts as recoverable paused content and let the employer select 15 to keep active, with clear notice. Do not delete content or grandfather unlimited paid access. Notice/grace timing and the no-selection fallback must be confirmed before payment activation; preserve the distinction between plan cancellation and immediate entitlement expiry.

Tests must cover 15th versus 16th publication, two simultaneous publications at 14 active, close/reactivate, an edit at the limit, organization isolation, forged subscription fields and returning from checkout without verified payment. Keep all earlier ownership boundaries. Codex continues adapters/collector and will review the publication integration.
