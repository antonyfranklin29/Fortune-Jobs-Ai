# Live Search admission gateway — deployed state and pending cutover

Owner of this area: Claude. Quick Match catalogue, refresh ingestion and regional
coverage stay with Codex; nothing in this change touches that pipeline. No shared
frontend file has been modified.

## What is deployed

Supabase Edge Function `live-search` (ACTIVE, **version 3**, `verify_jwt: false`).
`verify_jwt` is off because the product supports searching without an account;
the function performs its own validation and never trusts client-supplied
identity for authorisation.

    POST https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/live-search

Database objects (applied to production):

| Object | Purpose |
| --- | --- |
| `live_search_admissions` | One row per admitted search; holds the concurrency slot |
| `live_search_limits` | Operator-tunable limits, changeable without redeploying |
| `live_search_try_admit()` | Atomic admission decision under an advisory lock |
| `live_search_settle()` | Releases a slot on a conclusive finish or failure |
| `live_search_mark_completed()` | Trigger function: settles an admission when results land |
| `live_search_release_slot` | `AFTER INSERT ON job_matches` trigger that calls it |

Both tables have RLS on and **no** grants for `anon` or `authenticated`. Only
`service_role` reaches them. No existing table permission was altered.

## Controls

- **Validation** — POST only, body read with a hard 8 KB streaming cap (an
  oversized body is aborted, never buffered), `text` required and bounded by
  `max_query_chars`, `mode` must be `live`, filters restricted to a known list and
  length-checked, control characters rejected everywhere.
- **Configuration safety** — the limits row is parsed strictly. A missing, partial
  or non-numeric field makes the gateway return 503 `config_unavailable` rather
  than letting a field become `NaN` and silently disable a limit.
- **Caller identity** — salted SHA-256 of the client IP. The raw IP is never
  stored. `CLIENT_HASH_SALT` is preferred; with no salt set the gateway derives
  one from the service key (secret, stable, unguessable). There is no hardcoded
  default any more.
- **Rate limits** — per caller per minute / hour / day.
- **Concurrency** — `max_concurrent` slots, claimed atomically so two requests can
  never take the last one.
- **Cost bounds** — global hourly and daily caps protect the paid scraping budget.
- **Queueing** — a request blocked only by concurrency waits up to `queue_wait_ms`
  for a slot, then sheds with `Retry-After`.
- **Slot lifetime** — a slot is released when the backend *actually reports
  results* (the `job_matches` trigger settles the admission), or on a conclusive
  upstream refusal. `slot_seconds` is now only a backstop for a search that never
  reports at all.
- **Ambiguous dispatch** — if the call to Make times out, Make may already have
  accepted the job. The gateway therefore **keeps the slot held**, marks the row
  `dispatched` / `dispatch_unconfirmed`, and returns 202 with `unconfirmed: true`
  instead of freeing capacity and permitting duplicate scraping.
- **Database calls** — every gateway→Postgres call is bounded at 5s; upstream
  dispatch aborts at 10s.
- **Kill switch** — `paused = true` stops all Live Search while leaving Quick Match
  untouched.

Current values: concurrency 3, caller 2/min, 10/hour, 25/day, global 60/hour,
150/day, slot **300s** (backstop only), queue wait 6s.

## Trusted client IP

Cloudflare fronts Supabase Edge Functions and sets `cf-connecting-ip` itself,
overwriting whatever the caller sends, so the gateway reads that header first. An
earlier probe on this same deployment measured the forwarding behaviour directly:
a caller-supplied sentinel did **not** survive (`caller_sentinel_survived: false`),
and `x-forwarded-for` arrived as `[client, client, infra-hop]`.

That shape matters. The last `x-forwarded-for` entry is shared infrastructure and
varied between runs (`3.2.x.x`, then `99.82.x.x`), so keying limits on it would
make them either useless or collectively punishing. The fallback therefore uses
the **first** entry, and only when `cf-connecting-ip` is absent.

## Search-ID isolation

