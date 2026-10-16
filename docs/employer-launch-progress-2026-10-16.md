# Separate employer and job-seeker access — October 16, 2026

## Current implementation

Codex owns this frontend/account/workspace release. Claude's access-review commit `f852633` was reviewed and integrated as `42c072f`, preserving its author. Claude's next assigned task is native concurrent ban/deletion/domain-claim testing on a separate branch; no further production change is authorized by that handoff.

- `login.html` is the job-seeker entrance; the default signed-in destination is the profile, with validated job-page return links preserved.
- `employer-login.html` is the dedicated employer entrance, using email/password followed by Google. Employer sign-up, email confirmation, Google return and password reset preserve the company workspace destination.
- Both pages use `login-form.js`. Existing approved `login.html` OAuth callback URLs are retained, avoiding a new provider configuration or credential. Employer callback/error pages retain employer context. `account-flow.js` allows only real local routes and keeps employer returns within employers.html.
- The same identity can use both workspaces. No browser role flag or user metadata grants employer/reviewer privileges. Company membership, eligibility, review and quotas remain database checks.
- `employers.html` has its own onboarding, company overview, active-job and review counts, company registration, DNS proof, draft/post/feed controls and sign-out. Data is cleared on account changes; stale requests cannot re-render another session's company/reviewer content. Reviewers must enter a verification reason.
- Public navigation exposes For employers independently of job-seeker sign-in. Profile has an employer-workspace switch. Layout checked on desktop and at an actual 360-pixel viewport without horizontal overflow.
- Privacy information now describes employer company/membership/draft/review records and account-reference cleanup. Paid checkout remains unavailable.

## Backend deployed in this session

The complete employer migration chain through `20261019_employer_pending_account_cleanup.sql` was installed in Supabase in one transaction via the authorized dashboard. Files remain in migrations/pending as historical reviewed sources, because both agents' test chains reference those paths. **They are now applied; do not rerun them blindly.** `scripts/build-employer-backend.cjs` assembles a fingerprinted first-install transaction and refuses an already installed backend. The exact bundle is tested against isolated PostgreSQL before deployment.

The first browser submission failed before installation because Monaco retained a previous query prefix. The complete document was then cleared and reinserted; the clean transaction returned `employer_backend_installed_payments_disabled`. Post-install checks confirmed:

| Check | Result |
| --- | --- |
| Existing open catalogue jobs | 736 before and after |
| Companies/reviewers created by deployment | 0 / 0 |
| Free allowance / Employer Plus price | 15 active / USD 1499 cents |
| Paid publishing | false |
| Anonymous private employer table grants | 0 |
| Public visibility function owner | postgres, matching catalogue owner |

The domain-proof function `employer-submissions` is deployed from index.ts and lib.mjs. A browser-compatibility fix adds apikey to the allowed CORS headers; its live OPTIONS response is 204 with authorization, apikey and content-type allowed. The dashboard's legacy JWT verification remains ON as an additional gateway check; the handler also resolves a real user through Auth and refuses the public anon token. No new secret or credential was created or handled.

`20261019_employer_pending_account_cleanup.sql` resolves an interaction with Claude's pending-claim squatting fix: deleting a pending claimant rejects that claim rather than reserving the domain through a suspended state. A test covers a pending claim sharing a real verified company's domain.

No reviewer identity was granted. Actual company verification and public publication still require an independent authorized operator. No employer company, real vacancy, feed, entitlement or provider API run was created by these checks. The employer-feed worker itself remains undeployed/disabled; automatic feed refresh/closure and payments are separate work.

## Evidence and limits

- 172 Node tests pass, including real SQL workflow/access scenarios, deployment-bundle checks, sign-in/confirmation/recovery routing and stale-session workspace tests.
- 14 Deno edge tests pass; the domain endpoint type-check passes. Its actual browser preflight headers are tested.
- `docs/employer-live-checks-2026-10-16.json` records live public-key-only probes: private company SELECT and private RPCs return 401/42501; public job reads remain 200; the domain handler rejects anonymous use with 401; browser preflight is 204.
- No real credential/account was created for testing. An existing authenticated owner session successfully loaded the live company onboarding form, switched to its existing job-seeker profile and returned to the employer workspace, with no browser errors. A fresh Google/email confirmation/recovery round trip and a real company's DNS/approval/publication trial remain user-assisted acceptance checks.
- Native concurrency follow-up is assigned to Claude. PGlite's single connection is not evidence of a simultaneous production race test.

Frontend release `e6d5a72` is publicly deployed. `docs/employer-frontend-live-checks-2026-10-16.json` records HTTP 200 and exact normalized source matches for employer-login.html, login-form.js, login.html, employers.html and index.html. Live employer onboarding was also verified in the browser. This does not mark the entire employer hiring/billing launch or the eight-item launch checklist complete.
