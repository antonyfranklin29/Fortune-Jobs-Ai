# Launch handoff: Make v2 hardening and checklist prep (Claude, 2026-11-01)

No paid run, no Make activation, no secret change, no site switch, no billing. The `codex/seeker-live-quota-1031` branch was not touched.

## Changed (Make scenario 6856037 "Live Search (gateway only) v2 LOW-COST", edited in the Make UI)

| Setting | Before | After |
|---|---|---|
| Module 43 (Supabase Make an API Call) query string | none | `columns=job_title,company,location,salary,apply_url,search_id,match_score,match_reason,source_metadata` |
| Scenario setting "Store incomplete executions" (`dlq`) | Yes | **No**. Make documents that stored executions may be retried automatically, which would re-run a paid search. Every risky module already has an Ignore error route. |
| "Keep data confidential" | No | **No (unchanged, deliberate).** See the review below. |
| Freshness filter (module 41) | 30 days | 30 days (unchanged, as decided) |

### Confidential-mode review

- Make run history holds:
  - the search keyword and location;
  - the scraped listings;
  - Claude's ranking.
- It holds no account ID, résumé text, email or IP. The gateway sends only keyword, location filters and `search_id`.
- The same query text is already kept in `live_search_admissions.query_text`.
- Turning confidential on would remove the run data that let us verify the first two tests (per-module credits, filter outcomes, index mapping).
- **Recommendation:** keep it off through the first launch week while runs are watched. Then switch it on, and add Make to the processor list in the privacy notice either way.

## Verified after save (read-only Make API and DB)

- 6856037: **Inactive**, hook 3008463, `dlq=false`, `confidential=false`, `maxErrors=3`, 0 incomplete executions.
  - Route modules are unchanged: 2, 4, 11, 15, 5, 12, 14, 41, 42, 43.
  - The module 41 filter is present, and module 43 keeps its error route (44, 45).
- 6798265: **Inactive**, hook 2989632.
- Both hook queues are **0**.
- Bulk-insert DB contract: `tests/live-search-bulk-insert-db.mjs` passes 5/5 (local PGlite, production triggers), on branch `claude/live-search-v2-test-1101`.

## Prepared without Franklin's business details

1. **Employer reviewer grant runbook:** `docs/employer-reviewer-grant-runbook.md`.
   - It is a guarded single-transaction SQL with placeholders only.
   - It refuses an ambiguous email or anyone who is an active company member.
   - It includes verify and revoke steps. No reviewer was granted.
2. **The pilot checklist is stale.** `docs/employer-authorized-pilot-checklist.md` (October 16) still says the lease/URL migration is unapplied and has no rollback. But `docs/employer-url-integration-2026-10-17.md` records it as **applied October 17** with a tested `--url-rollback`.
   - Its open decisions are still open: deselect-withdraws?, suspension policy, retention periods, feed worker scope.
   - Read the integration doc first when using the checklist.
3. **Third-party services observed.** See the section below. This is input for the privacy-notice and processor work in `docs/legal-readiness-2026-10-24.md`.

## Third-party services observed (factual input for legal review)

This is an engineering inventory, not a legal assessment.
- It does not say whether any service is a "processor" or "sub-processor" in law, whether an agreement exists, or what the public notice should say.
- It does not change `privacy.html` or `terms.html`.
- Counsel and the privacy owner decide how to describe these services.

**How it was gathered (2026-11-01):**
- **Page load:** I loaded 12 public pages from a local copy of the site in Playwright, blocked every outside request and recorded the host. No production traffic was involved.
- **Feature use:** read from source code (`company-logos.js`, the `CITY_API` code in `index.html`, `find-jobs.html` and `results.html`) and from the deployed Live Search path seen in the Oct 31 and Nov 1 capped runs.
- I didn't measure the Supabase library's own sign-in storage, because the library was blocked during the load check.

### A. Contacted by the visitor's browser when a page loads

| Service | Pages | What it receives |
|---|---|---|
| Google Fonts (`fonts.googleapis.com`; font files normally come from `fonts.gstatic.com`) | Most pages, including index, find-jobs, results, profile, sign-in pages and about | Standard request data: IP address, user agent, referring page |
| jsDelivr (`cdn.jsdelivr.net`) | index, find-jobs, results, profile, sign-in pages, employers | Standard request data, to load the Supabase browser library |
| Supabase (project `*.supabase.co`) | index, find-jobs, results | Catalogue and result reads; signed-in session data when a user is signed in |

