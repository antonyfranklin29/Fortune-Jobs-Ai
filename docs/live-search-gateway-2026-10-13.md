# Live Search admission gateway — deployed state and pending cutover

Owner of this area: Claude. Quick Match catalogue, refresh ingestion and regional
coverage stay with Codex; nothing in this change touches that pipeline.

## What is deployed

Supabase Edge Function `live-search` (ACTIVE, version 2, `verify_jwt: false`).
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
| `live_search_settle()` | Releases a slot when a search finishes or fails |

Both tables have RLS on and **no** grants for `anon` or `authenticated`. Only
`service_role` reaches them. No existing table permission was altered.

## Controls

- **Validation** — POST only, body capped at 8 KB, `text` required and bounded by
  `max_query_chars`, `mode` must be `live`, filters restricted to a known list and
  length-checked, control characters rejected everywhere.
- **Caller identity** — salted SHA-256 of the client IP. The raw IP is never stored.
- **Rate limits** — per caller per minute / hour / day.
- **Concurrency** — `max_concurrent` slots, claimed atomically so two requests can
  never take the last one.
- **Cost bounds** — global hourly and daily caps protect the paid scraping budget.
- **Queueing** — a request blocked only by concurrency waits up to `queue_wait_ms`
  for a slot, then sheds with `Retry-After`.
- **Timeouts** — upstream dispatch aborts at 10s; slots self-expire after
  `slot_seconds` so a lost search cannot hold capacity forever.
- **Kill switch** — `paused = true` stops all Live Search while leaving Quick Match
  untouched.

Current values: concurrency 3, caller 2/min, 10/hour, 25/day, global 60/hour,
150/day, slot 45s, queue wait 6s.

## Search-ID isolation

The gateway mints the `search_id`. Clients can no longer choose or forge one, so a
visitor cannot guess another visitor's id or collide with it. This strengthens the
existing per-search filtering rather than replacing it.

## Verified (2026-10-13)

| Check | Result |
| --- | --- |
| 8 malformed request shapes | All rejected 400 with specific reasons |
| Oversized body | 413 before parsing |
| Caller rate limit | 2 admitted, further attempts 429 |
| Saturation (3 slots held, 4 concurrent callers) | All shed 503 `at_capacity`, `Retry-After: 15` |
| Recovery after slots lapsed | Next request admitted |
| Slot reclaim | Expired holders auto-released |
| Credits spent | None — no request reached Make |

Known limitation: the queue budget is soft. Under contention one request waited
10.5s against a 6s budget because admission attempts serialise on the advisory
lock. Bounded, but not a hard ceiling. Worth revisiting if concurrency is raised.

## Pending — needs the owner

### 1. Secrets (Supabase dashboard → Edge Functions → Secrets)

| Secret | Value |
| --- | --- |
| `MAKE_LIVE_WEBHOOK_URL` | The Make Live Search webhook URL |
| `MAKE_GATEWAY_SECRET` | A new random string you generate |
| `CLIENT_HASH_SALT` | A new random string (currently falling back to a default) |
| `GATEWAY_TEST_KEY` | A new random string; enables free dry-run load testing |

### 2. Make scenario must require the secret

Until this is done the old webhook is still directly callable and the gateway can
be bypassed. In the Make scenario, immediately after the Webhook module add a
filter that only continues when `gateway_secret` equals `MAKE_GATEWAY_SECRET`.
Rotating the webhook URL afterwards closes it completely, since only the gateway
would know the new one.

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
message, and offer Quick Match as the fallback. `WEBHOOK_URL_LIVE` and
`WEBHOOK_URL_QUICK` can then be deleted from the page.

After editing, run `node scripts/build-search-pages.cjs` to regenerate the pages.

## Load test

`tests/live-search-gateway-load.cjs` fires 100 simultaneous attempts.

    GATEWAY_TEST_KEY=... node tests/live-search-gateway-load.cjs      # free
    node tests/live-search-gateway-load.cjs --paid --max-searches=10  # costs credits

Paid mode refuses to start without an explicit `--max-searches` cap. It has not
been run; a paid run needs the owner's approved cost limit.

Capacity is **not** accepted. Quick Match read tests say nothing about Live Search
capacity, and no 100-user Live test has been run.