The gateway mints the `search_id`. Clients can no longer choose or forge one, so a
visitor cannot guess another visitor's id or collide with it. This strengthens the
existing per-search filtering rather than replacing it.

## Preserved search filters

`location_scope` (guest résumé regional searches), `latitude` and `longitude` are
accepted and forwarded. Coordinates arrive as numbers from the city picker and as
strings when a search is restored from URL parameters; both are accepted, range
checked (±90 / ±180) and passed through as numbers. An absent or empty value is
skipped rather than rejected, which is what the page sends when no city is picked.

## Verification A — Codex review points (2026-10-13, version 3)

Reported separately from the synthetic admission tests below.

| Review point | How it was checked | Result |
| --- | --- | --- |
| 1. Hold the slot until confirmed completion/failure | Admitted a search, inserted a real `job_matches` row, re-counted in-flight | Slot held while in flight; on real results the row became `completed` / `results_received` and in-flight dropped to 0 |
| 2. Treat a dispatch timeout as ambiguous | Filled all 3 slots, set each to `dispatched` / `dispatch_unconfirmed`, then attempted a 4th admission | Unconfirmed rows still counted as in-flight (3/3); 4th request refused `at_capacity` — capacity is not freed and no duplicate is permitted |
| 3. Preserve existing filters | Posted the page's real regional payload with `location_scope: region` and coordinates, as numbers and as strings | Both accepted through validation; bad scope, out-of-range latitude and non-numeric longitude each rejected 400 with a specific reason |
| 4. Verify the trusted client-IP mechanism | `cf-connecting-ip` adopted on the measured evidence above; two consecutive live requests compared | Same caller produced an identical `client_hash`. **Residual gap below.** |
| 5. Remove the default `CLIENT_HASH_SALT` | Hardcoded default deleted; secret-derived fallback added | Live requests reached admission and returned `gateway_not_configured`, not `gateway_misconfigured`, so hashing works with no salt set |
| 6. Validate config, bound DB calls and body reading | Strict `parseLimits`, 5s DB timeout, streaming 8 KB body cap | Oversized body 413 before parsing; malformed JSON 400; config parsed and admission ran |
| 7. Finish secret enforcement in Make | Not attempted | **Blocked** — see Pending |

Behavioural tests 1 and 2 were run inside a transaction and rolled back; no probe
row or probe `job_matches` row persists, and in-flight returned to 0.

### Residual gap on point 4

Re-running a forged-header request in this session was not possible. Both the
cloud container and the linked computer's shell sit behind an egress allowlist
that refuses `supabase.co` (`CONNECT tunnel failed, 403`), and the server-side
probe that would have sent forged headers was blocked by this session's
permission guard. The mechanism rests on the earlier direct measurement plus the
fact that browsers cannot set `cf-connecting-ip` or `x-forwarded-for` at all.
A single forged-header `curl` from any ordinary network would close this; it needs
to be run from outside these restricted shells.

### Note on salt rotation

Removing the hardcoded default changed the derived salt, so caller hash buckets
changed once (observed: `7941…` before, `1889…` after). Setting an explicit
`CLIENT_HASH_SALT` will change them once more. The only effect is that per-caller
counters reset at that moment; limits and concurrency are unaffected.

## Verification B — synthetic admission tests (2026-10-13)

| Check | Result |
| --- | --- |
| 8 malformed request shapes | All rejected 400 with specific reasons |
| Oversized body | 413 before parsing |
| Wrong method | 405 |
| Caller rate limit | 2 admitted, further attempts 429 |
| Saturation (3 slots held, 4 concurrent callers) | All shed 503 `at_capacity`, `Retry-After: 15` |
| `Retry-After` readable by browser JS | Yes, after adding `access-control-expose-headers` |
| Recovery after slots lapsed | Next request admitted |
| Slot reclaim | Expired holders auto-released |
| Credits spent | None — no request reached Make |

