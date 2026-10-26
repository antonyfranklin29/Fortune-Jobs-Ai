# Make: Live Search completion signals and gateway cutover (updated 2026-10-24)

The Make scenario and database normalizer were updated on October 24; see "Applied on 2026-10-24" below. The gateway secret filter and website switch remain off. No Apify run was made and no secret was read.

## Baseline before the Make change (read only)

- **The site expects the signal on the completion marker.** `results.html` on main reads `source_metadata.signal` from the job_matches row that ends a search, and only when it is a JSON object. The gateway switch is off.
- **The database already reads signals.** The `live_search_mark_completed` trigger in production is the explicit-signal version.
- **Only `service_role` can write to `job_matches`.** Make writes as that role.
- **Make sent no signal before this update.** All 64 completion markers in the preceding 30 days had `source_metadata = null`, including one at 18:51 UTC on Oct 24.
- **Make's job rows store `source_metadata` as a JSON-encoded string, not an object.** That shows Make maps the column as text.

## The contract, proven locally

`tests/live-search-signals-db.mjs` runs on a throwaway PostgreSQL with production's `job_matches` columns and grants and the Live Search migrations, inserting as `service_role`:

| Marker `source_metadata` | Status reported |
|---|---|
| `{"signal":"success"}` as a **JSON object** | `empty`, a confirmed "no jobs" |
| The same as a **JSON string** (what Make sends today) | `indeterminate`. This is the hazard. |
| `{"signal":"failure","stage":"apify"}` as an object | `failed`, outcome `failure:apify:service_role` |
| `null` | `indeterminate` |
| Job rows, then a success marker | `complete` |

So Make must deliver an **object**, and the marker must carry the search's `search_id` (`{{1.search_id}}` from the webhook).

**Fallback, now applied:** `migrations/pending/20261027_live_search_marker_signal_normalize.sql` is a BEFORE INSERT trigger. On the completion marker row only, it converts a JSON string holding `{"signal":"success"|"failure",…}` into the object. Job rows, non-JSON text and unknown signals are left alone. The same test covers it. Applied after confirming that Make's Supabase module cannot send an object.

## Configuration checklist used for scenario 4555354 (completed for the success and Apify-failure paths)

1. **Confirm the saved escaping.** Apify module 4's Input JSON should still be the Oct 13 expression, with `escapeJSON(trim(2.result))`, `escapeJSON(1.location)` and `escapeJSON(replace(upper(ifempty(1.country; "US")); "GB"; "UK"))`. Record any difference before changing anything.
2. **Success marker.** On the module that writes the "No matching jobs found / Search complete / 0" row, set `source_metadata` to the object `{"signal":"success"}` and `search_id` to `{{1.search_id}}`. If the Supabase module only offers a text field, use the pending normalizer instead of a workaround that puts credentials into an HTTP module.
3. **Failure marker, and never both markers.** Add an error handler on the Apify module, and on the keyword step with `stage` set to that step. It writes the same marker row with `source_metadata` `{"signal":"failure","stage":"apify"}` and `search_id` `{{1.search_id}}`, then ends that bundle with a directive (Ignore or Commit) so the normal route stops.
   - The success marker must stay the last module on the normal route, after Apify and the job-row writes. Then an error anywhere before it means it is never reached.
   - Confirm in the editor that, after the handler runs, nothing downstream of the failed module runs for that bundle.
   - **Backstop, tested:** if both markers did arrive for one `search_id`, failure wins and stays. The admission stays `failed` and the late success is not recorded. The page checks for a failure row before anything else. The reverse order (a failure after the success marker) is not covered by the backstop and must be prevented by the module order above. The status endpoint would still say empty, while the page would show failed.
4. **Save, without running.** Do not use "Run once". Every Live Search run calls Apify.

## Free escaping check (no Apify)

In a **separate, temporary** scenario: Tools → Set variable `kw`, then Set variable `doc` (the module 4 Input JSON with `kw` in place of `2.result`), then JSON → Parse JSON on `doc`. Run once for each value below. It passes if Parse JSON succeeds and the parsed `keyword` equals `kw`. This costs a few Make operations and makes no Apify call. Delete the scenario afterwards.

