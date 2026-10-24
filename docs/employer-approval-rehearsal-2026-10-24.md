# Employer approval-flow rehearsal, 2026-10-24

Branch `claude/employer-approval-rehearsal`. Local and disposable only. No real employer was created, no reviewer was granted, and nothing was deployed.

## What was rehearsed

`tests/sql/employer-approval-flow.sql`, run by `tests/employer-approval-flow-db.mjs` on a throwaway PostgreSQL 16, walks one synthetic company through the full employer chain, through `20261026`:

1. **Registration.** Personal mail, an unrelated company address and a free-mail company domain are refused. A subdomain address (`hiring@team.rehearsal-co.com`) can register `rehearsal-co.com`. The employer sees the DNS record to publish and cannot verify their own company.
2. **Reviewer gate.** Verification is refused before DNS proof and without a note.
3. **DNS proof.** A wrong token is not accepted, and the matching record verifies the domain. The company still waits for an independent reviewer.
4. **Post review.** A post can't be activated before review. A stale revision is refused (`revision_changed`), and approval publishes the reviewed version.
5. **Edit to a live post.** The edit waits for review, and the public listing keeps the approved version.
6. **Rejected edit.** The live version stays up and the reason is stored, so the employer can fix the edit and resubmit. Approving the fix replaces the live version and clears the old reason.
7. **New post rejected.** A reason is required, and the employer sees it.
8. **Suspension.** Live listings close and new work is blocked. The allowance stays at 15 active posts. Paid publishing stays off at USD 14.99, with checkout unavailable.

## Defect found and fixed

**A rejected edit to a live post gave the employer no reason.** After the reviewer rejects a change to a published post, the post correctly stays `published`. The workspace showed the reviewer note only for status `rejected`, so the employer saw "Live" and nothing else.

`employer-submissions.js` now shows the note whenever one is present and no newer revision is waiting for review. For a live or paused post it reads "Your latest edits were not approved; the live version is unchanged." Approval clears the note, so it never lingers. This is a frontend-only change with no database change. `tests/employer-workspace.cjs` covers it; the test failed before the fix.

## Evidence

- New rehearsal: 1 of 1 pass, about 40 assertions.
- Existing native suites (access, submissions, concurrency, feed concurrency, lease/selection/URL, refresh, maintenance): 9 of 9 pass on PostgreSQL 16.15.
- `npm test`: 212 pass, 1 fail, 1 cancelled. Both are in `tests/resume-extraction.cjs` (PDF and DOCX). They fail the same way on origin/main and are unrelated.

## Production, read only (no writes)

- One company exists: status `pending`, registered 2026-10-18, with one active owner. It has no posts and no sources.
- `employer_operators`: **0**. Nobody can verify a company, so that pending company cannot proceed.
- Billing: 15 free active posts, 1499 cents, `paid_publishing_enabled = false`.
- The company-domain rule (`company_email_required`) is live in `employer_register_org`, which matches main.

## Remaining blockers (user-assisted)

1. **Name an independent reviewer.** Insert one `employer_operators` row for a named person who is not a member of any company they will review, and record an audit note. Only the owner should authorise this. I did not grant it.
2. **Owner acceptance pass on the live site** (use a disposable company domain the owner controls, never a fabricated real company):
   - Sign in at `employer-login.html` with a work address at that domain, and register the company.
   - Publish the `_fortunejobsai.<domain>` TXT record and run "Check DNS". Expect "domain verified, waiting for review".
   - Have the reviewer verify the company with a note.
   - Submit one post and have the reviewer approve it. Check that it appears in Quick Match search.
   - Edit the live post and have the reviewer reject the edit. Check that the employer sees the reason and that the public listing is unchanged.
   - Close the post. Then have the reviewer suspend and delete the test company, or keep it suspended.
3. **Pilot decisions still open** (`docs/employer-authorized-pilot-checklist.md`, section 2): whether deselect withdraws a listing, whether suspension withdraws approvals, the feed worker scope, and paid publishing (stays off).
4. **Deploy this branch** after review. The change is `employer-submissions.js` plus the cache version in `employers.html`, both static files on GitHub Pages.
