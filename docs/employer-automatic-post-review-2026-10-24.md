# Employer routine-post approval — October 24, 2026

Status: implemented and tested locally; **not deployed**. The live employer page and database still use manual post review. Apply the single pending migration before publishing the accompanying page copy and script.

## Experience

An employer proves the company once through an independent reviewer; employers do not change DNS. They can draft a job while that first check is pending. After company verification, submitting a routine job can publish it immediately. The response distinguishes `automatic` and `manual` review, and the workspace tells the employer whether the job is live or waiting. There is no promise of automatic publication for a pending company.

## Automatic rule

The server, not the browser, checks the exact submitted revision. Automatic publication requires: verified company and recorded independent verifier; confirmed, eligible owner account; HTTPS application host equal to the company's registered domain or a subdomain; a current posting date and closing date within 60 days; no contact links or common scam phrases in the description; and fewer than three automatic approvals by the company in the preceding 24 hours. Any failed condition sends the job to the existing reviewer queue. The common publisher still enforces the 15-active-job limit, URL collisions, expiry and company status under the organization lock. An edit to a live job that fails review does not replace the approved public version.

This is a deliberately narrow first version. Genuine jobs using an external applicant tracking system, an email address in the description, or a longer closing window need human review. Future expansion should use a verified allowlist of the company's career-service hosts, not a URL supplied by the posting client. The simple phrase check is a queue-routing signal, not a guarantee that an automatically published job is authentic. Keep a takedown path, audit the automated decisions, and sample live posts regularly.

## Deployment gate

1. Confirm the production migrations through employer concurrency hardening, URL-conflict handling, and the email-domain rule are already present. Apply `migrations/pending/20261024_employer_routine_post_approval.sql` **alone**. Do not replay historical pending migrations on the live database.
2. Repeat the local database scenarios against a disposable PostgreSQL server if available; the included PGlite test covers pending company, ordinary publication, outside link, suspicious copy, risky edit, three-per-day review routing and the 15-active-job cap.
3. Deploy the employer page and script together only after the database update. Test one verified synthetic company and one pending synthetic company end to end. Inspect the private audit trail and public catalogue, then roll back the function if either path behaves incorrectly.
4. Assign an independent reviewer for first-time company claims and exception jobs. Current production reportedly has no reviewer account; until one is set up, `fortunejobs` stays pending and cannot use the automatic path. The owner account must not approve its own company.

The free active-post allowance remains 15. Employer Plus billing remains disabled.