| `kw` | Expected inside the JSON string |
|---|---|
| `Senior Engineer "III"` | `Senior Engineer \"III\"` |
| `C:\dev engineer` | `C:\\dev engineer` |
| `O'Brien \ "R&D" lead` | `O'Brien \\ \"R&D\" lead` |
| `back\\slash x2` | `back\\\\slash x2` |
| `Café ünïcode — dash` | unchanged |

Location is tested the same way, with `Newark, "NJ"`. The gateway already refuses control characters (tab, newline) before they reach Make.

## Shared-secret check: prepared, not active

The gateway sends `x-fj-gateway-secret` as a header only (function deployed). Make checks it this way:

- Webhook module 1 → advanced setting **Get request headers = Yes**. This adds the request headers to the bundle. The exact field name will be read in the editor rather than assumed.
- Live Search route filter: the existing `mode = live` **AND** the header value **equals (case sensitive)** the secret.

**Do not add it to the current webhook yet.** The public site still calls this webhook directly with no secret, so the filter would stop every Live Search. Two safe ways to activate it:

- **Recommended: a separate gateway-only webhook.**
  1. Clone the Live Search path into its own scenario, with a new webhook and the filter active from the start. Its URL is known only to the gateway.
  2. Set `MAKE_LIVE_WEBHOOK_URL` to it.
  3. Flip `LIVE_SEARCH_VIA_GATEWAY`.
  4. Then turn off the old direct route.

  Nothing breaks at any point, but the two paths must be kept in step until the old one is removed. This needs Franklin's agreement, because it creates a scenario.
- **Single webhook.** Add the filter in the same release that flips the site switch, accepting a few seconds where cached pages still post directly. Then rotate the webhook URL, since the current one is public in the page source.

## Applied on 2026-10-24 (evening)

**Make scenario 4555354, saved, still Active.** The editor was reloaded and every mapping below was re-read.

| Step | Saved configuration |
|---|---|
| Apify 4, Input JSON | Unchanged and confirmed: `{"keyword":"{{escapeJSON(trim(2.Result))}}","location":"{{escapeJSON(1.location)}}","country":"{{escapeJSON(replace(upper(ifempty(1.country; "US")); "GB"; "UK"))}}","maxItems":10,"searchMode":"basic","proxyConfig":{"useApifyProxy":true}}`. Actor `kaix~indeed-scraper`, maximum cost 0.10. |
| Supabase Create a Row, normal route (last step) | `source_metadata` changed from `get(15.Array[]; 14.index)` to `ifempty(get(15.Array[]; 14.index); {"signal":"success"})`. The completion marker is the matching Claude step's appended `{"index":0,…,"match_reason":"Search complete"}` item. Index 0 has no Apify item, so only the marker takes the success value, and job rows keep their Apify metadata. `search_id` was already `1.search_id`. |
| Apify 4, error route | **Retry removed.** It retried the paid actor 3 times, minutes apart, long after the visitor's page gave up, and could write a late success after a failure. It is replaced by Supabase Create a Row **21**: `job_title` "No matching jobs found", `match_reason` "Search complete", `match_score` 0, `search_id` `1.search_id`, `source_metadata` `{"signal":"failure","stage":"apify"}`, other fields empty. That is followed by **Skip 22**, which discards the failed bundle, so nothing downstream, including the success marker, runs for that search. |

**Database (production): the normalizer was applied**, ledger `20261025002938`. Why: Make's Create a Row module stores `source_metadata` as text, so the string `{"signal":"success"}` would otherwise read as no signal.
- A rolled-back rehearsal on production first showed a string-encoded success stored as an object with state `empty`, and a string-encoded failure with state `failed`.
- After the apply: the trigger is enabled, `anon` cannot execute it, and the release trigger is unchanged.

**Free escaping check, passed.** A throwaway scenario (6766241, now deleted) with one Parse JSON step applied `escapeJSON` to six test strings and parsed the result back. That used 1 Make operation and no Apify call. Every value round-tripped exactly.

| Input | Inside the JSON string |
|---|---|
| `Senior Engineer "III"` | `Senior Engineer \"III\"` |
| `C:\dev engineer` | `C:\\dev engineer` |
| `O'Brien \ "R&D" lead` | `O'Brien \\ \"R&D\" lead` |
| `back\\slash x2` | `back\\\\slash x2` |
| `Café ünïcode — dash` | unchanged |
| `Newark, "NJ"` | `Newark, \"NJ\"` |

