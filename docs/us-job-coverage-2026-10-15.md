# U.S. state-by-role job coverage — diagnosis, build and baseline

Owner: Claude, per `docs/claude-priority-us-job-coverage-2026-10-15.md`.
Measured against production on 2026-10-15 at 04:25 UTC.

**Status: the ingestion system is built and tested; coverage is not achieved.
No cell of the 1,326 meets the target. The blocker is source access, not code.**

## 1. The NC / SC Data Analyst defect

The shortage is **catalogue supply**, not query logic.

| Measure | North Carolina | South Carolina |
| --- | --- | --- |
| Candidates returned by the exact production Quick Match query | 13 | 4 |
| Genuine Data Analyst listings among them | **3** (all Charlotte) | **0** |
| Others (correctly *not* shown) | Data Engineers ×6, Data Scientist, Cybersecurity Analyst ×2, Business Analyst | Business Analyst ×3, BI & Data Analytics Developer |

An early raw count reported one SC Data Analyst. That row is "BI & Data
Analytics Developer" — a developer role. The reviewed classifier rejects it, so
SC has none.

The query path itself is sound and was ruled out cause by cause:

- **Scope.** The statewide filter matches both stored formats ("City, North
  Carolina, USA" and "City, NC"): Raleigh, Cary, Charlotte and Fayetteville all
  come back. No SC row appears in an NC search or vice versa.
- **Filtering before the limit.** The state and role filters are applied
  server-side *before* the 300-row candidate cap.
- **Relaxed fallback.** `quickMatchUrl` has a `relaxed` parameter, but it is
  always called with `false`; there is no silent cross-state padding.
- **Display.** Ten-card free allowance unchanged; not the cause.

The catalogue explains everything: **657 rows for the entire United States, all
written in a single 25-minute window on 2026-10-08, nothing since.** Data Analyst
has 44 rows nationwide; the target for that role alone is 5,100.

Scaling risk noted, not yet biting: the candidate query has `limit=300` with no
`order=`. With a catalogue thousands of rows deep, an unordered cap could drop
the best candidates. Fix when the catalogue grows: order by `posted_at desc` or
query on the new `canonical_role` / `state_code` columns. That is an
`index.html` change, so it goes through Codex.

## 2. Sources and cost — verified before building

**Adzuna** is the only approved candidate with a usable path.
[Terms](https://developer.adzuna.com/docs/terms_of_service) confirmed today:

- Publishing listings on a job site is a permitted use, **with a per-advert
  "Adzuna" label (min. 116×23 px) hyperlinked to Adzuna**. The cards do not yet
  carry this; it is required before any Adzuna listing is shown.
- Default allowance, all applying together: **25/minute, 250/day, 1,000/week,
  2,500/month.** Higher limits only by partner agreement.
- On termination, all Adzuna data must be removed from the site.
- **Status: no credentials exist. Activation is still pending.**

**What the free allowance can and cannot buy** (50 results per request; a cell's
full sweep is 3 requests, a daily incremental refresh is 1, with a full re-sweep
every 6 days — about 40 requests per cell per month):

| Scope | Initial fill | Steady state | Fits free tier? |
| --- | --- | --- | --- |
| Data Analyst × 51 regions | 153 requests | ≈ 2,040 / month | **Yes**, using ~82% of it |
| All 26 roles × 51 regions | 3,978 requests | ≈ 53,000 / month | **No — about 21× over** |

So: one role nationwide is achievable once Adzuna activates. Every role requires a
partner agreement, or a much slower refresh than "current" implies.

**Not acceptable as ingestion sources**, recorded so nobody reaches for them:

- *Apify Indeed scraper* (already wired into Live Search): works, but a working
  scraper is not a redistribution right. Indeed's terms do not permit it, and
  the doc rules it out.
- *Dice / Indeed / ZipRecruiter MCP tools available to me*: assistant-side
  tools, not a licensed feed. Used today **for measurement only**.
- *Careerjet*: requires the real visitor's IP and user-agent per call; not a
  background-harvesting endpoint.
- *Jooble*: 500 requests lifetime per key.

**Is 100 even achievable?** Dice's own counts are not usable: it treats "North
Carolina" as a point with a 30-mile radius *and* mixes in remote jobs (its first
NC results were Virginia Beach and West Palm Beach). Its facets put roughly 60
Data Analyst-keyword listings near NC's centroid and 13 near SC's, before
removing other titles. Honest expectation: **NC can plausibly reach 100 across
sources; SC very likely cannot**, and should be reported as a genuine market
shortage rather than padded. Adzuna's own counts will settle it once active.

The Dice finding shapes the design: statewide collection must query by
*administrative region* (Adzuna's `location1`) and then verify the state from
each listing — never trust a radius search.

## 3. What was built

All additive. Quick Match keeps working unchanged; the anon read grant on
`pre_scraped_jobs` is unchanged except that listings the worker has *positively
confirmed closed* are now hidden.

**One taxonomy, two runtimes.** `config/job-roles.json` defines 26 canonical
roles with include/exclude title patterns; `config/us-regions.json` holds the 50
states plus DC as a separate region. `scripts/build-ingest-sql.cjs` generates
both the worker's embedded config and the SQL classifier from them, so the
database and the worker cannot drift. Parity was checked on the same titles and
locations in both. Autocomplete's 2,340 suggestions map onto these roles rather
than becoming 2,340 × 51 scrape targets.

**Only Data Analyst is reviewed.** The other 25 roles are marked `initial` and
must not be reported as covered. Two real gaps already found: "BI & Data
Analytics Developer" and "Quality Engineer" match no role.

**Database** (`migrations/20261015_ingest_taxonomy.sql`,
`migrations/20261015_ingest_catalogue.sql`, applied):

- Provenance on the catalogue: `canonical_role`, `state_code`,
  `source_listing_id`, `source_url`, `attribution`, `fetched_at`,
  `last_seen_at`, `closed_at`. Unique `(source, source_listing_id)` alongside the
  existing unique `apply_url`.
- `ingest_upsert_jobs` — the only write path. Re-validates every row regardless
  of what the worker checked: https URL, known region, known role, a title the
  taxonomy actually assigns to that role, no future date. A repost collapses to
  one row with the newer date; a missing date never erases a known one.
- `ingest_close_unseen` — closes only after a *complete* enumeration of a cell,
  and refuses a sweep timestamp older than six hours.
- `ingest_budget_used` — requests spent per minute/day/week/month, summed across
  runs, so the provider's allowance holds even across separate invocations.
- `ingest_runs`, `ingest_cells` — run log and per-cell checkpoints (last
  success, last failure, consecutive failures, next due, last full sweep).
- `ingest_coverage` — the report view.
- Legacy rows backfilled from their own title and location. Their
  `last_seen_at` is their original scrape time, the honest value.

**Effective privileges verified with `has_*_privilege`**, not by reading ACLs:
every new table, view and function is service-role only; anon and authenticated
can write nothing; visitors' read access is exactly what it was.

**Worker** (`supabase/functions/job-ingest/`): config-driven role × region
plan, aimed at the largest shortfalls first; bounded pages per cell; a hard cap
of 50 requests per run *and* the provider allowance; exponential backoff with
jitter on 429/5xx; one run at a time; per-cell checkpoints; `dry_run` with a
fixture writes nothing. Credentials are server secrets, never logged or
returned. No résumé, identity or search history is ever sent to a source.

**A flaw caught during testing and fixed.** A daily one-page refresh only
re-sees the newest 50 listings, while eligibility requires a listing to have
been seen within 7 days — so a state with 120 open jobs would have silently lost
its older 70 from the count. The planner now forces a full re-sweep every 6
days, inside the 7-day window.

## 4. Tests

`npm test` — 17 unit tests in `tests/job-ingest.mjs`, all passing:
real production aliases accepted; neighbouring roles rejected rather than
padded; state from listing evidence only; "Carolina", "Washington, USA" and
"Remote" never guessed into a state; NC/SC isolation in both directions; no
invented salary, company or date; future dates rejected; tracking-URL and
repost de-duplication; invalid URLs rejected; eligibility windows; budget
planning, quota exhaustion and deferral; full re-sweep scheduling; backoff.

`npm run test:ingest-worker` — 9 end-to-end scenarios driving the real worker
against an in-memory Supabase and a fake Adzuna market (120 NC Data Analysts,
15 NC Data Engineers, 37 SC Data Analysts, SC rows leaking into NC responses,
injected 429s and 500s):

| Scenario | Result |
| --- | --- |
| Wrong secret | 401 |
| No Adzuna credentials | `blocked`, recorded, catalogue untouched, zero source calls |
| Dry run with fixture | nothing written, no run row |
| First live run | NC 120 (passes), **SC 37 reported as a genuine 63 shortage**; exactly 5 requests (NC 3 pages, SC 1 page + 1 retry; SC pages 2–3 skipped once enumerated); leaked SC rows rejected; no Data Engineers kept; tracking stripped |
| Later refresh | 10 genuinely newer listings added; **nothing closed from a partial view** |
| Periodic full sweep | exactly the 20 removed listings closed; 110 remain |
| Source outage (3× HTTP 500) | run `failed`, **nothing purged**, failure recorded on the cell |
| Allowance exhausted | `blocked`, zero source calls |
| Overlapping run | 409 |

**Mutation-tested**: disabling the complete-enumeration guard fails 2 tests;
disabling the state-evidence check fails 1. The tests can catch the failures
they exist to catch.

The database write path was separately exercised in production inside a
rolled-back transaction: 3 inserted, 4 rejected (off-role, `javascript:` URL,
unknown region, future date), repost collapsed with the newer date, missing date
did not erase, stale sweep refused.

## 5. Coverage baseline (production, 2026-10-15 04:25 UTC)

| Measure | Value |
| --- | --- |
| Cells (26 roles × 50 states + DC) | 1,326 |
| **Cells passing (≥100 fresh distinct)** | **0** |
| Empty cells | 1,122 |
| Best cell | 10 |
| Total shortage | 132,221 listings |
| Catalogue rows with no attributable state | 63 |
| Catalogue rows matching no role | 102 |
| Last successful automated refresh | never |

Data Analyst, every region with any coverage (all others are 0):

| Region | Fresh distinct | Shortage | Newest | Oldest |
| --- | --- | --- | --- | --- |
| FL | 6 | 94 | 2026-10-08 | 2026-10-06 |
| MN | 4 | 96 | 2026-10-07 | 2026-10-01 |
| CA, **NC**, NJ, VA | 3 each | 97 | 2026-10-08 | — |
| DC, IL, PA | 2 each | 98 | 2026-10-08 | — |
| IN, KS, KY, MA, NY, TX, WA | 1 each | 99 | — | — |
| **SC** and 34 others | **0** | 100 | — | — |

**Every one of these counts drops to zero at about 13:00 UTC today.** The legacy
rows were last seen 2026-10-08 and fall outside the 7-day window then. That is
correct: nothing has re-confirmed them. The full matrix is live in
`ingest_coverage`; `scripts/coverage-report.sql` prints it.

User-visible counts are separate from this: Quick Match still shows at most ten
free cards, and the catalogue counts above are what sits behind them.

## 6. Update 2026-10-15 evening — nationwide IT feed (Tony: "entire USA IT jobs first")

**Adzuna access (from the activation email, account `fortunejobsai`):** free
"Pending Activation" plan = 25 calls total; "API access" = £8/month for 500
calls/day, 5,000/month. Support: api-partnerships@adzuna.com. The developer
terms still say commercial use is "subject to a 14 day trial period" after which
"a licence agreement may be required" — written confirmation from Adzuna that
the £8 plan covers public display on a commercial site is still needed.

**Why a feed:** keeping 18 IT roles × 51 regions (918 cells) fresh one cell at a
time costs ~36,000 calls/month, about 7× the £8 plan. The feed asks for every
U.S. listing in Adzuna's IT category (`category=it-jobs`, 30-day window, newest
first); each call returns up to 50 listings from anywhere in the country, which
are classified into role (title, same first-match rule as the database) and
state (the listing's own location). Titles outside the 18 roles are rejected
(`no_role`, `out_of_scope`), never padded in.

**How it stays current:** each run (1) reads the newest pages until it reaches
listings already seen, then (2) resumes a full pass of the window from a stored
cursor (`ingest_feeds`), shifted for new postings with one page of overlap.
When a pass completes, feed rows the pass never saw are closed — only rows the
feed ingested, and the database refuses to close more than 40% at once. A page
that comes back empty while Adzuna still reports more results is treated as a
truncation: nothing is closed and the pass restarts. Feed rows count as current
for 30 days after their last sighting (cell rows still need 7), because a full
pass can take longer than a week on this plan.

**Known limits:** IT jobs that Adzuna files under another category are missed
by the feed (cell mode can top up short cells); the 17 non-Data-Analyst IT role
patterns are first-draft (`initial`) and need review against real feed titles;
software-engineer gained common stack titles (Java/.NET/Python/Front-end…
Developer/Engineer, excluding sales/support/QA) and ML gained "AI Engineer".

**Applied in production:** `ingest_feed` column, `ingest_feeds`,
`ingest_close_feed_unseen`, feed-aware `ingest_upsert_jobs` and coverage view,
updated classifier. All service-role only (verified with has_*_privilege); feed
write and close paths verified in a rolled-back transaction.

**Tests:** 24 unit + 15 end-to-end (6 new feed scenarios: dry run, checkpointed
first pass, head + resumed pass with nothing skipped, next pass retiring exactly
the removed listings and only feed rows, truncation, mass-close refusal).
Mutation checks: treating truncation as complete, skipping a page on resume,
dropping the role-scope check and freezing the watermark each fail a test.

**First live test (after deploy):** `{"mode":"feed","budget":5}` — 5 of the 25
free calls, up to 250 real U.S. IT listings.

## 7. Blockers and next steps

1. **Adzuna activation** — the gate for everything below. Then set
   `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` and `INGEST_SECRET` as Edge Function
   secrets. Owner action; I do not handle credentials.
2. **Deploy from the repository**, so production runs the exact tested code:
   `supabase functions deploy job-ingest --no-verify-jwt`. Not hand-deployed
   tonight because the available path would mean re-typing ~34 KB, and the
   worker is inert without the secrets anyway.
3. **Bounded production pilot**: Data Analyst × NC and SC only,
   `{"roles":["data-analyst"],"regions":["NC","SC"],"budget":6}` — at most 6 of
   the 250 daily requests. Then the same request again the next day, to
   demonstrate an automated refresh adding newer data.
4. **Schedule** — `migrations/pending/20261015_ingest_schedule.sql`, hourly at a
   10-request bound for Data Analyst across all regions. Apply only after 1–3.
5. **Attribution on cards** — Adzuna's per-advert label must appear before any
   Adzuna listing is shown. A card change, so via Codex.
6. **Decision needed: scope beyond one role.** All 26 roles need about 21× the
   free allowance. Options: an Adzuna partner agreement; fewer roles; or a
   slower refresh that would not honestly meet "current".
7. **Review the other 25 roles' aliases** before reporting any of them.
8. **Add `order=posted_at.desc`** to the Quick Match candidate query once the
   catalogue grows (Codex, `index.html`).

Not touched: Google auth, newsletter files, Resend, payments, `index.html` and
the generated pages.
