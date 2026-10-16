# Employer submissions and approval — Claude track, handoff for review

**Codex integration update — 2026-10-15:** The original report is preserved below. Worker integration, test registration, account deletion and query visibility now have tested backend fixes. Read `docs/employer-backend-review-2026-10-15.md` and the migration order in `docs/employer-feed-backend-2026-10-15.md` before deployment. The domain endpoint now needs the atomic claim/finish migration. All employer migrations remain pending; the native PostgreSQL results below are Claude's reported run, not a newly reproduced concurrent run. No frontend work was added in the follow-up.

Implements the Claude-owned part of `docs/employer-sourcing-plan-2026-10-15.md` and
`docs/claude-employer-pricing-update-2026-10-15.md`. **Nothing is applied or deployed.**
The migration is in `migrations/pending/`, the edge function is not deployed, and
`employers.html` is not linked from any shared navigation.

## Files (all new)

| File | What it is |
| --- | --- |
| `migrations/pending/20261016_employer_submissions.sql` | Orgs, members, DNS challenges, operators, billing config, entitlements, source registry, private evidence, feed candidates, direct posts, audit; all RPCs; catalogue provenance columns and visibility policy |
| `supabase/functions/employer-submissions/{index.ts,lib.mjs}` | Domain-proof check only (TXT lookup → `employer_mark_domain_verified`) |
| `employers.html`, `employer-submissions.js` | Employer page: register, DNS proof, posts, plan/quota, feed submission and posting choice; reviewer panel shown only when the server says the caller is a reviewer |
| `tests/sql/supabase-shim.sql`, `tests/sql/employer-submissions.sql`, `tests/employer-submissions-db.mjs` | Database tests on a disposable PostgreSQL 16 |
| `tests/employer-submissions.mjs`, `tests/employer-submissions-edge.ts` | Offline helper/page checks; edge function against fake Supabase + stubbed DNS |

## How it works

**Access model.** Every new table has RLS on and no grants to `anon`/`authenticated`.
All access is through `SECURITY DEFINER` functions that check `auth.uid()`, a confirmed
email, membership, and operator status. PUBLIC execute is revoked on every function;
signed-in users get only the employer/operator RPCs, and the service role gets the rest.

**Verification.** A new org starts `pending`. Domain control is proved by a DNS TXT
record (`_fortunejobsai.<domain>` = `fortunejobsai-verify=<token>`). The edge function
takes the domain and token from the database, never from the request. A reviewer then
sets the org to `verified`; that is refused until the domain is proved. A manual
fallback (`operator_verify_domain`) requires a written note and is audited.

**Operators.** These are rows in `employer_operators`, inserted only by the database
owner; `user_metadata` is never used. An operator cannot review an org they belong to.
Every decision writes `employer_audit`.

**Direct posts.**
- Draft → `pending_review` → operator approves the exact revision → publication.
- Employers can only save content fields; status, approval, org, plan and job ids sent
  by the client are ignored.
- Editing a live post leaves the public version unchanged until it is re-reviewed.
- Employers can re-activate only an approved, unchanged revision.

**Feed sources.**
- The employer submits the board, requested apply hosts and a permission attestation
  (display and refresh are required, the description is optional). The attestation is
  private evidence.
- On approval the operator sets the allowed hosts (1–8, no wildcards), expiry
  (≤400 days), permission reference and attribution. The description is allowed only if
  the employer granted it.
- `employer_source_for_worker(id)` returns the contract-v1 record plus its revision for
  `collectEmployerFeed`'s `loadSource` port, or null unless the source is approved, its
  org verified and its permission unexpired.
- The worker stages rows (`employer_stage_feed_candidates`), the employer chooses which
  to show, then `employer_publish_feed_jobs(source, revision, ids)` publishes the chosen
  rows under the same lock and quota as direct posts.
- `employer_close_feed_jobs` closes only that source's rows, and the caller must hold a
  complete enumeration.

**Quota.**
- Every publish, re-activation and feed publication takes the org's row lock, then
  counts that org's open, unexpired catalogue rows.
- Limit: 15, unless all three hold:
  - `employer_billing_config.paid_publishing_enabled` is true,
  - a `paid_active_limit` is set,
  - the org has an unexpired entitlement written by the service.
- The switch is off and no paid limit is set, so it is 15 for everyone, and no client
  input can change it.
- `employer_my_state` reports `checkout_available: false`, and the page shows
  Employer Plus as "Not available yet". There is no payment button.

**Downgrade.** `employer_apply_downgrade` pauses excess posts, which can be restored and
are never deleted. It acts only when the employer has marked which posts to keep;
otherwise it returns `selection_required` and changes nothing. It is not scheduled,
because the notice timing and no-selection fallback are still open decisions.

