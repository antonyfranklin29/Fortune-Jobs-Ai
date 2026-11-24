# Codex brief — Nov 24 2026: SEO pages from real search demand (remote, entry-level, salary, H-1B filers, ATS score page)

## Why
OpenSEO keyword data (U.S., Nov 23) shows the biggest job searches are easy to rank for (keyword difficulty, KD, 0–22), and we already hold the data to answer them:

| Search | Monthly searches | KD | Our data today |
|---|---|---|---|
| entry level jobs | 201,000 | 0 | 804 open entry-level/junior/new-grad titles |
| remote software engineer jobs | 40,500 | 0 | 193 remote SE jobs |
| data analyst salary | 22,200 | 2 | 4,408 jobs show pay |
| remote data analyst jobs | 14,800 | 0 | 70 |
| entry level data analyst jobs | 9,900 | 0 | 127 |
| entry level software engineer jobs | 4,400 | 0 | — |
| resume score | 9,900 | 13 | /resume-search.html exists |
| job application tracker | 1,900 | 0 | tracker exists, no public page |
| companies that sponsor h1b | 1,300 | 12 | only 11 jobs mention sponsorship |
| visa sponsorship jobs / opt jobs | 1,600 / 720 | 17 / 6 | — |

Hard (KD 66–100), do NOT chase with new pages: "free resume builder", "ai job search", "best job search sites", "free job search sites".

Extend the existing generator (`scripts/build-job-seo.mjs`, `jobs/geo.mjs`, `jobs/catalogue.mjs`) and its daily workflow (`.github/workflows/job-seo-refresh.yml`). Reuse the answer-block + FAQ + FAQPage pattern from PR #30.

Branch `codex/seo-demand-pages`, one PR per numbered part is fine (or one PR with clear commits). No merge, deploy, migration apply, secret or cron change. `npm test` has 32 known failures on main; add none.

