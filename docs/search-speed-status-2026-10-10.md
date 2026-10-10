# Search speed verification — October 10, 2026

Status: Quick Match performance checks passed. Live Search optimization is deployed in Make, but full acceptance remains blocked by provider credits and concurrency limits. The website temporarily displays immediate Live Search unavailability with a working Quick Match action.

## Measured results

- Quick Match: 30 production database searches, zero HTTP/technical failures, p95 513 ms.
- Quick Match: 100 simultaneous production database searches from one machine, zero HTTP/technical failures, p95 1,258 ms, maximum 1,372 ms. Forty returned empty sets for the selected queries/filters; empty results are not technical failures. This excludes browser rendering, geographical network variation, and live scraping.
- One browser Quick Match test displayed ten Data Analyst listings in 812 ms.
- Fast scraper isolated test: `kaix/indeed-scraper`, run `ffyMTpB6QLet2aSZP`, 3,834 ms, ten dataset items. Dataset `ehsoGDXNHjgs1m5EO` was inspected through Make. Timeout 120 seconds, maximum actor charge $0.10. Platform usage may also be charged.
- Optimized live software-engineer search: first stored results at 9,501 ms; completion marker at 12,281 ms; eight relevant jobs. Make run `946d864becd743cab1c722b642c1b951` completed in 12 seconds.
- Concurrent sample after changing the start rate: New York software engineer completed in 11,810 ms; Bengaluru software engineer in 12,284 ms; London product manager in 12,339 ms. URLs were checked for HTTP(S) format, not employer destination availability.
- The concurrent sample did not pass full acceptance: one query took 33,120 ms, and another was rejected when the Apify account exceeded five simultaneous actor runs. Earlier sequential timeouts were affected by Make's one-run-per-minute queue. These failures must not be omitted from reporting.

## Saved changes

- Make's maximum starts per minute changed from 1 to 100. Parallel processing was already enabled. This removes the one-minute start throttle; it does not grant additional Apify capacity.
- Replaced the live actor with `kaix/indeed-scraper`, basic search, ten items, 120-second timeout, and $0.10 maximum actor charge. User title/location/country remain dynamic; GB maps to UK.
- Reduced the AI response to original array indexes, scores and short reasons. Supabase copies title, company, location, salary and application URL from those original items rather than AI-rewritten values.
- Added an end marker after ranked jobs. The website retrieves up to eleven rows, hides the marker, displays at most ten cards, and stops checking when the marker arrives even with fewer than ten jobs.
- Reduced the no-response browser deadline from five minutes to 150 seconds.
- Removed the normalizer's Data Analyst default for unknown keywords and selected the available Haiku model. This final change still needs a fresh empty-search production test.
- Enabled incomplete-execution storage and added an Apify Retry error handler: three retries, one minute between retries. Configuration is saved; recovery under deliberate overload has not yet been verified.
- Frontend `LIVE_SEARCH_PAUSED = true` temporarily prevents submissions while Make cannot execute them. Restore this switch only after credits are restored and a bounded live test passes.

## Confirmed blockers

Make displayed: "You've used all your free credits" and "Your scenarios are paused until you upgrade or buy more credits." No billing transaction or subscription was performed. New tests were stopped. The scenario's Active switch does not override this account-wide pause.

Apify explicitly rejected a run with: "By launching this job you will exceed your limit of 5 concurrent Actor runs." Make deactivated the scenario on that unhandled error. It was reactivated, three queued requests were processed successfully, and recovery was then added. A hundred simultaneous fresh searches are not supported or proven under the present capacity limit.

## Acceptance still outstanding

- Repeat representative live searches after credits are restored; verify p95 first useful results <=15 seconds and completion <=30 seconds, including empty results.
- Verify recovery leaves the service available during overload and communicates delayed/failed searches clearly.
- Resolve scraper capacity or implement controlled queuing, then test 100 simultaneous live users. Quick Match's 100-request result does not prove this.
- Collect the previously proposed seven days of production reliability evidence. This cannot be completed on October 10.

The working borderline workflow was saved in Make version history before changes, named "Working live search before speed completion: borderline actor, 10 jobs, $0.10 cap, verified results on October 10". Restoring that version also restores its prior start-rate setting; review scheduling explicitly during rollback.

## Reproduce

`node tests/search-speed.cjs` — thirteen local regressions, all passing at the time of this report.

`node tests/search-benchmark.cjs path/to/report.json` — read-only production database benchmark.

`node tests/live-search-benchmark.cjs --production --sequential-only path/to/report.json` — paid production live verification. Do not run while Make credits are exhausted. Omit `--sequential-only` only when concurrent testing is intended and capacity is available.