**Not yet verified:** a real marker arriving in Supabase as an object. That needs one Live Search, which calls Apify. Until then the evidence is the production rehearsal of the same trigger.

## Failure routes on every step, added 2026-10-25

Saved in scenario 4555354, still Active. The editor was reloaded and each mapping re-read. Each Live Search step that can fail now has an error route: Supabase **Create a Row** into `job_matches`, then **Skip**. Skip discards the failed bundle, so nothing downstream runs for that search, including the normal success marker. Every failure row is identical apart from `stage`:
- `job_title` "No matching jobs found", `match_reason` "Search complete", `match_score` 0
- `search_id` `1.search_id` (the webhook's)
- company, location, salary and apply_url empty

| Step that fails | `source_metadata` written |
|---|---|
| Claude keyword step 2 | `{"signal":"failure","stage":"claude"}` |
| Apify run step 4 (added 2026-10-24) | `{"signal":"failure","stage":"apify"}` |
| Apify dataset step 11 | `{"signal":"failure","stage":"apify_dataset"}` |
| Claude matching step 5 | `{"signal":"failure","stage":"claude_match"}` |
| Parse JSON step 12 | `{"signal":"failure","stage":"parse"}` |

**Not covered:** the Array aggregator (15), the Iterator (14) and the final Supabase write. Aggregator and Iterator are built-in flow tools that do not raise errors on their own input. If the final Supabase write fails, a failure marker would go through the same Supabase connection and would most likely fail too, so it has no route. In those cases the search ends without a marker: the page times out, or the gateway admission expires to `failed`. It is never shown as "no jobs". The Quick Match route (lower branch) was not touched. Nothing was run in Make for this change.

## Remaining cutover steps (in order)

1. ~~Make sign-in, the success and failure markers, the escaping check~~ (done, see above).
2. ~~Failure routes on steps 2, 11, 5 and 12~~ (done 2026-10-25, see above).
3. **First real check, paid and approved separately:** one capped Live Search. Confirm in Supabase that its marker has `source_metadata` as an object with `signal=success`, and that `live_search_status` reports `complete` or `empty`. A deliberate failure test needs a way to fail Apify without a paid run, such as an invalid actor input in the test scenario. Decide this together.
4. Set the Supabase secrets `MAKE_GATEWAY_SECRET`, plus `MAKE_LIVE_WEBHOOK_URL` for the chosen webhook, without echoing them. Run a gateway dry run with `GATEWAY_TEST_KEY`.
5. Activate the Make filter by the chosen option, and flip `LIVE_SEARCH_VIA_GATEWAY = true` in `results.html`. That edit touches a shared file, so Codex coordinates it.
6. Keep the old direct route working while cached pages may still post to it, then verify. Watch for direct-webhook executions falling to zero, gateway admissions settling, and status and Make errors. Only then retire the old route and change its webhook address. Agreed with Codex: use the separate gateway-only webhook.

**Rollback:** flip the site switch back to `false` first, then remove or relax the filter.

## Live Search guard filter, added 2026-10-25 (21:40 ET, approved by Franklin)

**Finding:** the link from the router into Claude keyword step 2 had **no filter**. The "Live Search" filter (`1.mode = live`) sits on a different router link, one that ends at an empty placeholder. So any request to the webhook, including an empty body, ran the full paid route. Six empty-body executions since Oct 16 did exactly that, about 9.85 credits each, writing markers with a null `search_id`.

**Saved** on the router → Claude 2 link, label **"Live Search guard"**. The scenario was saved and is still Active. The editor was reloaded in a fresh tab and every rule re-read:
- `1.mode` *Text: Equal to* `live`
- AND `1.search_id` *Text: Matches pattern* `\S`
- AND `1.text` *Text: Matches pattern* `\S`

All three pages and the gateway always send `mode: 'live'`, a `search_id` and the query `text` to this webhook. Quick Match never calls it. So real searches pass, and empty or partial bodies stop before any paid step. Nothing was run. The placeholder route and the Quick Match route were not touched.

**Verify** on the next real Live Search: its marker arrives with its `search_id` (query in the cutover checklist, stage 0), and history shows no further empty-body run reaching Claude.
**Rollback:** delete the filter on that link.