## 1. Remote job pages
- `/jobs/remote/` hub + `/jobs/remote/<role>/` (e.g. `/jobs/remote/software-engineer/`, `/jobs/remote/data-analyst/`).
- Remote = `is_remote` true or `work_mode` contains "remote". Generate a role page only with ≥ 10 open remote jobs; hub only with ≥ 25.
- H1 "Remote <Role> jobs", answer block (count, updated date, pay range when ≥ 5 listings show pay, top employers, entry-level count), job list (same card markup as role/state pages), 3–5 FAQs (how many, pay, who's hiring, entry-level?, "is it fully remote?" → "check each listing; some remote jobs are limited to certain states").

## 2. Entry-level / new-grad pages
- `/jobs/entry-level/` hub + `/jobs/entry-level/<role>/` and `/jobs/entry-level/<role>/<state>/` where ≥ 5 jobs.
- Entry-level = title matches `entry[ -]level | junior | jr | new grad | new graduate | graduate | associate | early career | apprentice | intern(ship)?` (internships get their own label in the card, not the count of full-time roles) OR description says "0–2 years" / "no experience required". Put the matcher in one tested helper (`jobs/levels.mjs`); never count "senior associate" or "associate director".
- Copy says "entry-level and new-grad"; Fortune Jobs AI is for every job seeker, so link each page to the all-levels role page.
- FAQs: how many, pay, which employers hire new grads, "do I need experience?" (only answer with what listings say, e.g. "N listings mention 0–2 years").

## 3. Salary pages (from our listings only)
- `/salaries/<role>/` and `/salaries/<role>/<state>/` where ≥ 8 open listings show pay for that slice.
- H1 "<Role> salary in <State>" / "<Role> salary in the United States". Answer block: "Based on N current job listings that show pay on Fortune Jobs AI (updated <date>), listed pay for <Role> jobs in <State> ranges from $X to $Y a year (middle 50% of listings)." Hourly roles in hourly terms. Reuse `payRange`/`narrowPay`/`fmt` from `jobs/geo.mjs`.
- Show: middle-50% range, median, number of listings, top 5 paying employers by median (≥ 2 listings each), link to the open jobs page.
- Be explicit it's **listed pay in current postings, not a salary survey**. Never invent or extrapolate; omit a page rather than pad it.
- FAQs: typical pay, highest-paying employers, remote vs on-site pay (only if both have ≥ 5 listings), entry-level pay (only if ≥ 5).

## 4. H-1B filer data (U.S. Department of Labor, public domain)
Goal: give international students and OPT holders real data — and make the work-authorization filter useful.
- Source: DOL Office of Foreign Labor Certification **LCA Programs disclosure data** (H-1B, H-1B1, E-3), latest full fiscal year + current FY quarters, from dol.gov/agencies/eta/foreign-labor/performance. Large .xlsx files: download and aggregate in a GitHub Actions job (quarterly, `workflow_dispatch` too), never commit the raw files.
- Keep only `CASE_STATUS = Certified`, visa class H-1B. Aggregate to a small table, migration file only (do NOT apply): `h1b_employer_stats(employer_key, employer_name, state_code, soc_code, role_id, fiscal_year, certified_lcas, median_wage_annual, updated_at)`; map SOC codes / job titles to our `ingest_roles` ids where clear (data analyst 15-2051/13-1111 etc. — put the mapping in a tested JSON file; unmapped rows are dropped, not guessed). Load via service key in the workflow (secret already used by other jobs); describe the cron line needed in the PR, don't add it.
- Pages: `/h1b/` hub + `/h1b/<role>/` + `/h1b/<role>/<state>/` (≥ 5 employers). Title "Companies that filed H-1B applications for <Role> roles in <State>". Table: employer, certified LCAs (FY), median offered wage. Link each employer that also has open jobs on Fortune Jobs AI to those jobs.
- **Wording rules (important):** an LCA is not proof a company will sponsor you. Always say "filed H-1B Labor Condition Applications (LCAs) certified by the U.S. Department of Labor in FY<year>", cite the source with a link, and add "Filing history doesn't guarantee sponsorship for any specific job; confirm with the employer." Never say "sponsors" / "will sponsor" as fact. No personal data — employer-level only.
- On job cards and the job detail view: when the employer (normalized name match, tested) has certified LCAs for that role in the last FY, show a small badge "Filed H-1B LCAs (FY2026)" linking to the employer's row on the /h1b/ page. Keep the existing sponsorship-text badges.
- Work-authorization filter: add option "Employers with recent H-1B filings".

## 5. Free ATS resume score page
- `/resume-search.html` (and its React page): add a crawler-readable answer block + 5 FAQs with FAQPage schema, following the home page pattern (hidden-until-JS-fails `.prerender` block): what the score checks (headings, contact info, keywords from target jobs, file format, length), is it free (yes, no card), what files (PDF/DOCX up to 5 MB), is my resume stored (state the real behaviour from the code/privacy page — check, don't assume), how to improve the score.
- Add a short public page `/application-tracker.html` (or a section on an existing page) describing the free tracker (Saved → Applied → Interview → Offer) with a sign-up CTA.

## 6. Linking and sitemap
- Link the new hubs from `/jobs/` and from each role page ("Remote", "Entry-level", "Salary", "H-1B filers" chips) — only when the target page exists.
- Add all generated pages to `sitemap.xml` with today's lastmod; keep thin pages out (noindex + not in sitemap), as today.
- Update `llms.txt` "Main pages" with the 4 hubs.

## Rules
- Write "resume", never "résumé". "Job portal" wording. Never "straight from employers" / "skip the middleman". No fake reviews or ratings.
- **No JobPosting / Google for Jobs markup.** FAQPage only, mirroring visible text.
- Never show "Jobg8" as an employer; don't alter WhatJobs text or links.
- Numbers only from catalogue rows or the DOL file; nothing invented or rounded up.
- Tests: level matcher (true/false cases incl. "senior associate"), remote filter, page thresholds, salary percentiles + narrow-range wording, SOC→role mapping, employer-name normalization, LCA wording present on every /h1b/ page, FAQ JSON-LD equals visible FAQ, no JobPosting, sitemap entries.

## Reply with
PR link(s), a 3-line plain summary each, page counts per type (remote / entry-level / salary / h1b), and the rendered text of `/jobs/remote/software-engineer/`, `/salaries/data-analyst/texas/` and `/h1b/data-analyst/new-jersey/` (or the nearest generated example) in the PR description.
