# Account and employer pages (React)

Ports of `login.html`, `employer-login.html`, `profile.html` and `employers.html`. The public HTML pages are unchanged; these components are for the React app under `react/`.

## Exports and routes

| Route (keep the `.html` URL) | Import | Export |
|---|---|---|
| `/login.html` | `react/src/account` | `LoginPage` |
| `/employer-login.html` | `react/src/account` | `EmployerLoginPage` |
| `/profile.html` | `react/src/account` | `ProfilePage` |
| `/employers.html` | `react/src/employer` | `EmployerWorkspacePage` |

Also exported:
- `accountRoutes` and `employerRoutes` (the table above as data).
- `AccountServicesProvider`, `createAccountServices`, `useAccountServices`.
- `createBrowserResumeTools`.
- Reusable UI: `AccountNav`, `Avatar`, `StatusMessage`, `AdzunaCredit`, `friendlyAuthError`.

## Wiring

```jsx
import { AccountServicesProvider, createAccountServices, createBrowserResumeTools } from './account';
const services = createAccountServices({
  sb,                       // the app's single supabase-js client (persistSession, autoRefreshToken, detectSessionInUrl)
  config: { url, key },     // same public values as /config.js
  resumeTools: createBrowserResumeTools(), // optional; see below
});
<AccountServicesProvider services={services}>{routes}</AccountServicesProvider>
```

- **Navigation.** It defaults to full-page `location.href` / `location.replace`. Pass `navigate` / `replace` to use the router, but full loads are the safer default around Supabase auth redirects.
- **Résumé reading.** `createBrowserResumeTools()` expects these on the page:
  - the legacy `/resume-extraction.mjs` with `/vendor/pdf*`;
  - `window.mammoth` (`/vendor/mammoth.browser.js`);
  - `window.FJResume` (`/resume-matching.js`);
  - `window.JOB_SUGGESTIONS` (`/job-titles.js`).

  Without them, the résumé box shows "Resume reading is unavailable" and everything else works.
- **Employer workspace data.** It fetches `config/job-roles.json` and `config/us-regions.json` relative to the page. Serve them at the same paths.
- **Reviewer prompts.** The reviewer panel uses `window.prompt` for the evidence note, as today. Pass `prompt={fn}` to replace it.

CSS is scoped. Every rule sits under `.fja-acct` plus `.fja-login`, `.fja-profile` or `.fja-employer`, generated from `account.css` and each page's own `<style>`.

## Behaviour kept from the legacy pages

- **Redirect allow-list.** The `next` allow-list (`lib/accountFlow.js`) blocks open redirects. Employer sign-in always returns to `employers.html`.
- **Auth links come back to login.html.** Sign-up confirmation, OAuth and password-reset links all return through `login.html`, which keeps the Supabase redirect allow-list unchanged. `PASSWORD_RECOVERY` switches to the reset form, and a signed-in visitor is sent on unless they arrived on a reset link or a callback error.
- **Server-checked employer state.** Employer state comes only from `employer_my_state` and `operator_queue`. User metadata never grants access, and only content fields are sent with `employer_save_post`. Verifying a company needs a non-empty evidence note, and a post with no visible description cannot be approved.
- **No stale private data.** Account changes clear private content before reloading, and late responses from an earlier account are ignored.
- **Account deletion.**
  - It runs only from the final button. The checks are the typed phrase, a matching email and the confirmation box.
  - It sends one request, carrying the bearer token, to `/functions/v1/delete-account`.
  - A re-authentication answer returns to `profile.html#delete-account`, and the page's own sign-out redirect does not override it.
- **Résumé and photo rules.**
  - Résumé removal detaches first and only removes the user's own path.
  - Avatars are shown only from this project's `avatars` bucket, under the user's folder.
  - Saved-job links are restricted to http(s), and Adzuna listings carry the credit.

`lib/` holds ESM ports of `account-flow.js`, `account-deletion.js` and `data-safety.js`. `tests/parity.test.js` runs the same inputs through the legacy scripts to keep them identical.

## Tests

The tests use Vitest with jsdom and @testing-library/react. There are 37 tests across 4 files:
- parity with the legacy scripts;
- the sign-in flows;
- the employer workspace, including security cases;
- the profile page, including deletion.

Add these as devDependencies in `react/package.json`: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`. Use `environment: 'jsdom'`.

## Migration risks to check during integration

1. **Keep the `.html` URLs.**
   - Supabase's redirect allow-list and every emailed link use `login.html`. The `next` allow-list also names pages by file.
   - GitHub Pages has no SPA fallback, so each route needs a real file at that path, or a `404.html` redirect, before the HTML pages are replaced.
2. **One Supabase client.** Use the same version (2.117.3 on the legacy pages) and the same storage key, so existing sessions carry over. A second client would race on token refresh.
3. **`detectSessionInUrl`.** It must process the OAuth or email-link hash on `login.html` before any route redirect runs.
4. **Security headers.** The legacy pages set a CSP meta (`object-src 'none'; base-uri 'none'`) and `referrer no-referrer`. Keep both in the React `index.html`.
5. **Static assets and paths.** pdf.js and mammoth are vendored assets, and `resume-extraction.mjs` resolves `./vendor/...` from its own URL. Keep those paths, or port them deliberately.
6. **Old tests.** The existing tests (`tests/login-form.cjs`, `tests/employer-workspace.cjs`, `tests/account-deletion.cjs`, `tests/data-safety.cjs`) still cover the legacy pages. Retire them only when those pages are removed.
7. **Employer-login wording.** The legacy pages switch wording with a `data-account-area` attribute on `<body>`. Here it is the page export, plus `?next=employers.html` on `login.html`.
