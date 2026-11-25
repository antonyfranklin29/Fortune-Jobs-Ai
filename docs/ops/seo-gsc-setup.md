# Search Console collector — proposed setup

No migration, secrets, schedules, workflow dispatch or production data changes were made in this PR. Bing remains deferred; there is no unsupported API assumption or scraping fallback.

## Franklin's setup, after release approval

1. Create a Google Cloud service account and enable Search Console API in that project. Add its email as a Full user (needed for URL inspection) to the Search Console **domain property** `sc-domain:fortunejobsai.com`. No domain-wide delegation, website ownership transfer or Google Workspace access is required.
2. Add the service-account JSON directly as the GitHub Actions secret `GSC_SERVICE_ACCOUNT_JSON`. Do not paste it into chat, source or PRs. The collector exchanges a signed JWT for the read-only webmasters scope; it never requests indexing or changes the property.
3. Review/apply `migrations/pending/20261124_seo_gsc.sql` separately. Set GitHub secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` directly. The service key is server-only and never goes into public assets. No secret value was inspected here.
4. After the reviewed release, manually run **Collect Search Console observations and SEO actions** on main. Missing setup skips without any external request. Incorrect credentials or missing tables fail with bounded, credential-free error text. Check the private tables and report artifact before considering scheduling.
5. Review weekly report output before publishing it. Artifacts contain selected query/page observations, not credentials or raw API responses; GitHub artifact access follows repository visibility. Do not publish private query information without review.

## Behavior and limits

- Daily mode refreshes seven finalized dates ending three days before execution, atomically replacing each day's query/page snapshot. This is a small rolling backfill for reporting delays. Dates are GSC reporting dates, not local visitor dates. Dimensions are date/query/page, search type web; positions are Google's impression-based observations, never fabricated ranks.
- Pagination is 25,000 rows/request, capped at the API's 50,000/day/search-type exposure. Bounded days are recorded explicitly. Privacy-filtered and missing rows remain unknown. Query strings containing email markers, long digit sequences, URLs or control characters are dropped. Only approved public same-origin page URLs without query/fragment are retained.
- Inspection chooses never-inspected/oldest sitemap URLs first, at most **300 per UTC day across reruns**, protected by an advisory lock and persisted claims. Failed/interrupted requests consume claims too. No automatic retries can multiply that allowance. Older indexed snapshots, canonicals and first-observed discovered status are stored; this is not a live render test or an indexing request.
- Weekly mode reads stored data only and writes `docs/ops/seo-weekly.md`. Opportunities require five observed impressions and weighted position 5–20. New/absent queries compare complete seven-day windows; comparisons are withheld until 14 imported dates exist. “Absent” does not mean a lost rank. Discovered URLs need 14 days of observation and an inspection in the last seven days to enter the stuck list.
- The workflow is **manual only**, with read-only repository permission and artifact output. It never commits, opens PRs, deploys or changes content. To obey the no-cron-change rule, daily `20 14 * * *` and weekly review on Monday are proposals only, not installed schedules. Daily mode also refreshes the report, so a second weekly API crawl is unnecessary.
- All `seo_*` tables are private under RLS. Anonymous and ordinary users cannot read them or call collector RPCs. There is no public admin dashboard in this phase. Query/API history is not backfilled before the selected import window; a separate approved backfill can be added later.

## Primary documentation

- [Search Analytics request, dimensions and pagination](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
- [Search Console data delay and row exposure](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data)
- [URL Inspection API](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect)
- [API quotas](https://developers.google.com/webmaster-tools/limits)
- [Service account OAuth](https://developers.google.com/identity/protocols/oauth2/service-account)
