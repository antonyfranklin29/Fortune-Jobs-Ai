# Live Search low-cost v2 scenario (prepared, INACTIVE, not wired). 2026-10-31, Claude

**Status.** This is a new Make scenario, **6856037** "Live Search (gateway only) v2 LOW-COST - INACTIVE, not wired". It was created from the blueprint of 6798265.
- Its webhook is **unset**, so it cannot receive traffic.
- It is **Inactive**, and it has never run.
- Neither 6798265 nor 4555354 was modified. 6798265 still shows lastEdit 2026-10-30T21:39:19Z, hook 2989632, and Inactive.
- No Make or Apify run was made.

**Cutover, later and only with approval:**
1. Deactivate 6798265.
2. In 6856037, select hook 2989632 ("Live Search gateway-only hook") on module 1. The gateway URL and API-key auth therefore stay the same.
3. Run one capped test.

**Rollback:** move hook 2989632 back to 6798265.

## Why the old run cost 45.5 credits

- Module 5 (Claude ranking) received `{{15.array}}`. That is the full Apify objects: company 1.4–3.5 KB, classification 1.8–4.7 KB, urls, meta and so on.
- The stored `source_metadata` of these rows is 5.4–10.6 KB per listing, so about 75 KB of prompt for 10 listings.
- `snippet` is only ~200 chars; the bulk is non-descriptive metadata.

## Before and after, by module

| Module | Before (6798265) | After (6856037) |
|---|---|---|
| 1 Webhook | hook 2989632 | hook **null** (unwired) |
| 15 Array aggregator (feeder 11) | id, meta, urls, dates, title, salary, company, snippet, location, requirements, classification, workArrangement | Same fields, **plus `brief`** = `{{11.title.text}} \| {{11.company.name}} \| {{11.location.formatted}} \| {{ifempty(11.salary.text; "salary n/a")}} \| posted {{ifempty(11.dates.posted; "unknown")}} \| {{substring(replace(ifempty(11.snippet; ""); newline; " "); 0; 300)}}` |
| 5 Claude ranking | claude-haiku-4-5, max_tokens **4000**, prompt ends `Listings: {{15.array}}` | claude-haiku-4-5, max_tokens **800**. Same rules text. Prompt now ends `Listings follow, one per line in order; line 1 is index 1, line 2 is index 2, and so on. Each line is: title \| company \| location \| salary \| posted date \| summary.{{newline}}{{join(map(15.array; "brief"); newline)}}` |
| 12 Parse JSON, 14 Iterator | unchanged | unchanged |
| 28 Supabase Create a Row (1 op per row) | one row per iterator bundle | **removed**, replaced by 41 → 42 → 43 |
| 41 Array aggregator (feeder 14) | — | Same nine field mappings as old 28: job_title, company, location, salary, apply_url, search_id = `{{1.search_id}}`, match_score, match_reason, source_metadata. It has a **filter** (see below). |
| 42 JSON Transform to JSON | — | object `{{41.array}}` |
| 43 Supabase Make an API Call | — | connection 8084217 (same as old 28), `POST /rest/v1/job_matches`, headers `Content-Type: application/json`, `Prefer: return=minimal`, body `{{42.json}}` |
| 44 + 45 error route on 43 | — | single Create a Row failure marker with `{"signal":"failure","stage":"bulk_insert"}`, then Ignore. This copies the existing error-route pattern of 31/33/35/37/39. |

Unchanged: the Live Search guard filter, modules 2, 4 (`maxTotalChargeUsd` 0.10), 11, all existing error routes, and the Quick Match branch.

**Stale filter on module 41.** A bundle passes if *any* of these holds:
1. `14.index = 0`. That is the completion marker, which is always kept.
2. The source `dates.posted` does not exist. An unknown date is kept, not guessed.
3. `parseDate(dates.posted; "YYYY-MM-DD") >= addDays(now; -30)`.

If every job is stale, only the marker is written. `live_search_status` then reports `empty` (success marker with 0 jobs), not a failure.

## Bulk insert safety review

- **Trusted completion marker kept.**
  - The marker row is identical to before: job_title "No matching jobs found", reason "Search complete", score 0, `source_metadata` = the JSON *string* `{"signal":"success"}`.
  - The BEFORE INSERT trigger `live_search_normalize_marker_signal` turns that string into an object. The AFTER INSERT row trigger `live_search_mark_completed` then settles the admission as `success:<role>`.
  - Both triggers are `FOR EACH ROW`, so they fire for every row of a multi-row insert.
- **Per-search isolation kept.** Every row carries `{{1.search_id}}` exactly as before. A single POST holds only this execution's rows.
- **Atomicity is better than before.**
  - The bulk insert is one statement. Either all rows, marker included, land or none do.
  - On failure, module 44 writes a conclusive failure marker and the slot is released as failed.
  - Before, a mid-loop Create Row error left partial rows and no marker, so the search waited for the TTL.
- **Role.** The `success:service_role` outcome is from the Oct 31 run, which used Create a Row on connection 8084217. Module 43 uses the same connection, so the outcome should stay `success:service_role`; this is unverified (see assumptions).

