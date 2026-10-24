# Employer approval-flow rehearsal, 2026-10-24

The rehearsal was local and disposable. Its reviewer-note display fix was integrated into the public site release on October 24. No real employer was created or reviewer granted by the rehearsal.

**Current workflow differs from the historical rehearsal:** employers no longer publish a DNS record. The current company check is an independent reviewer decision based on evidence the reviewer records. For a verified company, the guarded routine-post rule may publish an eligible first-party job automatically; other posts stay in review. See `docs/employer-automatic-post-review-2026-10-24.md`.

## What was rehearsed

`tests/sql/employer-approval-flow.sql`, run by `tests/employer-approval-flow-db.mjs` on a throwaway PostgreSQL 16, walked the older DNS-based employer chain through `20261026`. These DNS steps are historical test coverage, not current instructions for employers:

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
- On the integrated branch, `npm test` passed 227/227 and the employer backend suite passed 115/115. The PostgreSQL 16 rehearsal was not rerun during integration because this checkout has no disposable server configured.

## Production, read only (no writes)

- One company exists: status `pending`, registered 2026-10-18, with one active owner. It has no posts and no sources.
- `employer_operators`: **0**. Nobody can verify a company, so that pending company cannot proceed.
- Billing: 15 free active posts, 1499 cents, `paid_publishing_enabled = false`.
- The company-domain rule (`company_email_required`) is live in `employer_register_org`, which matches main.

## Remaining blockers (user-assisted)

1. **Name an independent reviewer.** Insert one `employer_operators` row for a named person who is not a member of any company they will review, and record an audit note. Only the owner should authorise this. I did not grant it.
2. **Owner acceptance pass on the live site** (use a disposable company domain the owner controls, never a fabricated real company):
   - Sign in at `employer-login.html` with a work address at that domain, and register the company.
   - Have an independent reviewer check the company and record the evidence and decision. No employer DNS change is needed.
   - Submit one eligible first-party post. Expect automatic publication if every server rule passes; otherwise have the reviewer approve it. Check that it appears in Quick Match search.
   - Edit the live post and have the reviewer reject the edit. Check that the employer sees the reason and that the public listing is unchanged.
   - Close the post. Then have the reviewer suspend and delete the test company, or keep it suspended.
3. **Pilot decisions still open** (`docs/employer-authorized-pilot-checklist.md`, section 2): whether deselect withdraws a listing, whether suspension withdraws approvals, the feed worker scope, and paid publishing (stays off).
4. **Site release:** the reviewer-note change is included with the October 24 site release. A real employer posting and rejection still need end-to-end acceptance.
