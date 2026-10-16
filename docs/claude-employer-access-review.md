# Employer access review — Claude, 2026-10-15

Coordination report for Codex and Franklin, against `docs/employer-backend-review-2026-10-15.md`
(main at `93f6286`). Backend only. Nothing is applied to production, deployed, granted, or enabled.
Payments remain disabled, and no real reviewer has been granted access.

## Question

Does employer access depend on confirmed identity and active company membership? Can an
ordinary job seeker read another company's private data, grant themselves employer or reviewer
rights, approve posts, or bypass the 15-active-job limit?

## Answer

Yes, for the paths tested. Every employer and operator entry point requires a signed-in user with
a confirmed email, and most also require active membership of the organisation or source concerned.
Tables are closed to `anon`, `authenticated` and PUBLIC. Reviewer status is a row that only the
database owner can insert, and no code reads `user_metadata`. The access review found five real
defects. All five are fixed in one new pending migration, with tests showing they reproduce on the
pending chain without it.

## Findings

| # | Severity | Finding | Evidence before the fix | Fix |
|---|---|---|---|---|
| F1 | Medium | A banned or deleted account keeps employer and reviewer access until its session expires. The domain-proof RPCs also accepted banned owners. | `employer_my_state` and `employer_save_post` succeeded for a banned owner. `employer_domain_check_begin` returned `lookup` for a banned owner. | `employer_caller()` and the domain-proof RPCs now refuse banned, deleted and unconfirmed accounts. Production has `banned_until`, `deleted_at` and `email_confirmed_at` (read-only check). |
| F2 | Medium | A job seeker who registers a company's domain first blocks the company from registering. A pending registration was refused for any domain already claimed by another pending registration. | `employer_register_org('Target Co','targetco.com')` returned `domain_already_registered` after the seeker's pending claim. | Only verified or suspended organisations claim a domain. Pending registrations may coexist, and only DNS proof plus operator verification can make one live. |
| F3 | Medium | The same squatting applies to Greenhouse and Lever boards. A pending source claimed a board, so the real company's own submission failed. | Direct probe: after the seeker's pending claim, the real company's `employer_submit_source` raised `board_already_registered`. | Board uniqueness applies only to approved sources. |
| F4 | Low–medium | An operator could verify an organisation without recording why, so the name-to-domain identity check left no trace. A second organisation could also be verified for an already-claimed domain. | `operator_set_org_status(..., 'verified', '')` succeeded. | Verification needs a note, and a domain can only be claimed by one verified or suspended organisation. |
| F5 | Low | The read-only listing-visibility helper `employer_listing_visible(uuid, text)` was executable by `anon` and `authenticated`. It let anyone test whether a known organisation or source ID was verified or approved. | `anon` executed it without error. The catalogue policy no longer needs it. | Revoked from PUBLIC, `anon` and `authenticated`. A guard refuses to run unless the search-visibility policy is already in place. |

One further item was checked, and it is not a new defect. Reading the original feed function
(`20261016_employer_submissions.sql`), an expired-but-open feed posting could be revived by its update
path without a quota check. I confirmed that by reading the code, not by reproducing it. Codex's
`20261017_employer_feed_publish_hardening.sql` replaces that function, and section 8b tests the fixed
version. The suite fails if the quota check is removed (mutation below).

## What was verified (`tests/sql/employer-access.sql`, 78 assertions plus four catalogue sweeps)

Each check ran as the real `anon`, `authenticated` or `service_role` role, on a disposable
PostgreSQL 16 with the Supabase role and auth shim, after all pending migrations.

- **Catalogue sweep:** RLS is on for every employer table, and none is granted to PUBLIC, `anon`
  or `authenticated`. `pre_scraped_jobs` stays read-only to signed-in users.
- **Function sweep:**
  - No employer or operator function is executable by PUBLIC.
  - The signed-in set is exactly the reviewed list.
  - `anon` can run only the read-only listing-keys helper.
  - No signed-in function takes a caller or user identity argument.
  - Service-only functions (`employer_publish_feed_jobs`, `employer_mark_domain_verified`,
    `employer_domain_check_*`, `employer_source_for_worker`, the operator-only helpers and others)
    are refused to every user role.
- **Anonymous visitor:** cannot read any employer table, call any employer or operator function, or
  register an organisation.
- **Job seeker with metadata claiming operator and employer:** cannot read any private table, insert
  into `employer_operators`, `employer_org_members`, `employer_entitlements` or `employer_billing_config`,
  or update `pre_scraped_jobs`. Every operator function is refused with `operator_only`. Writes to
  another company's posts, sources, candidates and status all fail. Client-supplied status, approval,
  org, job and paid fields are ignored, and a self-registered company's post cannot be published.
- **Unverified company:** can review and approve a post, but nothing is published and no listing exists.
- **Membership and identity:**
  - A removed member loses access on the next call.
  - An unconfirmed email is refused on every call, even with active membership.
  - A banned owner is refused, including the domain-proof path.
  - A suspended organisation refuses edits and its listings disappear at once.
- **Reviewers:** an operator who belongs to an organisation cannot review or verify it. A stale
  approval (revision changed) is refused. An unsubmitted draft cannot be approved.
- **Quota:** 15 live posts; the 16th is blocked for every route. Editing a live post takes no new slot.
  Closing frees a slot, reactivation at the limit is refused, and a refused reactivation takes nothing.
  A service-written entitlement is inert while billing is off, and an owner cannot change billing
  configuration.
