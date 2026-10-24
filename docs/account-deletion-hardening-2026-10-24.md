# Account deletion: backend hardening and profile UI, 2026-10-24

Branch `claude/account-deletion-hardening`. **Implemented and tested locally. Not deployed.** Production `delete-account` is still version 6, the source from de499aa. No real account was deleted, and no real file was touched.

## Backend fixes (`supabase/functions/delete-account/index.ts`)

1. **The recent-login gate no longer trusts token issue time.**
   - Freshness now comes only from the token's `amr` authentication events. The token itself is validated with Auth first.
   - Accepted methods: `password`, `oauth` (Google), `otp`, `magiclink`, `sso/saml`, `totp`, `mfa/totp`, `mfa/phone`.
   - These fail closed: no `amr`, a malformed `amr`, unknown or non-interactive methods (such as `token_refresh` or `anonymous`), and timestamps more than 60 s in the future.
   - A refreshed token with a fresh `iat` and an old sign-in is refused.
2. **Storage is proven empty before the identity is deleted.**
   - The walk follows every nested folder under `<uid>/`, because the storage policies allow any depth below the owner folder.
   - It paginates past 2,000 objects, up to a bound of 10,000 objects and depth 8.
   - It deletes through the Storage API in batches of 100, then re-lists, up to three rounds, to catch uploads that land meanwhile.
   - It fails closed on a non-JSON or non-array listing, an entry without a valid single-segment name, a path outside the owner folder, bounds exhaustion, or files still present after the final round.
   - Storage metadata is never deleted directly.
3. **The comment and messages are honest about partial deletion.**
   - Removed files and rows are permanent; nothing is restored.
   - A partial failure (`partial_cleanup`) says that anything already removed cannot be restored, and that the account stays open so the person can retry.
   - An identity failure after data removal is reported separately (`identity_not_closed`).
   - The identity is still deleted last, and retries are idempotent.

Through the `auth.users` cascade, deletion also removes `newsletter_preferences` and `newsletter_deliveries`. A production read-only check confirmed `ON DELETE CASCADE` on both, as well as on `profiles`, `saved_jobs`, `search_history`, `employer_org_members` and `employer_operators`. Employer records that reference the person (`created_by`, `reviewed_by` and similar) are set to null.

**Known race (documented in the source):** an upload in the moment between the final storage check and the identity deletion, or one made afterwards with a still-unexpired access token, is not caught. Closing it fully needs a storage policy that also requires the user to exist. That would be a separate, reviewed policy change.

## Profile UI (`profile.html`, new `account-deletion.js`)

- **New section** "Delete your account" (`#delete-account`). It requires typing DELETE MY ACCOUNT, the account's own email, and a ticked "I understand" box.
- **Two-step confirmation.** "Delete my account…" opens an in-page final step, and only "Delete permanently" sends the request. Nothing runs on page load, on the `#delete-account` link, or after returning from sign-in.
- **No duplicate submissions.** Buttons are disabled while a request runs, and repeated clicks send one request.
- **Separate states:**
  - Phrase or email mismatch: shown on the matching field, with "Nothing has been deleted".
  - Stale session: offers "Sign in again". This signs out and returns to `profile.html#delete-account`, including through Google sign-in.
  - Partial cleanup: the message says removed data cannot be restored, and retry is allowed.
  - Identity not closed: reported on its own.
  - Network error: makes no claim about what was deleted.
- **Signing out.** Only after a confirmed deletion does the page sign out locally (the server has already ended the sessions) and show a completion screen. The page's own sign-out redirect waits for this.
- **Accessibility.** Labelled fields, inline `role="alert"` errors with `aria-invalid`, a polite status region, and focus moved to the first error or the final button.

## Evidence

- `tests/delete-account.ts` (Deno, mocked Auth, Storage and PostgREST): **9 of 9 pass.**
  - Covers recent login (email and Google, refreshed token, no `amr`, unknown method, future timestamp), more than 2,000 objects with nested folders, prefix-adjacent and other-user bystanders, malformed listings, a transient failure with a retry after partial progress, concurrent uploads, and identity failure with a retry.
  - Against the original function, **7 of 9 fail**.
- `tests/account-deletion.cjs` (UI logic with a fake DOM): **10 of 10 pass.**
- Real-browser check of `profile.html`, with Supabase stubbed, at 1280 px and 360 px:
  - No page errors and no request on load.
  - Exactly one request, then the completion screen and a local sign-out.
  - No horizontal overflow.
  - This check also found and fixed a hidden checkbox and a visible "Sign in again" button.

## Not done, and why

- **Deployment.** Not requested. Deploy the function before, or together with, the page, because the old function would still accept refreshed tokens.
- **`privacy.html`** still says "A complete self-service account deletion feature is not available yet." It must change in the same release as the page. Proposed replacement for that sentence:
  > Delete your account, at the bottom of your profile, permanently deletes your profile, extracted resume text, uploaded resume and photo files, saved jobs, search history and email preferences, then closes your account. You may be asked to sign in again first. Deleted data cannot be restored. Live Search usage records are kept without your account attached. If you are the last owner of an employer company, its live listings are closed.
- **The account export** (`data-safety.js`, a shared file) does not include `newsletter_preferences`. It is proposed for the owner of that file.
- **`package.json`.** The new tests are not yet in the `npm test` list. This is a shared file.

## User-assisted acceptance (two explicitly disposable accounts, never the owner's real account)

1. Create disposable account A with email and password, and disposable account B with Google. Upload a resume and a photo, save a job, run a search, and turn on the weekly email preference.
2. With account A signed in for more than 15 minutes, keeping the tab open so the token refreshes, try to delete it. Expect "sign in again" and nothing deleted.
3. Sign in again, return to the section, and delete. Expect the completion screen.
   - In the dashboard, the resume and avatar folders for A are empty.
   - No `profiles`, `saved_jobs`, `search_history` or `newsletter_preferences` rows remain for A.
   - The auth user is gone, and A's admissions remain with `account_id` null.
   - Account B's data is untouched.
4. Repeat steps 2 and 3 with account B through Google sign-in.
5. Try a wrong phrase and a wrong email once each. Expect field errors and nothing deleted.
