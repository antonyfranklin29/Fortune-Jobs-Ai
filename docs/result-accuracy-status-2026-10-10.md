# Result accuracy — October 10, 2026

Implemented strict result verification for both Quick Match and Live Search. Selected filters no longer act only as ranking bonuses, and unrelated listings are not used to fill ten cards.

## Changes

- Whole-word title checks with explicit software-role equivalents. Company text cannot make an unrelated title eligible. Senior/junior search words remain meaningful in the verification stage.
- Strict city, selected region and country checks. A city selection does not accept other towns in the same state. Remote work does not imply eligibility in every country or city.
- Company, employment type, work arrangement, experience and posting-date filters verified from available source evidence. Unknown fields fail the corresponding selected filter. Non-remote alone does not prove fully on-site work; scrape timestamps do not substitute for posting dates.
- Duplicate removal by source listing ID and canonical application URL, ignoring common tracking parameters. Distinct positions with distinct IDs/URLs are retained.
- Make aggregator preserves original ID, location, dates, classification, requirements, work arrangement and metadata. Supabase `source_metadata` stores the original listing evidence. Its JSON string representation is parsed safely in the client.
- Original search IDs remain required on live result reads. Completion requires both the expected marker title and the explicit zero-score `Search complete` marker, preventing an invalid AI index from being mistaken for completion.
- No legacy JSON-in-title fallback. Match explanations use verified search evidence. Removed uncalibrated numeric match percentages from job cards.
- Honest empty-result messages explain that no verified jobs matched the title and selected filters.

## Evidence

24 regression/accuracy checks passed, covering out-of-city results, countries, unrelated titles, strict filters, unknown metadata, expiry, posting dates, duplicates, URL validation, search isolation, and completion.

Six production Quick Match samples and five production live samples passed. Live samples included New York software engineering with full-time selected (six matches), London product management (seven), and US remote Power BI development (four). A nonexistent company and nonexistent job title returned zero matches rather than unrelated jobs. Live completion ranged from 5,002 to 10,785 ms in this sample.

Updated Quick Match benchmark: 30 reads with zero technical failures, p95 541 ms; 100 simultaneous reads with zero technical failures, p95 1,346 ms. This is one-machine database/client processing, not a global browser load test.

Raw task reports are in `work/result-accuracy-verification.json` and `work/quick-match-after-accuracy.json`. Reproduction: `node --test tests/search-speed.cjs tests/search-accuracy.cjs`; `node tests/result-accuracy-verification.cjs` for read-only checks, or append `--live` for paid live checks.

## Practical limits

Verification improves precision and may produce fewer results. Missing metadata is excluded when a related filter is selected. The saved catalogue and ten-item live candidate batch do not cover every available job. Aliases are intentionally limited; unfamiliar location formats may be excluded rather than guessed. Employer destination availability and listing truthfulness cannot be guaranteed by these checks. This sample is not exhaustive validation of all countries, occupations or combinations.

Rollback: Make version saved before accuracy changes, described as “Verified fast workflow before result-accuracy metadata changes: ten tests passed, source indexes preserved, October 10”. The new nullable database column is backward-compatible and does not need removal during rollback. Frontend and backend must be rolled back together if source metadata preservation is removed.
