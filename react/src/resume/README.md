# Résumé pages (React)

Ports of `resume-search.html` and `resume-builder.html`. The public HTML pages are unchanged.

## Exports and routes

| Route (keep the `.html` URL) | Export |
|---|---|
| `/resume-search.html` | `ResumeSearchPage` |
| `/resume-builder.html` | `ResumeBuilderPage` |

Also exported from `react/src/resume`:
- `resumeRoutes` (the table above as data, with page titles).
- `ResumeServicesProvider`, `createResumeServices`, `createBrowserResumeReaders`, `useResumeServices`, `readResumeFile`, `readErrorText`.
- `COUNTRIES` (the 29 search countries).
- `guestResume`, `resumeMatching`, `resumeBuilder`: ESM ports of `guest-resume.js`, `resume-matching.js` and `resume-builder.js`, so the results page can use the same `assess()` and `rank()` explanations.

## Wiring

```jsx
import { ResumeServicesProvider, createResumeServices, createBrowserResumeReaders } from './resume';
const services = createResumeServices({
  account: accountServices,          // optional: anything with { sb, user() }; only the builder's profile import uses it
  ...createBrowserResumeReaders(),   // pdfToText via /resume-extraction.mjs, docxToText via window.mammoth
});
<ResumeServicesProvider services={services}>{routes}</ResumeServicesProvider>
```

Defaults: `storage` = `sessionStorage`, `navigate` = full `location.href` load, `search` = `location.search`, `catalog` = `window.JOB_SUGGESTIONS`, `print` = `window.print`, `confirm` = `window.confirm`.

The page needs `/vendor/mammoth.browser.js` (DOCX) and `/job-titles.js` (title and skill catalogue) loaded. Without them, DOCX shows "still loading" and detection falls back to the built-in titles and skills.

CSS is scoped under `.fja-res` plus `.fja-resume-search` or `.fja-resume-builder`. The app shell owns `body` margin and background.

## Behaviour kept from the legacy pages

- **Résumé search**
  - Upload, the manual no-upload path ("Enter experience and skills instead", or `?manual=1`), and "Search jobs without a résumé" (`find-jobs.html?resume=0`) all stay.
  - `?edit=1` reloads saved details or shows the expiry message.
  - Files are read in the browser only: PDF or DOCX, 1 byte to 5 MB, 30 to 60,000 readable characters. Password-protected PDFs get their own message.
  - Detection uses the legacy `detect()` with the same country map. The estimated-experience note appears when experience is estimated.
  - The form needs a title and 1 to 30 skills. It saves to `sessionStorage` key `fj_guest_resume_v1` (two-hour expiry), then goes to `find-jobs.html?resume=1&resume_id=<match_id>`. If storage is blocked, the person sees the legacy message.
  - Clear removes the saved details.
  - Generation counters drop stale reads.
- **Résumé builder**
  - The draft stays local, with a live preview. Only http(s) links are shown.
  - The advice box appears, and export (print) needs the accuracy box ticked, a name, and an email or phone.
  - Clear asks first.
  - Profile import reads only `full_name,email,current_title,skills,preferred_locations` for the signed-in user. If signed out, it shows the sign-in link (`login.html?next=resume-builder.html`).
  - Both imports fill only empty fields and untick the accuracy box. File import shows the extracted text for review.
  - Stale profile or file reads are ignored after clear.
- **Score explanations**: `resumeMatching.assess()` and `rank()` are identical to the legacy file (parity-tested). They are exported for the results page.

## Tests

There are 22 tests in 3 files (Vitest, jsdom, @testing-library/react):
- **Parity:** suggest, contains, rank, assess, detect, clean, save/load expiry, params, draft, advice, profileSuggestions, run against the legacy scripts.
- **Search page:** 8 tests.
- **Builder page:** 7 tests.

## Migration risks to check during integration

1. **Content Security Policy.** The legacy builder sets `form-action 'none'` and limits `connect-src` to self plus the Supabase project. Both pages set `object-src 'none'; base-uri 'none'` and `referrer no-referrer`. Keep these in the React `index.html`, or per route if pages are served separately.
2. **Printing.**
   - Print hiding is gated with `body:has(.fja-resume-builder)`, so other routes print normally.
   - `@page{size:letter;margin:0.65in}` cannot be scoped. It applies to any print once this CSS has loaded.
   - `:has()` needs Safari 15.4+, Chrome 105+ or Firefox 121+. Older browsers print the whole page.
3. **Keep the full-page navigation to find-jobs.** The legacy results page reads `sessionStorage` on load. A router push is fine only if the React find-jobs page reads the same key.
4. **Static assets.** `resume-extraction.mjs` resolves `./vendor/pdf*` from its own URL. Keep `/resume-extraction.mjs`, `/vendor/` and `/job-titles.js` at the same paths.
5. **Old tests.** The legacy tests for these scripts still cover the HTML pages. Retire them only when those pages are removed.