**Visibility.** The catalogue read policy now also hides employer rows when the org is
not verified, the source is revoked, disabled or expired, or the post's closing date has
passed. This happens immediately, not when a worker next runs. Revocation and suspension
also close the rows.

**Provenance.**
- Direct rows: `source='employer_direct'`, `source_listing_id=<post id>`.
- Feed rows: `source='employer_feed'`, `source_listing_id='<source id>:<provider id>'`.
- Both carry `employer_org_id`, `employer_source_id`/`employer_post_id` and `expires_at`.
- Company comes from the reviewed org or source name, not the form.
- Publication never takes over another row with the same `apply_url`. It reports
  `apply_url_already_listed`, so an Adzuna listing is never relabelled.

## Test results (local PostgreSQL 16.15, Supabase role/auth shim)

`tests/employer-submissions-db.mjs`: 3/3. The scripted file covers:
- Anon and ordinary-user denial; unconfirmed email.
- Organization isolation (A vs B) and forged fields.
- Review rules: no self-review, revision binding, unverified org.
- DNS proof: wrong and right token.
- Quota: 15th publishes, 16th returns `upgrade_required`.
- Edit at the limit: no extra slot, live version unchanged until review.
- Close and reactivate.
- Forged and service-written entitlements while billing is pending; checkout-like input.
- Feed: selection, shared quota, host allow-list, Adzuna URL not relabelled,
  idempotent republish.
- Expiry, revocation, downgrade selection, suspension, audit trail, and effective
  privileges on every function and table.

The second case is a **real two-connection race**: two simultaneous publications at 14
active give exactly one publish and one `upgrade_required`, ending at 15.

**Mutation checks.** Each of these breaks at least one test:

| Mutation | Result |
| --- | --- |
| Removing the org row lock | Race publishes both (16) |
| Entitlement without the billing switch | Fails |
| Operator reviewing their own org | Fails |
| Policy ignoring employer visibility | Fails |
| Honouring client status / review fields | Fails |
| Granting the feed publisher to users | Fails |
| Dropping the duplicate-URL check | Fails |

**Other suites:**
- `tests/employer-submissions.mjs`: 5/5 (DNS helpers; the page never reads URL
  state, has no payment code, renders text not HTML, and has noindex).
- `tests/employer-submissions-edge.ts`: 5/5 (anon key and unconfirmed refused,
  non-member gets 404 with no lookup, request cannot steer the domain, mismatch
  rate-limited, match verifies).
- `npm test`: unchanged, 116 pass. The one failure (`resume-extraction`, missing
  `@napi-rs/canvas`) also fails without these changes.

## Needs Codex / Franklin before activation

1. **Shared files I did not edit:**
   - `package.json`: add `tests/employer-submissions.mjs` to `test`, plus
     `"test:employer-db": "node --test tests/employer-submissions-db.mjs"` and
     `"test:employer-edge": "deno test --allow-env --no-check --import-map=tests/deno/import_map.json tests/employer-submissions-edge.ts"`.
   - The source/attribution renderer: `employer_direct` has no attribution. For
     `employer_feed`, `attribution` holds the reviewed `attribution_text` when set.
     The helper currently handles Adzuna only.
   - Quick Match should select the new columns only if it needs them; existing queries
     are unaffected.
2. **Catalogue policy change.** The migration replaces `"public can read pre-scraped
   jobs"` with a policy that adds `expires_at` and employer visibility. Non-employer rows
   short-circuit on `employer_org_id is null`. Please review for query-plan impact on
   Quick Match.
3. **Contract mapping for the collector:**
   - `employer_source_for_worker` returns `{source, revision}`.
   - `approved_by` is the reviewer's user id as text.
   - `domain_verified_at` comes from the org.
   - Staged rows must carry `source_listing_id='<id>:<provider id>'`, `job_title`,
     `location`, `state_code`, `canonical_role`, `apply_url` and optional
     `job_description`, `employment_type`, `work_mode`, `is_remote`, `posted_at`.
4. **Applying.**
   - Apply the pending migration after review.
   - Insert the operator user ids:
     `insert into employer_operators (user_id) values ('<uuid>')`.
   - Deploy `employer-submissions` with `--no-verify-jwt`.
   - Re-run the effective-privilege checks against production.
5. **Open decisions (unchanged from the pricing update):** paid maximum, downgrade notice
   and grace timing, no-selection fallback, and billing provider/events. Paid publishing
   stays off until all are settled and verified billing exists.
6. **Not built:**
   - Inviting additional org members (operators can add them in SQL for now).
   - An operator UI for source approval (done in SQL with `operator_review_source`,
     because the permission reference must be recorded).
   - The feed worker, which is Codex's.
