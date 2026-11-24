# Technical SEO audit

Generated 2026-11-24T23:55:51.886Z. Mode: local artifact.

621 sitemap URLs; 621 HTML responses checked; truncated: false.

## Scope and limits

- Raw response HTML, not JavaScript hydration; crawler-readable content is checked directly.
- Unique word count is a within-site vocabulary heuristic, not a quality score.
- Only same-origin HTML links without query strings are fetched; application URLs are never requested.
- Existing Organization, WebSite, BreadcrumbList and SoftwareApplication schemas are inventoried; JobPosting is forbidden. FAQPage must match visible raw HTML.
- Depth covers the scanned public graph, not private/account or query-driven navigation.

## Freshness

935 content fingerprints; 0 sitemap/manifest mismatches. Successive-build stability is covered by tests.

## Findings

| Finding | Pages |
|---|---:|
| little_crawler_content | 5 |
| description_length | 1 |

Length and word-count findings are review warnings, not indexing diagnoses. No pages are removed or noindexed by this audit. See JSON for every URL, title, description, status, links, inbound links, depth, word counts and schema types.

## Template samples

- /: 200
- /jobs/: 200
- /jobs/software-engineer/: 200
- /jobs/software-engineer/texas/: 200
- /jobs/data-analyst/raleigh-nc/: 200
- /jobs/remote/: 200
- /jobs/remote/software-engineer/: 200
- /jobs/entry-level/: 200
- /jobs/entry-level/data-analyst/: 200
- /salaries/: 200
- /salaries/data-analyst/: 200
- /application-tracker.html: 200
- /resume-search.html: 200

## Before/after evidence and release instructions

Public HTTP GET audit (November 24, 2026): all 621 sitemap responses were HTTP 200. No sitemap noindex, robots blocks, invalid JSON-LD, mismatched FAQs, non-self canonicals or broken internal links were found. Static-graph issues: 10 orphans, 38 URLs unreachable within three clicks, five app roots without an H1. 250 descriptions triggered the length heuristic.

The candidate rebuild removes those orphans, long click paths and missing H1s, and reduces description-length warnings to one. Five short app introductions retain the conservative 80-word warning; no padding or noindex was added. Policy introductions explicitly say they are summaries, and the full policies remain in the application.

`seo-audit-live.json` is the read-only HTTP baseline; `seo-audit.json` is the local candidate artifact. These are not GSC indexing reports. Generated HTML, React bundles and the initial freshness manifest are not committed. After approval, rebuild both React and generated pages. The first approved generator run seeds jobs/seo-freshness.json. Future runs preserve a page and lastmod if substantive content and complete matching-job evidence are unchanged, including jobs outside the card limit. Pay, membership, requirements and URLs invalidate the digest; refreshed-at timestamps do not.

The proposed workflow leaves its cron untouched. It audits after rebuilding and retains JSON/Markdown as a 14-day artifact. Both report steps are non-blocking; reports are not committed or published automatically. No workflow was dispatched.

Audit/freshness tests and generator integration pass. React build validates 16 pages. Root tests have no new failing names relative to main.
