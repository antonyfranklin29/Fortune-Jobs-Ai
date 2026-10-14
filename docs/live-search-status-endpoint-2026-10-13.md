# Live Search status endpoint and explicit outcome signals

Owner: Claude (Live Search admission control). Quick Match freshness and Adzuna
activation stay with Codex. Account sign-in work is deliberately untouched.

## The problem

A scraper or workflow failure and a search that genuinely found nothing were
indistinguishable. Both wrote the same marker row —
`job_title = 'No matching jobs found'`, `match_reason = 'Search complete'`,
`match_score = 0` — and the page rendered both as "no jobs found". A visitor
whose search failed was told, incorrectly, that no jobs exist.

## The signals Make must send

In the `job_matches` row that ends a search, set `source_metadata`:

| Case | `source_metadata` |
| --- | --- |
| Search ran, with or without results | `{"signal":"success"}` |
| Workflow or scraper failed | `{"signal":"failure","stage":"apify"}` |

`stage` is free text up to 40 characters (`apify`, `claude`, `parse`, …) and is
recorded for diagnosis. **The failure row must carry the `search_id`** — failures
that lose it cannot be attributed to a search, and three such rows already exist.

Until Make sends these, nothing breaks: an unsignalled marker still releases the
slot, but it is recorded as `marker_unverified` and reported as `indeterminate`.
It is explicitly **not** counted as proof of success.

## Slot release

Every conclusive outcome now releases the concurrency slot:

| Event | Admission status | Slot |
| --- | --- | --- |
| Explicit `failure` signal | `failed`, outcome `failure:<stage>:<role>` | released |
| Explicit `success` signal | `completed`, outcome `success:<role>` | released |
| Unsignalled marker | `completed`, outcome `marker_unverified:<role>` | released |
| Partial job row | unchanged | **held** — scraper still running |
| Nothing reported at all | `expired` at the TTL | released by the backstop |

## The status endpoint

    GET https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/live-search?search_id=<id>

Replies with **only** a state and a result count. Never the query text, the
caller hash, an account id, limits or any secret:

```json
{ "state": "complete", "results": 10 }
```

| State | Meaning | What the page should show |
| --- | --- | --- |
| `pending` | Admitted, still running | Keep polling |
| `complete` | Finished with results | The results |
| `empty` | Finished, zero results, confirmed by an explicit success signal | "No jobs matched — try widening your search" |
| `failed` | Workflow or scraper reported failure, or the slot lapsed | **Retry / Quick Match. Never "no jobs found"** |
| `indeterminate` | Ended on the old unsignalled marker | Treat as failed: offer retry and Quick Match |
| `unknown` | Nothing recorded for this id | Treat as failed |
| `not_found` | Id missing or malformed | Treat as failed |

Reads are by exact `search_id` through a parameterised `SECURITY DEFINER`
function granted to `service_role` only; the browser never touches the table.
Ids shorter than 8 or longer than 80 characters are rejected without a query.

## Verified (2026-10-13, gateway version 5)

Outcome classification, in a transaction that was rolled back — no probe row and
no probe `job_matches` row persists:

| Case | Result |
| --- | --- |
| Partial rows only | `pending`, slot held |
| Explicit success with results | `complete`, slot released |
| Explicit success, zero results | `empty`, slot released |
| Explicit failure | `failed`, slot released, outcome `failure:apify:<role>` |
| Unsignalled marker, zero results | `indeterminate` — **not** `empty` — slot released |
| Unsignalled marker with results | `complete` (results are their own proof) |
| Unknown id / too-short id | `unknown` / `not_found` |

Live against the deployed endpoint:

| Probe | Result |
| --- | --- |
| Real search carrying 10 jobs | `{"state":"complete","results":10}` |
| Marker-only search, never admitted | `{"state":"unknown","results":0}` |
| Gateway search that failed | `{"state":"failed","results":0}` |
| Empty id | `{"state":"not_found","results":0}` |
| 300-character id | `{"state":"unknown","results":0}` |
| Fields in every reply | `results`, `state` — nothing else |

## Special characters — gateway only, not yet end to end

These exercise the **gateway's validation alone**. Make has not been exercised
with these inputs, so they say nothing yet about how `escapeJSON` or the Apify
actor handle them. That remains to be tested once the secrets are in place.

| Input | Gateway |
| --- | --- |
| `Senior Engineer "III"` | Accepted, reaches dispatch |
| `C:\dev engineer` | Accepted, reaches dispatch |
| Newline or tab in query | 400 `text contains control characters` |
| Whitespace-only query | 400 `text is required` |
| 200-character query | 400 `text exceeds 120 characters` |
| Quote in location | Accepted |
| Newline in location | 400 `location contains control characters` |

Quotes and backslashes are legitimate in job titles, so the gateway passes them
and relies on Make's `escapeJSON` downstream. Control characters never reach
Make at all.

## Incidental finding: Cloudflare filters the query string

Cloudflare, which fronts Supabase Edge Functions, refuses classic injection
signatures before they reach the function: `' or 1=1 --` and `1 UNION SELECT
null` are both dropped at the edge. An ordinary apostrophe or semicolon passes
through and is handled safely by the parameterised query. Useful defence in
depth, but it is Cloudflare's behaviour and not something this gateway should
rely on.

## Still pending

1. **Secrets** — `MAKE_LIVE_WEBHOOK_URL`, `MAKE_GATEWAY_SECRET`,
   `CLIENT_HASH_SALT`, `GATEWAY_TEST_KEY`. The gateway returns
   `gateway_not_configured` until the first two are set.
2. **Make must require the secret** before dispatch is enabled or the frontend is
   switched, otherwise the old webhook stays directly callable.
3. **Make must send the explicit signals** above.
4. **Frontend cutover** — prepared separately, applied only with Tony's approval.
5. No replay of the three historical incomplete executions, and no paid load
   test, without an approved spending cap.
