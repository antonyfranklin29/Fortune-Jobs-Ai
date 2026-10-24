# Employer routine-post approval — October 24, 2026

Status: database change deployed to production on October 24, 2026. Supabase returned success, and a read-only query confirmed that the live function contains the automatic rule, `anon` has no EXECUTE permission, and `authenticated` retains EXECUTE. The page change is published with the corresponding commit. No real employer post has yet been submitted through the new path.

## Experience

An employer proves the company once through an independent reviewer; employers do not change DNS. They can draft a job while that first check is pending. After company verification, submitting a routine job can publish it immediately. The response distinguishes `automatic` and `manual` review, and the workspace tells the employer whether the job is live or waiting. There is no promise of automatic publication for a pending company.

## Automatic rule

The server, not the browser, checks the exact submitted revision. Automatic publication requires: verified company and recorded independent verifier; confirmed, eligible owner account; HTTPS application host equal to the company's registered domain or a subdomain; a current posting date and closing date within 60 days; no contact links or common scam phrases in the description; and fewer than three automatic approvals by the company in the preceding 24 hours. Any failed condition sends the job to the existing reviewer queue. The common publisher still enforces the 15-active-job limit, URL collisions, expiry and company status under the organization lock. An edit to a live job that fails review does not replace the approved public version.

This is a deliberately narrow first version. Genuine jobs using an external applicant tracking system, an email address in the description, or a longer closing window need human review. Future expansion should use a verified allowlist of the company's career-service hosts, not a URL supplied by the posting client. The simple phrase check is a queue-routing signal, not a guarantee that an automatically published job is authentic. Keep a takedown path, audit the automated decisions, and sample live posts regularly.

## Deployment gate

1. The database migration was applied **alone** after confirming the concurrency and publisher functions exist. Do not replay historical pending migrations on the live database.
2. The included PGlite test covers pending company, ordinary publication, outside link, suspicious copy, risky edit, three-per-day review routing, cross-account denial, effective anon permissions and the 15-active-job cap. A real end-to-end employer post remains untested because production has no verified employer and no reviewer.
3. Monitor the first live submissions through the private audit trail and public catalogue. If an unexpected post appears, suspend its company or close the post using the existing operator controls, then restore the previous `employer_submit_post` function.
4. Assign an independent reviewer for first-time company claims and exception jobs. Production had zero reviewer accounts at deployment; until one is set up, `fortunejobs` stays pending and cannot use the automatic path. The owner account must not approve its own company.

The free active-post allowance remains 15. Employer Plus billing remains disabled.
