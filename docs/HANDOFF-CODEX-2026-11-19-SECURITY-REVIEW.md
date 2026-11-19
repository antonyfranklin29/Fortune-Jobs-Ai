# Codex brief — Nov 19 2026: security review of Fortune Jobs AI

Franklin (owner) requested this review on Nov 19 2026 ("security review"). Scope: **our own** repo `antonyfranklin29/Fortune-Jobs-Ai` and our own Supabase project `hqgakkcxcyspqhnlnscv`. Review it the way a skilled attacker would, then fix what you find.

## Ground rules (important)
- **No load or stress tests against production.** The live database is small and fragile, and was overloaded on Nov 19. Review rate limits and overload risks by reading code and config, and test them locally.
- **Never read, copy or print real user data**, secrets or keys. If you find an exposed secret, report its location and type only (not the value), and Claude will rotate it.
- Work locally (`supabase start` or the test suite) wherever possible. Against production, only do read-only checks of our own public endpoints using the public anon key, and no more than a handful of requests.
- Branch `codex/security-review` + one PR with fixes and a report. Do NOT merge, deploy, apply migrations or change crons. Claude reviews, and Franklin approves before anything goes live.

## What to check
For each item: what you checked, what you found (severity: critical, high, medium or low), and the fix (in the PR, or why not).

1. **Database row-level security (RLS).** For every table in `public` (and any exposed schema), check whether RLS is on and whether the policies are right. In particular: can `anon` or one signed-in user read or change another user's rows in profiles, saved_jobs, subscriptions, search_history, ai_usage, account_emails, job alerts, employer_orgs or employer_posts? Can anyone write to pre_scraped_jobs or other tables meant to be read-only? List each table with its verdict.
2. **Exposed database functions (RPC).** List every function callable by anon or authenticated users. Look for `SECURITY DEFINER` without a fixed `search_path`, functions that return other users' data, and functions that do heavy work an attacker could spam (e.g. `top_hiring_companies`).
3. **Edge functions** (`supabase/functions/*`). For each one: is auth or a secret required where it should be? Is input validated? Check `verify_jwt` settings. Can an ingest or admin function be triggered by the public? Pay special attention to `ai-assist`: can the daily AI limits (25 free / 50 Pro) be bypassed (new accounts, forged plan, replay, parallel requests, oversized input to run up API cost)?
4. **Payments.** Check the Stripe webhook: is the signature verified? Is it idempotent (replayed events)? Can a user grant themselves Pro (client-side plan flags, writable subscription rows)?
5. **Auth flows.** Check account deletion (`delete-account`: only your own account; all data removed), email change, password reset redirect URLs (open redirects), employer sign-up and work-email verification (can someone claim a company domain they don't own?).
6. **Overload / abuse (the Nov 19 lesson).** Check search parameters a visitor controls (`ilike` patterns, limits, `or=` filters): can a crafted query force full-table scans or huge responses? Recommend and, where safe, implement limits: maximum keyword count and length, row caps, and per-IP rate limiting for heavy endpoints (edge functions; Cloudflare in front if needed). Don't change role timeouts without noting it.
7. **Secrets in the repo.** Scan the full git history (e.g. gitleaks or trufflehog, run locally) for API keys, service-role keys, Stripe or webhook secrets, and passwords. Report locations only.
8. **Front-end.** Look for XSS where job descriptions or employer content are rendered (`dangerouslySetInnerHTML`, markdown, links with `javascript:` URLs). Check that external links use `rel="noopener noreferrer"`. Check any secret ever bundled into the client (service-role key, Anthropic key).
9. **Dependencies and GitHub.** Run `npm audit` (react + root) and list high and critical issues with fixes. Check workflow files: `pull_request_target` misuse, secrets exposed to forks, third-party actions not pinned to a SHA, and over-broad `GITHUB_TOKEN` permissions.
10. **Security headers.** Check what GitHub Pages / Cloudflare can set: CSP, X-Frame-Options/frame-ancestors, Referrer-Policy. Recommend what is achievable on our hosting.

## Deliverables
- `docs/SECURITY-REVIEW-2026-11.md`: findings table (item, severity, evidence, fix, status), written in plain English at the top for Franklin (5 lines: the biggest risks and what was fixed).
- Fixes in the same PR, with tests for each fix (e.g. an RLS test proving user A can't read user B's saved_jobs; a test that a webhook without a valid signature is rejected; a test of the AI-limit bypass). Put migrations in `migrations/` with matching rollback files, and **don't apply them**.
- `npm test` has 32 known failures on main; don't add new ones.
- No Google for Jobs / JobPosting markup. No wording changes to marketing copy.

## Reply with
The PR link plus the 5-line plain-English summary.
