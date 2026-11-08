# Quick Match timeout proposal and employer QA

Reviewed against main `f16c253`, November 7 evening ET. This branch contains a proposal only. No production index, policy, function, schedule, secret, migration or catalogue row was changed. Production EXPLAIN ran in a read-only transaction with the `anon` role. The only index experiment ran in a disposable local PostgreSQL 17 database, which was stopped afterwards.

## Public employer listing

Search used `TEST Data Analyst`, location `Edison, NJ`.

- Desktop, anonymous, 1280px viewport: one result. Card and detail show `TEST Data Analyst (Fortune Jobs AI test, please ignore)`, company `fortunejobs`, Edison, NJ, the test description, Full-time and Hybrid.
- Phone, verified 390px viewport: the same card appears. Tapping it shows the detail and the Back to results control. The measured document width was 375px, with no horizontal overflow. Chrome had an existing signed-in session, so the phone check was signed in. No account controls or AI actions were used.
- Attribution is `Posted by a verified employer`, `Direct employer listing`, and `Apply through: Employer`. There is no literal `Listed by` line. The company name is visible on both card and detail.
- Both top and bottom Apply links point to `https://fortunejobsai.com/contact.html`. Clicking Apply opened a new tab at that URL, showing Contact Fortune Jobs AI. This test posting deliberately links to Contact, rather than a real application form.
- Minor presentation issue: the result count says `1 jobs found`.
- Signed-out `employers.html` still says `Prepare job drafts while our team checks the company` under `2. We verify it once`. That step needs updated wording for immediate verification by confirmed work email. The general 15-active-job headline also needs the first-week three-job exception nearby.
- The Employer submissions paragraph in `terms.html` correctly describes work-email verification, automatic post checks, manual review for exceptions, the first-week three-live-job limit, and independent review for career feeds.

Production listing ID supplied by Claude is `13386`, source `employer_direct`. The public card does not expose the database ID. No test posting was created or removed during this review.

## What the timeout investigation found

The failing path is `read()` / `quickMatches()` in `react/src/seeker/catalogue.js`. Any non-2xx catalogue response becomes a generic error. `quickMatches()` awaits the broad national request before issuing its city request, so a broad-request timeout also prevents an otherwise useful city lookup.

The database already has this index, confirmed through `pg_indexes`:

```sql
CREATE INDEX pre_scraped_jobs_search_text_idx
ON public.pre_scraped_jobs USING gin (search_text gin_trgm_ops);
```

A duplicate trigram index is not the proposed fix.

### Production EXPLAIN

Executed once as `anon` inside `BEGIN READ ONLY`, followed by `ROLLBACK`:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT job_title, company, location, salary, apply_url,
       employment_type, work_mode, is_remote, posted_at,
       category, country, job_description, source, closed_at
FROM public.pre_scraped_jobs
WHERE closed_at IS NULL
  AND (search_text ILIKE '%test%'
       OR search_text ILIKE '%data%'
       OR search_text ILIKE '%analyst%')
ORDER BY posted_at DESC NULLS LAST
LIMIT 300;
```

Observed plan, with existing anonymous visibility rules included:

```text
Limit                         actual rows=300, time=95.830..95.897 ms
  Sort                        top-N heapsort, memory=437 kB
    Sort Key: posted_at DESC NULLS LAST
    Seq Scan pre_scraped_jobs  actual rows=4,950
      Rows Removed by Filter: 8,418
      Filter: closed/expiry/public-employer visibility AND token disjunction
      SubPlan 1: employer_public_listing_keys(), actual rows=1, loops=1
