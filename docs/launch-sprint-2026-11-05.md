# Fortune Jobs AI launch checklist

## Website through November 10

- [x] Verify public entry points respond. Homepage, Find Jobs, results, sign-in, résumé builder, employers and privacy returned HTTP 200 on November 5 Eastern.
- [x] Check the public catalogue. 6,922 open jobs, including 6,245 Adzuna listings. The 677 older imports lack stored descriptions, and two legacy apply URLs use HTTP. Counts do not verify individual vacancies.
- [ ] Codex: verify public search on desktop and mobile, including city and country selection, category and date filters, empty results, and a sample of application destinations.
- [ ] Claude: test sign-in, saved jobs, profile, résumé upload and PDF export, employer workspace and email preferences. Report blocked signed-in tests separately. Use disposable accounts for changes.
- [ ] Codex: confirm Cloudflare reports a real visit and review the public traffic baseline.
- [ ] Franklin and Codex: confirm the backup destination, restore into an isolated environment and record the outcome. Keep employer publishing limited until an independent reviewer completes the pilot.
- [ ] November 10 release check: close or defer every reproducible blocker, record the rollback commit and decide when to remove pre-launch noindex. Keep billing and paid Live Search outside the release until their separate readiness gates pass.

## App starting November 11

- [ ] November 11–13: agree on the release surface. Recommended December 1 target is an installable web app beta, with job search, job details, saved jobs and account access. Confirm whether native stores are required before committing to their release date.
- [ ] November 14–20: build install support, icons, launch behavior and offline fallback. Test sign-in and outbound application links on iOS and Android.
- [ ] November 21–26: run a small device beta. Verify install, update, sign-in, search and saved jobs on actual devices. Fix blockers and document support and rollback.
- [ ] November 27–30: freeze features, rerun core flows, check privacy and release copy, and make the December 1 go/no-go decision.
- [ ] December 1: release the beta if install, authentication, search and recovery checks pass. Native store publication depends on developer accounts, packaging, store requirements and review.
