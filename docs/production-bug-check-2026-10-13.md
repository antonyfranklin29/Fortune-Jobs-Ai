# Production quick test and fixes — October 13, 2026

Scope: anonymous browser searches and account-form behavior, public page availability, HTTP/HTTPS, and automated regressions. No real account was created, no password changed, no email sent and no personal files uploaded. One normal paid Live Search was submitted; no load test.

## Fixed

- Login form: a user-entered short password remained invalid and enabled after switching to Forgot password, despite being hidden. Native validation could block recovery. Reproduced in production browser (`tooShort=true`, hidden, disabled=false). Mode changes now disable hidden inputs, also preventing a hidden invalid email from blocking the new-password form. Sign-in accepts existing short passwords; signup/reset still require eight characters.
- Removed unimplemented email-alert promise from login page.
- Loading results badge: a Live Search initially displayed Quick Match until results arrived. Loading now sets the correct badge immediately.

## Passed

- 64 automated tests, including new account-mode validation regressions.
- Public asset health: eight pages/scripts returned HTTP 200.
- Production browser: Data Analyst + New Jersey state selection navigated to dedicated results and displayed three NJ jobs with correct summary, Save/Apply controls and subscription offer. No captured browser errors.
- 390px mobile Find Jobs viewport had no horizontal page overflow. This is a responsive browser check, not a real-device certification.
- HTTPS root returned 200. HTTPS www redirected to HTTPS root without certificate errors. HTTP root and www redirected to HTTPS root. Earlier certificate issue is resolved in this check.

## Still outstanding

Follow-up: the NJ marker-only result was resolved in one retest after correcting Make actor input escaping. See `make-input-json-fix-2026-10-13.md`: twelve-second successful execution and six browser-displayed matches. The original observation below remains the pre-fix record.

- One statewide Data Analyst Live Search returned only a completion marker and zero real rows. The empty-state interface completed correctly; source coverage/Make processing still needs investigation. Make browser tabs included signed-out pages; no claim that this backend issue is fixed.
- Supabase public auth settings: email=true, google=false, apple=false. Provider configuration and real OAuth tests are the next requested task. Any iCloud address can use ordinary email sign-in; Sign in with Apple is a separate provider.
- Authenticated signup, confirmation delivery, password recovery delivery, profile mutations and two-user access tests were not performed in this pass.
- Adzuna activation, catalogue refresh, gateway cutover, billing, real backup recovery and repository privacy remain separate launch tasks.
