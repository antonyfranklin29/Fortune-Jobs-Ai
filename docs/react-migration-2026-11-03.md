# React migration status — 3 November 2026

## Scope and ownership

- Codex: Vite build, shared Supabase client, home, Find Jobs, Quick Match results, route integration, production packaging and release checks.
- Claude: job seeker and employer account pages, then résumé search and résumé builder components.
- The live GitHub Pages site remains on the existing pages while React parity is checked. Only the independent results-mode CSS fix was published to the live site (`d32ecde`).

## Available in the React preview

- `index.html`, `find-jobs.html`, `results.html`, `login.html`, `employer-login.html`, `profile.html`, `employers.html`, `resume-search.html`, and `resume-builder.html` are real Vite entries at their existing URLs.
- One Supabase client handles account and job-seeker state. The employer pages use server-checked company and reviewer functions.
- Quick Match reads the real catalogue, filters and ranks relevant listings, limits the free list to ten, and shows source credit and verified logos when available. The home page shows ten recent real listings.
- A fit estimate appears only when a guest profile or signed-in profile supplies details. A visitor can search directly without a résumé.
- Live Search remains paused in the React preview, matching the live release guard. A paid search or Make cutover is outside this migration.
- The résumé upload/manual-entry and builder pages are React routes. The unchanged privacy, terms, about, contact and email-preferences pages are copied as supporting routes. Legacy résumé parsing and extraction modules remain available to the React pages for output parity.

## Build and checks

From `react/`: `npm ci`, `npm test`, `npm run build`, `npm run dev -- --host 127.0.0.1 --port 8877`.
The account, employer and résumé suites pass 59/59. The production build succeeds and emits all nine React HTML entries and the supporting routes. The build also verifies that all 14 pages and their local assets are present and retain the existing pre-launch noindex tag. Local browser checks confirmed sign-in choices, the signed-out employer flow, ten distinct Quick Match results for Data Analyst, a visible mode switch, the full home sections and manual résumé details arriving on Find Jobs. The guest profile reader was switched to the React module after that browser check exposed an expired-profile message despite a valid session profile.

The browser connection stopped responding before I could finish the built-page score and résumé export checks. These are still release gates; test and build success alone do not close them.

## Release gates

1. Verify the built résumé upload, manual profile, score display, builder export and privacy controls in a browser. Automated tests cover these routes, but the complete visitor journey still needs a built-page check.
2. Verify signed-in Google callback, profile save, saved jobs, employer workspace and account deletion with disposable accounts. Automated mocks do not prove these live flows.
3. Verify mobile layout, keyboard navigation, filtering and empty/error states in a real browser.
4. Compare outgoing links and copy with the current site. Keep legal policy content unchanged unless independently reviewed.
5. Prepare a production artifact and reversible deployment; test the built artifact under the intended root paths. GitHub Pages currently serves repository-root files, so merging the `react/` source alone does not replace the live site.

Billing remains disabled and there is no paid search in the migration checks.