## Expected cost (not measured)

Webhook 1 + module 2 1 + Apify 1 + dataset 1 + module 15 1 + **module 5 ≈ 2–4** + module 12 1 + module 14 1 + modules 41/42/43 3 ≈ **12–14 credits**, down from 45.5. The module 5 estimate assumes token-proportional billing: ~75 KB of input before, ~4 KB after.

## Unverified assumptions (check in the capped test)

1. **`map(15.array; "brief")` and `join(...; newline)`** render as one line per listing in aggregator order.
2. The `brief` lines carry no explicit index. **Claude is told line N = index N.** Module 28's old `get(15.array; 14.index)` lookup still depends on that.
3. **The Make module 43 refusal path is unknown.** If it does not raise an error on an HTTP 4xx/5xx and only returns `statusCode`, the failure marker will not fire. The search would then end as `failed` through the TTL, not immediately.
4. **Job-row `source_metadata` type changes.** Before, it was a JSON *string* (Create a Row maps it as text). Through Transform to JSON it becomes a JSON *object*.
   - `search-accuracy.js`, `company-logos.js` and `resume-matching.js` accept both forms; their tests cover string and object.
   - `results.html` `searchSignal()` (line 808) reads `signal` only from an object, so job-row objects without `signal` read as no signal, the same as before.
5. **`source_metadata` gains the `brief` key** (~400 chars). It is harmless and is not named `signal`.
6. **`dates.posted` reliability.** On Indeed it is the posting date that kaix returns. Whether a repost resets it is unverified. On Oct 31, 6 of 10 listings were older than 30 days, so the filter can cut results to a handful. Consider 45 days if that is too aggressive.
7. **Module 41 filter operators.** `number:equal`, `notexist` and `date:greaterorequal` are written by hand in the blueprint. Make accepted the blueprint, and the scenario renders without module errors other than the unset webhook. They have not been executed.

## Separate security finding (for the security owner)

`job_matches` has the RLS policy "pipeline can insert job matches", INSERT with check `true` for roles `anon` and `authenticated`.
- Anyone holding the public anon key can insert rows for any `search_id`, including forged `signal` success/failure markers and job rows with arbitrary `apply_url`.
- `search_id` values are unguessable, which limits targeting. The policy should still probably be restricted to the service role, since the pipeline uses `success:service_role`.
- Not changed.

## Capped v2 test, 2026-11-01 (approved by Franklin)

**Wiring.**
- Make allows a webhook in only one scenario, so v2 got its own hook: **3008463 "Live Search v2 low-cost hook"**. It uses the same API-key keychain, "Franklin's Webhook API Key Auth key".
- Franklin pasted its URL into `MAKE_LIVE_WEBHOOK_URL`. The digest now starts `f7e14e6c` (updated Nov 1 04:49 UTC).
- 6798265 is unchanged: Inactive, still on hook 2989632.
- **Rollback:** put the old hook URL back into `MAKE_LIVE_WEBHOOK_URL` (digest `770372c7`).

**Run.**
- v2 was activated at 00:50:07 ET.
- One gateway POST was sent ("data analyst", mode live). It returned **202**, search `s_mvxcqfd5_34515051183d`, `queued_ms` 451.
- v2 was deactivated right after and is now **Inactive**.

**Make run `a0ba084ea71e4a6cabe2adeb554e64c8`: Success in 5 s, 11 operations, 14.05 credits** (was 45.5).

| Module | Credits |
|---|---|
| Webhook, Claude parse (2), Apify run (4), dataset (11), aggregator (15) | 1 each = 5 |
| **Claude ranking (5), trimmed input, max_tokens 800** | **3.89** (was 28.34) |
| Parse JSON (12), Iterator (14) | 2 |
| Aggregator (41), Transform to JSON (42), Supabase API call (43) | 3 (was 10 Create Row ops) |

**Apify:** 10 results, $0.00 shown, 1 s runtime. The cap is unchanged at $0.10.

**Stale filter:** 11 bundles reached module 41 (10 ranked jobs plus the marker). **7 passed and 4 were dropped as older than 30 days.** Every stored job was posted between 2026-10-13 and 2026-10-30.

**Database:**
- The admission is `completed` / `success:service_role`, settled 04:50:40 UTC.
- **7 rows:** 6 jobs and 1 marker.
  - The marker is `source_metadata` object `{"signal":"success"}`.
  - The job rows hold `source_metadata` as JSON **objects**. They include `brief`, and none has `signal`.
- **Index mapping verified:** for every job row, `job_title` and `company` equal the `title.text` and `company.name` of the listing stored in its own `source_metadata`.

**Validation results:**
- Assumptions 1, 2, 4, 5 and 7 are confirmed.
- Assumption 3 (does module 43 raise on a 4xx/5xx?) is not exercised; it needs a separate negative test.
- Assumption 6: the 30-day window removed 4 of 10 listings. Whether to use 45 days is a product decision.

**Still to do before launch:** the site switch and gateway quota (Codex), and a decision on whether to keep v2 wired. v2 is inactive now.
