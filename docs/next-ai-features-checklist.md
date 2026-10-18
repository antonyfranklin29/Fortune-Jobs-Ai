# Fortune Jobs AI — next AI features checklist

**Status: planned, not started.** Begin this checklist after the current release gates in `docs/production-status-2026-10-18.md` are complete: reliable job coverage and search, secure employer publishing, account and data protections, and working subscriptions. This document is a product backlog, not a claim that any feature below is live.

## Job seeker: AI résumé builder

- [ ] Let a user start from an existing résumé, saved profile, or blank form. Ask for the target role and let them review all extracted facts before generating anything.
- [ ] Generate an editable, readable résumé draft with sections for experience, skills, education, and contact details. Keep formatting suitable for common applicant-tracking systems and offer PDF/DOCX export.
- [ ] Never invent employers, dates, degrees, skills, achievements, or numbers. Mark missing facts for the user to supply instead of silently filling them in.
- [ ] Let the user request focused edits (for example, shorten a summary or clarify a bullet). Show before/after text and require the user to accept changes before saving.
- [ ] Save drafts only to the correct account; allow export and deletion. Tell the user what résumé data is sent to an AI provider, and avoid retaining raw documents longer than needed.

## Job seeker: job-specific match score

- [ ] Show a **0–100 match score for a selected job**, based on evidence in the résumé and the original job requirements. Label it as an estimate of fit, not an ATS score or a hiring prediction.
- [ ] Explain the score: matched requirements, missing or uncertain requirements, location/work-style fit, and how the user could improve the résumé truthfully.
- [ ] Recalculate after accepted edits. Never force a 100/100 score by inserting unsupported claims; a perfect score is possible only when the available evidence supports it.
- [ ] Test scoring against diverse roles and résumé formats, including sparse résumés, missing salary/location, and requirements the applicant does not meet. Check that small wording changes do not cause wild score swings.

## Employer: AI-assisted job post draft

- [ ] Start from a few verified inputs: job title, company, work location or remote status, employment type, application URL, and any employer-provided notes. The employer may also supply an authorized public job-description URL.
- [ ] Turn those inputs into a clean, editable job post with consistent headings and plain language. If duties, qualifications, pay, or benefits are missing, ask for them or leave them blank; do not invent them.
- [ ] Validate application links and fetch only permitted public pages. Treat fetched page text as untrusted data, not instructions to the AI or publishing system.
- [ ] Require the employer to review and submit the exact draft. Keep existing company verification, independent approval, revision tracking, and the 15-active-post limit in force.
- [ ] Test misleading or malicious source text, duplicate posts, unsupported claims, broken links, and changes made after approval.

## Release checks for these features

- [ ] Choose an AI provider and set a per-request and per-account cost ceiling before enabling generation.
- [ ] Add rate limits, abuse monitoring, failure handling, and clear AI-assisted labels where users make decisions.
- [ ] Run privacy, security, accessibility, mobile, and real-user reviews before public release.
- [ ] Update the product pages and privacy information to describe only the behavior actually deployed.