`privacy.html`, `terms.html`, `contact.html` and `resume-search.html` made no outside request on load. With outside scripts blocked, no page set a cookie or local or session storage key on load.

### B. Contacted only when a feature is used

| Service | Triggered by | Who calls it | What it receives |
|---|---|---|---|
| **logo.dev** (`img.logo.dev`) | Job cards for companies that have a catalogue brand entry. Order tried: bundled local logo, then a feed logo, then logo.dev, then initials. | Visitor's browser, image request with `referrerpolicy=origin` | Company logo URL, the visitor's IP and user agent, and the site origin as referrer |
| Indeed logo CDN (`d2q79iu7y748jz.cloudfront.net`) | Job cards whose listing carries an Indeed logo | Visitor's browser | Standard image-request data |
| **Open-Meteo** (`geocoding-api.open-meteo.com`) | Typing in the city/location box (index, find-jobs, results) | Visitor's browser | The typed location text, IP and user agent |
| **Make** (`hook.us2.make.com`, hook 3008463) | A Live Search, through the Supabase gateway only. Currently paused. | Supabase Edge Function (server to server) | Search keyword, location/country filters, the search ID, results limit, and the API-key header. No account ID, email, résumé or visitor IP. |
| **Apify** (actor `kaix/indeed-scraper`) | Same Live Search, called by Make | Make | Keyword (as parsed by Claude), location, country, item limit |
| **Anthropic** (Claude modules inside Make, model `claude-haiku-4-5`) | Same Live Search, called by Make using Make's Anthropic connection | Make | The search text, then the trimmed listing lines (title, company, location, salary, posted date, ≤300-character summary) to rank |
| Supabase (from Make) | Same Live Search | Make, through its Supabase connection (service role) | The ranked job rows and the completion marker, written to `job_matches` |
| Google OAuth | "Sign in with Google" | Visitor's browser | Standard Google sign-in data |
| Adzuna | Clicking an Adzuna listing's apply link; catalogue ingestion runs server-side | Visitor's browser (link); scheduled job (API) | Standard request data when following a link |

**Notes for the privacy owner:**
- Make, Apify and Anthropic only receive data when Live Search runs. It is paused in production (`live_search_limits.paused=true`) and on the website.
- Make keeps run history, including the keyword, location and listing data, because "Keep data confidential" is off for the first launch week.
- `hook.us2.make.com` also still appears in three pages' legacy `WEBHOOK_URL_*` constants. That hook was deleted on October 29, so nothing can reach it. The prepared cutover branch blanks those constants, and the release guard blocks unpausing while they remain.
- `docs/legal-readiness-2026-10-24.md` already lists Make and Apify but not **logo.dev** or **Anthropic**. Open-Meteo is listed.
- None of this has been reviewed by counsel.

## Still needs Franklin

- **Live Search go-live**, with fresh coordination:
  - approve applying Codex's quota migration. Per Codex, the `job_matches` write lockdown was applied and verified, and `paused=true` was set with pilot limits of 3/hour and 10/day on November 1;
  - approve unpausing the gateway;
  - approve activating 6856037;
  - merge the site switch.
  - Make Core allows 10,000 credits/month (871 used, resets November 11). At about 14 credits per search, keep the monthly cap at or below about 500 searches until the plan changes.
- **Employer pilot:** name an independent reviewer; get one employer's written authorisation and domain verification; answer the four open pilot decisions.
- **Legal:**
  - operator legal name, jurisdiction and address after incorporation;
  - counsel review of Terms and Privacy;
  - retention periods;
  - a postal address before any commercial newsletter;
  - confirm processors (add Make, Apify, Anthropic via Make, logo.dev, Open-Meteo).
- **Backup:** first real encrypted off-site backup and an isolated restore drill. This needs Franklin's storage account, recovery key custody and a test project. Supabase Pro was deferred.
- **Billing:** stays off until Inc/legal and Stripe are set up.