Known limitation: the queue budget is soft. Under contention one request waited
10.5s against a 6s budget because admission attempts serialise on the advisory
lock. Bounded, but not a hard ceiling. Worth revisiting if concurrency is raised.

## Website state

`index.html` and the generated pages are unchanged, so the live site still calls
the Make webhook directly and continues to work exactly as before. The gateway is
deployed alongside it and is not yet in the user path.

## Pending — needs the owner

### 1. Secrets (Supabase dashboard → Edge Functions → Secrets)

| Secret | Value |
| --- | --- |
| `MAKE_LIVE_WEBHOOK_URL` | The Make Live Search webhook URL |
| `MAKE_GATEWAY_SECRET` | A new random string you generate |
| `CLIENT_HASH_SALT` | Optional but preferred; a new random string |
| `GATEWAY_TEST_KEY` | A new random string; enables free dry-run load testing |

Until `MAKE_LIVE_WEBHOOK_URL` and `MAKE_GATEWAY_SECRET` are set, the gateway
admits correctly and then returns 503 `gateway_not_configured` instead of
dispatching. That is the current live behaviour.

### 2. Make scenario must require the secret — blocked

Until this is done the old webhook is still directly callable and the gateway can
be bypassed. In the Make scenario, immediately after the Webhook module add a
filter that only continues when `gateway_secret` equals `MAKE_GATEWAY_SECRET`.
Rotating the webhook URL afterwards closes it completely, since only the gateway
would know the new one.

This is blocked here: Make is signed out and credentials are not handled from this
session. It has to be done by the owner, and it must be done **before** the
frontend cutover, otherwise the bypass stays open while the gateway is live.

### 3. Frontend cutover (shared files — needs coordination with Codex)

`index.html` is the single source; `find-jobs.html`, `results.html` and
`about.html` are generated from it by `scripts/build-search-pages.cjs`.

Replace the direct webhook call (around line 1085) with a call to the gateway.
The important behavioural change: the gateway returns the `search_id`, so the
client must await the response before polling instead of firing and forgetting.

```js
const LIVE_SEARCH_GATEWAY =
  'https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/live-search';

showLoading(mode);
let admitted;
try {
  const res = await fetch(LIVE_SEARCH_GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: input, mode: 'live', ...filters, ...accountPayload() }),
    signal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS)
  });
  admitted = await res.json().catch(() => ({}));
  if (res.status !== 202 || !admitted.search_id) {
    hideLoading();
    showLiveSearchUnavailable(admitted.message, admitted.retry_after);
    return;
  }
} catch (e) {
  hideLoading();
  showLiveSearchUnavailable('Live Search did not respond. Quick Match is still available.');
  return;
}
hideLoading();
startPolling(input, myGeneration, sinceISO, mode, admitted.search_id, filters);
```

`showLiveSearchUnavailable(message, retryAfter)` needs writing: show the gateway's
message, and offer Quick Match as the fallback. When `admitted.unconfirmed` is
true the search was submitted but not confirmed, so poll as normal and let the
poll time out rather than retrying the search, which would risk duplicate paid
scraping. `WEBHOOK_URL_LIVE` and `WEBHOOK_URL_QUICK` can then be deleted from the
page.

After editing, run `node scripts/build-search-pages.cjs` to regenerate the pages.

## Load test

`tests/live-search-gateway-load.cjs` fires 100 simultaneous attempts.

    GATEWAY_TEST_KEY=... node tests/live-search-gateway-load.cjs      # free
    node tests/live-search-gateway-load.cjs --paid --max-searches=10  # costs credits

Paid mode refuses to start without an explicit `--max-searches` cap. It has not
been run; a paid run needs the owner's approved cost limit.

Capacity is **not** accepted. Quick Match read tests say nothing about Live Search
capacity, and no 100-user Live test has been run.

## Housekeeping

`gateway-ip-probe` and `gateway-forgery-probe` were temporary measurement
functions. Both are retired to a 410 stub with `verify_jwt: true` and can be
deleted from the Supabase dashboard.
