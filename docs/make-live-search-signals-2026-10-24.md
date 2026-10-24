# Make: Live Search completion signals, escaping check and secret filter (prepared 2026-10-24)

Branch `claude/make-completion-signals`, based on main 822c46a. **Make itself has not been changed yet**: the Make session in Chrome was signed out. Everything below was prepared and tested locally or read-only. No Apify run was made and no secret was read.

## What production shows (read only)

- **The site expects the signal on the completion marker.** `results.html` on main reads `source_metadata.signal` from the job_matches row that ends a search, and only when it is a JSON object. The gateway switch is off.
- **The database already reads signals.** The `live_search_mark_completed` trigger in production is the explicit-signal version.
- **Only `service_role` can write to `job_matches`.** Make writes as that role.
- **Make sends no signal today.** All 64 completion markers in the last 30 days have `source_metadata = null`, including one at 18:51 UTC on Oct 24.
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

**Fallback, pending and not applied:** `migrations/pending/20261027_live_search_marker_signal_normalize.sql` is a BEFORE INSERT trigger. On the completion marker row only, it converts a JSON string holding `{"signal":"success"|"failure",…}` into the object. Job rows, non-JSON text and unknown signals are left alone. The same test covers it. Apply it only if Make's Supabase module cannot send an object, and only with approval.

## Changes to make in scenario 4555354 (once signed in)

1. **Confirm the saved escaping.** Apify module 4's Input JSON should still be the Oct 13 expression, with `escapeJSON(trim(2.result))`, `escapeJSON(1.location)` and `escapeJSON(replace(upper(ifempty(1.country; "US")); "GB"; "UK"))`. Record any difference before changing anything.
2. **Success marker.** On the module that writes the "No matching jobs found / Search complete / 0" row, set `source_metadata` to the object `{"signal":"success"}` and `search_id` to `{{1.search_id}}`. If the Supabase module only offers a text field, use the pending normalizer instead of a workaround that puts credentials into an HTTP module.
3. **Failure marker.** Add an error handler on the Apify module (and on the keyword step, `stage` set to the module name). It writes the same marker row with `source_metadata` `{"signal":"failure","stage":"apify"}` and `search_id` `{{1.search_id}}`, then Ignores, so the error does not also mark the run incomplete.
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

## Remaining cutover steps (in order)

1. Franklin signs in to Make in Chrome.
2. Claude confirms the escaping, adds the success and failure markers, saves, and runs the free escaping check.
3. **First real check, paid and approved separately:** one capped Live Search. Confirm in Supabase that its marker has `source_metadata` as an object with `signal=success`, and that `live_search_status` reports `complete` or `empty`. A deliberate failure test needs a way to fail Apify without a paid run, such as an invalid actor input in the test scenario. Decide this together.
4. Set the Supabase secrets `MAKE_GATEWAY_SECRET`, plus `MAKE_LIVE_WEBHOOK_URL` for the chosen webhook, without echoing them. Run a gateway dry run with `GATEWAY_TEST_KEY`.
5. Activate the Make filter by the chosen option, and flip `LIVE_SEARCH_VIA_GATEWAY = true` in `results.html`. That edit touches a shared file, so Codex coordinates it.
6. Retire or rotate the direct webhook. Watch admissions, status and Make errors.

**Rollback:** flip the site switch back to `false` first, then remove or relax the filter.
