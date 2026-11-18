# Codex brief — Nov 18 2026: fix the failing "Refresh public job search pages" workflow (URGENT, small)

## What's broken
`.github/workflows/` "Refresh public job search pages" has failed on Nov 17 and Nov 18:
`Error: Public catalogue returned HTTP 500` at `jobs/catalogue.mjs:92`, from `build()` → `Promise.all` index 3 = `getEmployerPostings(config)`.

## Cause (verified by Claude)
- The workflow reads `pre_scraped_jobs` through PostgREST as `anon`, and `anon` has `statement_timeout=3s`.
- `readPages` filters on `country=eq.us&closed_at=is.null&source=...`, ordered by `id`, with keyset pagination (`id=gt.<last>`). There is **no index** on `source`, and none for open rows by `id`, so every page is a sequential scan of the whole table (~22k rows and growing). EXPLAIN shows about 1s per page when the database is warm; with four reads in parallel plus RLS cost, it goes over 3s.
- `getEmployerPostings` (source=eq.employer_direct, 0 rows) scans the whole table just to return nothing.

## Build (branch `codex/catalogue-index`, one PR)
1. Add a migration file in `migrations/` (follow the existing naming, e.g. `20261118_catalogue_read_indexes.sql`), plus a matching rollback file in `migrations/rollback/`:
   ```sql
   create index concurrently if not exists pre_scraped_jobs_open_source_id_idx
     on public.pre_scraped_jobs (source, id) where closed_at is null;
   create index concurrently if not exists pre_scraped_jobs_open_country_id_idx
     on public.pre_scraped_jobs (country, id) where closed_at is null;
   ```
   (`concurrently` cannot run inside a transaction; note that in the file header.)
   Rollback: `drop index concurrently if exists …` for both.
2. Make the workflow resilient. In `jobs/catalogue.mjs` `read()`, retry once on HTTP 500/503/504 or a timeout, after about 2s. In `build()`, run the reads one after another instead of in parallel with `Promise.all`, so the four big reads don't compete with each other.
3. Add a unit test for the retry: a mocked fetch returns 500 then 200, and `read` succeeds; 500 twice and it throws.
4. In the PR, include `EXPLAIN` output for the employer_direct query and for one catalogue page query, showing an Index Scan once the indexes exist. Use a local or branch database; do NOT run anything on production.

## Rules
- Branch + PR only. Do NOT merge, deploy, or apply the migration to production. Claude applies it (Franklin approved "index fix" on Nov 18), then re-runs the workflow.
- Don't change RLS policies or role timeouts.
- `npm test` has 32 known failures on main; don't add new ones.

## Reply with
PR link + the EXPLAIN output.
