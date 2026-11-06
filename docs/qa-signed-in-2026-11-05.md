# Signed-in flows QA — 2026-11-05

Scope:
- Google/email sign-in, saved jobs, profile, résumé upload/export, employer workspace and email preferences;
- desktop (1280px) and mobile (iPhone 13).

Branch `claude/signed-in-qa-1105` from main `bc27a7c`. Deployed in `14f5f94` on Franklin's instruction, with no Codex review.

## How it was tested

1. **Live site, signed out (Chrome).** Every signed-in page redirects or prompts correctly.
   - `profile.html` goes to `login.html?next=profile.html`.
   - Employers shows "Sign in to post jobs."
   - Email preferences shows the sign-in link.
   - The builder's profile import asks you to sign in.
   - The Supabase auth settings report Google on, email on, sign-up open and email confirmation required.
2. **Built site with a mocked Supabase backend** (`qa/signed-in/`, 33 checks per viewport). It uses synthetic data only; no real account was used.
3. **Read-only backend review:**
   - row-level security (RLS) policies for profiles, saved_jobs, search_history and storage;
   - table constraints;
   - Edge Function list;
   - the `email-preferences` source;
   - the security advisors.

## Bugs found and fixed on this branch

| # | Area | Repro (before fix) | Fix |
|---|---|---|---|
| 1 | Saved jobs | Signed out, open `results.html?mode=quick&q=Data+Analyst&location=Chicago` and click **Save job**. You land on `login.html?mode=signup&next=results.html`, so after sign-up the search is gone. Confirmed on live. | `next` carries the full results URL. |
| 2 | Search history | Sign in, run any Quick Match search, then open Profile → Search history. It says "No searches yet". Saved filters also stay "None yet". The React search never wrote `search_history` or `saved_filters`; the old site did. | Signed-in Quick Match searches with a query insert one history row and update `saved_filters`. The résumé ID is not stored. |
| 3 | Saved jobs | Save a job in tab A, then save the same job in tab B. Tab B shows "Could not update saved jobs" (the unique `(user_id, job_key)` error). | A duplicate is treated as already saved, as on the old site. |
| 4 | Saved jobs | Header **Saved Jobs** or mobile **Saved** opens `profile.html#saved` but stays at the top, because the section renders after the profile loads. | Scroll to the hash once the profile is ready. Sections get a scroll margin so they land below the sticky bars. |
| 5 | Profile (mobile) | At 390px the account bar wraps to two rows and covers the sticky section bar (Profile / Resume / Saved jobs…). | On phones the account bar scrolls away and only the section bar stays sticky. |
| 6 | Saved jobs | Inserted fields were not limited, but the table checks company ≤200, location ≤200 and salary ≤120 characters. Today's catalogue is within limits (max location 47, max salary 33), but a longer listing would fail to save. | Fields are trimmed to the column limits. |
| 7 | Search history | History filter text dropped the new React values ("Hybrid", "Full-time", "Mid-Senior level"), and **Search again** dropped salary and industry. | Labels pass through, and all filters are kept. |

Tests:
- Unit tests: 89 of 89 pass, including 4 new ones for these helpers.
- Mocked browser run: 66 of 66 checks pass (desktop plus mobile).
- Before the fixes, 12 of those 66 failed, for bugs 1–4 on both viewports.

## Passed without changes (mocked backend, both viewports)

- **Sign-in:**
  - the Google button is enabled when the provider is on;
  - a wrong password shows "Wrong email or password.";
  - email sign-in returns to `next` with its query;
  - a signed-in visitor on `login.html` is sent on;
  - the employer Google sign-in redirect target is `login.html?next=employers.html`.
- **Profile:** saving details works, 99 years is rejected, Log out signs out, and the profile redirects to login when signed out.
- **Résumé:**
  - a PDF is read in the browser and shows the review step;
  - saving uploads to `resumes/<user id>/…` and updates the profile;
  - the word count is shown;
  - the builder imports the saved profile.
- **Email preferences:** the signed-in opt-in is saved with `consent_version: weekly-v1`.
- **Employer workspace:** the no-company, pending and verified states render with no sideways scroll on phone.
- No page errors.

## Blockers: need a real test account

The mock cannot prove these. Each needs a real seeker test account and a real employer test account, signed in by Franklin in a browser tab. I will not create accounts or type passwords.

1. **Google OAuth round trip:** the Supabase redirect allow-list accepts `https://fortunejobsai.com/login.html?next=…`, and the account lands on the right page.
2. **Sign-up and password-reset emails:** they arrive and their links work. Email confirmation is required (`mailer_autoconfirm: false`).
3. **Real RLS writes:** save, remove, history insert and clear, profile update, résumé and avatar storage upload, the signed URL for **View**, and data export.
4. **Live Edge Functions:**
   - `email-preferences` GET and POST;
   - `delete-account` (use a throwaway account, because deletion is permanent).
5. **Employer RPCs:** `employer_register_org`, the domain challenge, and the `employer_save_post` → submit → reviewer approval path.

Suggested accounts:
- `qa-seeker+1@…`;
- `qa-employer+1@…`, on a domain we control, for verification;
- one throwaway account for the deletion test.

## App launch risks (Nov 11 start, Dec 1 target)

1. **Leaked-password protection is off** (Supabase advisor). Turn it on in Auth settings before the app goes live.
2. **Old test Edge Functions are still listed:** `gateway-ip-probe` and `gateway-forgery-probe`. I checked their code: both are retired stubs that require a sign-in token and only return 410 "gone". This is low risk; delete them from the dashboard when convenient.
3. **`job_matches` is readable by anyone** (anon SELECT, `true`). It has 662 rows of live-search results, with search IDs and match reasons. Decide whether that is intended before the app reads it.
4. **The app's sign-in redirects.** A native app needs its own redirect URLs (deep link or custom scheme) added to the Supabase allow-list. `email-preferences` only allows the `fortunejobsai.com` origins in CORS, so the app needs a server-side path or an added origin.
5. **Email confirmation is required.** The website now explains this state (403 "confirm your email first") and expired sessions (401) on the email preferences page. The app must handle both too.
6. **Search history:** one row is written per signed-in search, and a reload or repeat of the same search is not stored again. There is still no retention limit; the profile shows the last 25.
7. **Non-US searches return nothing** (Quick Match only has US listings). The website now says so and suggests United States or Any country. App store reviewers outside the US will still see no jobs.
8. **Live Search is paused, and Pro billing is "Coming soon".** The app should not show a paid feature that cannot be bought yet.