Planning Time: 20.353 ms
Execution Time: 96.449 ms
Shared buffers at root: 2,085 hits, 0 reads
Estimated result rows: 198; actual rows before sort: 4,950
```

This run did not reproduce a three-second timeout. It confirms a full scan and a substantial row-estimate error. It cannot establish latency under the production load at the time of the reported failures. SQL execution timing also excludes PostgREST response serialization and browser transfer.

Row security constrains when PostgreSQL can apply non-leakproof search operators. An index existing does not establish that an anonymous query can use it. The observed anonymous plan retains the text checks as filters. Do not mark operators leakproof or weaken visibility rules to obtain a faster plan. See PostgreSQL's [row-security documentation](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) and [security barrier/index explanation](https://www.postgresql.org/docs/17/rules-privileges.html).

### Disposable local experiments

Loaded 13,368 catalogue rows into a separate local PostgreSQL 17 instance. Used the same projected public columns, the existing trigram/filter/category indexes and the same visibility predicate. The local visibility helper returned the snapshot's public employer keys, rather than querying the complete employer schema. That makes these comparisons useful for plan selection, not a full production benchmark.

All measurements below ran as `anon`, with row security enabled. No planner setting forced index usage.

| Local case | Plan | Execution | Shared hits | Plan width |
|---|---|---:|---:|---:|
| Existing indexes | Limit → Sort → Seq Scan | 26.144 ms | 1,297 | 714 |
| Add open-jobs chronological index | Limit → Sort → Seq Scan | 25.738 ms | 1,297 | 714 |
| Same index, omit job_description | Limit → Sort → Seq Scan | 25.515 ms | 1,297 | 209 |

Experimental index, created only locally:

```sql
CREATE INDEX pre_scraped_jobs_open_posted_idx
ON public.pre_scraped_jobs (posted_at DESC NULLS LAST)
WHERE closed_at IS NULL;
```

The anonymous planner did not choose this index. An earlier owner-role diagnostic chose an index scan, which is why checking only an elevated-role plan would give misleading evidence. The owner diagnostic is excluded from the comparison above.

Omitting descriptions reduced projected row width, but did not solve the scan. The sampled 300 descriptions contained about 147 kB in PostgreSQL storage. Description text also supports existing matching and detail behavior, so simply deleting it from the select list would regress callers. A future lightweight candidate phase would need a separate description fetch for shortlisted jobs and matching-parity checks.

## Proposed implementation for review

1. Add one bounded retry to the catalogue GET reader. Read the error JSON and retry only a `500` containing PostgreSQL code `57014` with a statement-timeout message. Wait about 250–500 ms with jitter, honoring the existing AbortSignal. Allow at most two attempts total for that GET. Leave authentication, permission, validation and other permanent failures as errors. Never retry AI, ingestion, Apply actions, or writes through this helper.
2. Make the existing city-specific candidate request independent of failure of the broad request. A timeout should not prevent that request from running. Merge and deduplicate successful pools with the existing accuracy filters. If one pool fails, display an explicit incomplete-results notice. If both fail, retain the error state; do not turn a timeout into a claim that no jobs exist.
3. Preserve description fields and matching behavior in this minimal repair. Do not add either experimental index based on the evidence above.

This is recovery for an intermittent failure, not a demonstrated reduction in SQL scan cost. A retry can also fail and adds latency and database work. Limit it to the specific timeout, instrument attempts, and monitor whether it improves completed searches or increases database pressure. The reported two failures among 183 GETs are Claude's observation, not an independently counted metric from this review.

## Acceptance and follow-up

- Mock `500 / 57014 statement timeout` followed by success and prove exactly two GETs, with the normal results preserved.
- Two timeout responses produce an error with no third attempt. Abort during the delay prevents the retry.
- A 401, 403, or unrelated 500 is not retried.
- A failed broad request plus a successful Edison city request still displays ID 13386 with an incomplete-results notice; both pools failing displays an error.
- An actual zero-result response still displays the empty state. Verify Chicago and Edison searches, source diversity, employer suspension/feed revocation, and description-dependent matching.
- After approval and implementation, measure anonymous end-to-end p50/p95, retry frequency, and `57014` rate over normal traffic. Include rare titles, common titles, city searches, country/category/date filters, and a no-match query.
- A structural database search change needs a separate measured design. Any public search RPC or search index must preserve expiry, suspension and feed-permission visibility at read time, with explicit permission tests. No such change is applied or approved by this document.

## Handoff

Recommended immediate repair is the narrowly scoped retry plus independent city lookup, subject to review. Remaining public-copy fix is the signed-out employer verification step and first-week-limit explanation. Billing, credentials, provider schedules and production schema are outside this branch.
