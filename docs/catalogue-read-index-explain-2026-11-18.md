# Catalogue read index probe — 2026-11-18

PostgreSQL 17.11 on x86_64-windows, compiled by msvc-19.44.35229, 64-bit

Disposable localhost cluster, 22,000 synthetic rows, queried as anon with the repository Supabase shim and employer visibility RLS. No employer_direct rows. Local timings do not predict production latency. Default planner settings were used.

## employer_direct

```sql
select id,job_title,company,location,state_code,canonical_role,country,posted_at,expires_at,closed_at,source,apply_url,salary,is_remote,job_description,is_remote,work_mode from public.pre_scraped_jobs where country='us' and closed_at is null and source='employer_direct' order by id asc limit 1000;
```

Before

```text
Limit  (cost=1370.77..1370.78 rows=1 width=308) (actual time=7.284..7.285 rows=0 loops=1)
  Buffers: shared hit=648
  ->  Sort  (cost=1370.77..1370.78 rows=1 width=308) (actual time=7.280..7.281 rows=0 loops=1)
        Sort Key: pre_scraped_jobs.id
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=648
        ->  Seq Scan on pre_scraped_jobs  (cost=7.77..1370.76 rows=1 width=308) (actual time=7.246..7.247 rows=0 loops=1)
              Filter: ((closed_at IS NULL) AND (closed_at IS NULL) AND (country = 'us'::text) AND (source = 'employer_direct'::text) AND ((expires_at IS NULL) OR (expires_at > now())) AND ((employer_org_id IS NULL) OR (ANY ((((employer_org_id)::text || ':'::text) || COALESCE(employer_source_id, ''::text)) = (hashed SubPlan 1).col1))))
              Rows Removed by Filter: 22000
              Buffers: shared hit=648
              SubPlan 1
                ->  ProjectSet  (cost=0.00..5.27 rows=1000 width=32) (never executed)
                      ->  Result  (cost=0.00..0.01 rows=1 width=0) (never executed)
Planning:
  Buffers: shared hit=106 read=2
Planning Time: 5.164 ms
Execution Time: 7.341 ms
```

After

```text
Limit  (cost=8.05..15.40 rows=1 width=308) (actual time=0.007..0.007 rows=0 loops=1)
  Buffers: shared hit=2
  ->  Index Scan using pre_scraped_jobs_open_source_id_idx on pre_scraped_jobs  (cost=8.05..15.40 rows=1 width=308) (actual time=0.006..0.006 rows=0 loops=1)
        Index Cond: (source = 'employer_direct'::text)
        Filter: ((country = 'us'::text) AND ((expires_at IS NULL) OR (expires_at > now())) AND ((employer_org_id IS NULL) OR (ANY ((((employer_org_id)::text || ':'::text) || COALESCE(employer_source_id, ''::text)) = (hashed SubPlan 1).col1))))
        Buffers: shared hit=2
        SubPlan 1
          ->  ProjectSet  (cost=0.00..5.27 rows=1000 width=32) (never executed)
                ->  Result  (cost=0.00..0.01 rows=1 width=0) (never executed)
Planning:
  Buffers: shared hit=82 read=2
Planning Time: 0.356 ms
Execution Time: 0.040 ms
```

## catalogue_page

```sql
select id,job_title,company,location,state_code,canonical_role,country,posted_at,expires_at,closed_at,source,apply_url,salary,is_remote from public.pre_scraped_jobs where country='us' and closed_at is null and source not in ('remotive','himalayas') and id>10000 order by id asc limit 1000;
```

Before

```text
Limit  (cost=8.05..154.00 rows=1000 width=213) (actual time=0.041..0.752 rows=1000 loops=1)
  Buffers: shared hit=54
  ->  Index Scan using pre_scraped_jobs_pkey on pre_scraped_jobs  (cost=8.05..981.05 rows=6667 width=213) (actual time=0.039..0.697 rows=1000 loops=1)
        Index Cond: (id > 10000)
        Filter: ((closed_at IS NULL) AND (closed_at IS NULL) AND (source <> ALL ('{remotive,himalayas}'::text[])) AND (country = 'us'::text) AND ((expires_at IS NULL) OR (expires_at > now())) AND ((employer_org_id IS NULL) OR (ANY ((((employer_org_id)::text || ':'::text) || COALESCE(employer_source_id, ''::text)) = (hashed SubPlan 1).col1))))
        Rows Removed by Filter: 499
        Buffers: shared hit=54
        SubPlan 1
          ->  ProjectSet  (cost=0.00..5.27 rows=1000 width=32) (never executed)
                ->  Result  (cost=0.00..0.01 rows=1 width=0) (never executed)
Planning:
  Buffers: shared hit=6
Planning Time: 0.308 ms
Execution Time: 0.811 ms
```

After

```text
Limit  (cost=8.05..154.00 rows=1000 width=213) (actual time=0.023..0.723 rows=1000 loops=1)
  Buffers: shared hit=51
  ->  Index Scan using pre_scraped_jobs_pkey on pre_scraped_jobs  (cost=8.05..981.05 rows=6667 width=213) (actual time=0.022..0.668 rows=1000 loops=1)
        Index Cond: (id > 10000)
        Filter: ((closed_at IS NULL) AND (closed_at IS NULL) AND (source <> ALL ('{remotive,himalayas}'::text[])) AND (country = 'us'::text) AND ((expires_at IS NULL) OR (expires_at > now())) AND ((employer_org_id IS NULL) OR (ANY ((((employer_org_id)::text || ':'::text) || COALESCE(employer_source_id, ''::text)) = (hashed SubPlan 1).col1))))
        Rows Removed by Filter: 499
        Buffers: shared hit=51
        SubPlan 1
          ->  ProjectSet  (cost=0.00..5.27 rows=1000 width=32) (never executed)
                ->  Result  (cost=0.00..0.01 rows=1 width=0) (never executed)
Planning:
  Buffers: shared hit=3
Planning Time: 0.213 ms
Execution Time: 0.776 ms
```

The employer query uses the new source index. For this fixture, the catalogue page prefers the existing primary-key index before and after; the planner was not forced. The country index was built and validated. Production plans depend on their data and statistics.

Both concurrent index builds were valid. The concurrent rollback removed both indexes.
