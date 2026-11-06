# Informational pages (React)

Ports of `about.html`, `privacy.html`, `terms.html`, `contact.html` and `email-preferences.html`. With these, every page on the site is built from `react/`.

| Route | Entry | Export |
|---|---|---|
| `/about.html` | `src/about-entry.jsx` | `AboutPage` |
| `/privacy.html`, `/terms.html`, `/contact.html` | `src/policy-entry.jsx` | `PrivacyPage`, `TermsPage`, `ContactPage` |
| `/email-preferences.html` | `src/email-preferences-entry.jsx` | `EmailPreferencesPage`, `createPreferenceClient` |

- **Wording.** The page text is copied exactly from the static pages. `tests/parity.test.jsx` compares every heading, paragraph and link with the reference copies in `tests/legacy/`. A policy wording change needs a review, plus an update to both the page and its reference copy.
- **Styles.** The styles are each page's original CSS (`src/styles/about-base.css`, `policy-base.css`, `email-preferences.css`). The policy styles `@import` the root `account.css` first, so the cascade order matches the old pages. Screenshots at 1280px and 390px matched the static pages pixel for pixel.
- **Email preferences.**
  - It uses the shared Supabase client. It reads and saves only through `/functions/v1/email-preferences`, with the person's own session token and the `weekly-v1` consent version, as `newsletter-preferences.js` did.
  - Signed-out visitors get the sign-in link back to this page.