- **Feed quota:** a selected feed posting publishes only into a free slot. An expired feed posting
  cannot be revived past the limit, and it stays expired.
- **Squatting:** a seeker's pending claim on a domain or board does not block the owning company.
  An unverified claim cannot be verified, and a second registration for a verified domain is refused.
- **Anonymous visitors:** see exactly the live listings of a verified organisation, none for unverified
  ones, and none after suspension, even before any worker runs.

## Mutation checks

Each protection was removed in a throwaway copy, and the suite was run against it:

| Mutation | Result |
|---|---|
| Remove the ban check from `employer_caller()` | Caught (ban assertion) |
| Remove the operator note requirement | Caught (`note_required`) |
| Let an expired-but-open feed posting skip the quota (Codex's function) | Caught (revival assertion) |

Before the fix, the suite (run statement by statement against the pending chain without the
hardening file) recorded every defect above: the listing-helper exposure, the ban gap, the
note gap, the domain squat and the board squat.

## Changes in this commit

New, pending and not applied:
- `migrations/pending/20261018_employer_access_hardening.sql` — the fixes above. It redefines
  `employer_caller`, `employer_register_org`, `operator_set_org_status`, `employer_domain_check_begin`
  and `employer_domain_check_finish` with their signatures and grants unchanged, adds
  `employer_user_eligible`, replaces two unique indexes, and revokes one helper. It refuses to run
  unless the search-visibility migration is already in place.
- `tests/sql/employer-access.sql` — the adversarial suite (rolled back).
- `tests/employer-access-db.mjs` — runner, skipped unless `FJ_PG_DISPOSABLE=1`.
- `docs/claude-employer-access-review.md` — this report.

Edited, and the reasons:
- `tests/sql/supabase-shim.sql` — adds `banned_until` and `deleted_at` to the test `auth.users`, matching production.
- `tests/sql/employer-submissions.sql` — three assertions pinned the old behaviour, and they changed
  deliberately: the pending duplicate domain (now allowed); B's organisation count (now two, Beta
  and its pending Acme claim); and the operator verification that needs a note.
- `tests/employer-submissions-db.mjs` and `tests/employer-feed-integration.mjs` — the migration list
  now includes the hardening file. **Codex: this edits your test file, but only the list.**
- `package.json` — one new script, `test:employer-access`.

Not touched: login, account flow, employer pages and scripts, navigation, and every existing pending
migration (`20261016_employer_submissions.sql`, `20261016_employer_feed_runs.sql` and the
`20261017_*` files).

## Test results

- `FJ_PG_DISPOSABLE=1 npm run test:employer-access` — PASS (the full chain plus this migration).
- `FJ_PG_DISPOSABLE=1 node --test tests/employer-submissions-db.mjs` — 3 of 3 pass.
- `node --test tests/employer-feed-integration.mjs tests/employer-feed-backend.mjs tests/employer-submissions.mjs` — 35 of 35 pass.
- `npm test` — 154 tests, 152 pass. The two failures are in `tests/resume-extraction.cjs` (PDF and DOCX
  parsing). They fail identically on untouched `origin/main`, so they are unrelated to this work.
- `npm ci` was needed to install `@electric-sql/pglite` from the lockfile in this checkout.

## Read-only production check (2026-10-15)

Through the Supabase tool, read-only: `auth.users` has `email_confirmed_at`, `banned_until`,
`deleted_at` and `raw_user_meta_data`. No `employer_*` table, function or operator table exists yet,
and `pre_scraped_jobs` has only the original `public can read pre-scraped jobs` policy. Nothing was
written.

## Decisions for Codex and Franklin (not changed here)

1. **Organisation names are free text.** A verified domain can present any company name. Identity
   therefore depends on the operator confirming the name matches the domain, and the operator must now
   record that in the note. Suggest a written checklist in the operator runbook.
2. **A pending workspace can exist before proof.** A confirmed job seeker can create an owner-level,
   pending organisation for any domain. It cannot publish, approve or verify. The alternative is to make
   a first owner's membership active only after DNS proof. That changes the registration flow, so it
   needs a product decision.
3. **A colluding second account can act as the reviewer.** "Cannot review your own organisation" is a
   membership check, so two cooperating accounts can get around it. This needs human operator
   discipline, not code.
4. **The cap is per account, not per person.** Each account may hold three organisations. Each needs a
   separate DNS-proved domain, and each domain gets 15 free posts. The effective limit is therefore 15
   per verified domain.
5. **Anonymous visitors can still list employer organisation and source IDs** for visible listings
   through `employer_public_listing_keys()`. Those IDs already appear in the listing rows, so this adds no
   new exposure.

## Remaining deployment blockers

1. Codex review of this report and of the shared-file edits listed above.
2. Apply in dependency order, after review: `20261016_employer_submissions`, `20261016_employer_feed_runs`,
   the `20261017_*` files, then `20261018_employer_access_hardening`. Then insert operator user IDs by hand.
3. Re-run the catalogue and function sweeps (`tests/sql/employer-access.sql`, sections 1 and 2) read-only
   against production after applying. Confirm the owner of `employer_public_listing_keys` is the catalogue owner.
4. A native concurrent race for the new paths (ban during publish, owner deletion during status change)
   on a disposable Postgres with two connections. The existing two-connection race covers publishing only.
5. Deploy the employer edge functions with JWT verification off only as already documented. Payments and
   reviewer grants stay off until Franklin decides items 1–4 above.
