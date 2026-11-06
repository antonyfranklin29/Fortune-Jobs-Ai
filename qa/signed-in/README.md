# Signed-in browser QA (mocked backend)

Runs the built site in Chromium with every Supabase request answered by an
in-memory fake (`mock-supabase.cjs`). No real accounts, emails or data are used,
and nothing leaves the test machine. It covers both desktop (1280px) and iPhone 13.

```
cd react && npm run build && cd ..
node qa/signed-in/run.cjs react/dist /tmp/qa-shots x path/to/text-resume.pdf
```

Checks (33 per viewport):
- **Sign-in:** the Google button is shown when the provider is on; a wrong password gets a friendly error; email sign-in returns to `next`; a signed-in visitor on the login page is sent on; the employer Google redirect target is checked.
- **Saved jobs:** saving keeps the search for signed-out visitors and stores the job when signed in; a job already saved (another tab) shows as saved; the Saved Jobs link lands on the list; remove works.
- **Search history:** signed-in searches are recorded and listed.
- **Profile:** saving details; years validation; data export; Log out; redirect when signed out.
- **Résumé:** PDF read, review and save (file plus profile); the builder's saved-profile import.
- **Email preferences:** opt-in with the `weekly-v1` consent version.
- **Employer workspace:** no company, pending and verified states; no sideways scroll.

The mock is not the real backend. Row-level security, OAuth redirect allow-lists, email delivery and the Edge Functions still need a real test account (see `docs/qa-signed-in-2026-11-05.md`).
