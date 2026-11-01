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
3. **Observed third-party requests** (local Playwright load of 12 public pages with all external calls blocked and recorded; no production traffic). This feeds the privacy/cookie item in `docs/legal-readiness-2026-10-24.md`:
   - **On load:**
     - `fonts.googleapis.com` (most pages, plus `fonts.gstatic.com` for font files);
     - `cdn.jsdelivr.net` (Supabase JS library);
     - the project's `*.supabase.co` (index, find-jobs, results).
     - `privacy.html`, `terms.html`, `contact.html` and `resume-search.html` make no third-party request on load.
     - With external scripts blocked, no page set a cookie or local/session storage key on load. The Supabase library was not loaded in this check, so its sign-in storage still needs a separate look.
   - **Referenced in code and loaded on use:**
     - `img.logo.dev` company logos, which are fetched per job card with `referrerpolicy=origin`. They are **missing from the legal doc's processor inventory**.
     - `geocoding-api.open-meteo.com` (location suggestions).
     - Indeed's logo CDN host (allow-listed in `company-logos.js`).
     - Adzuna links; Google OAuth.
   - `hook.us2.make.com` appears in the three pages' legacy `WEBHOOK_URL_*` constants. That hook was deleted on October 29. The prepared cutover branch blanks them, and the release guard blocks unpausing while they remain.

## Still needs Franklin

- **Live Search go-live**, with fresh coordination:
  - approve applying Codex's quota and write-lockdown migrations;
  - set the gateway `paused` state;
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
