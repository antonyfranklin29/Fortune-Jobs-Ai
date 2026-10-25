# Fortune Jobs AI — next AI features checklist

**Status: first matching slice and private résumé workspace implemented October 24; generative AI remains planned.** Core release gates still take priority. Billing is deferred by the owner; these features must not depend on an unavailable subscription. The current fit estimate and workspace are transparent, local tools, not language-model features or hiring predictions.

## Job seeker: AI résumé builder

- [ ] Let a user start from an existing résumé, saved profile, or blank form. Ask for the target role and let them review all extracted facts before generating anything.
- [ ] Generate an editable, readable résumé draft with sections for experience, skills, education, and contact details. Keep formatting suitable for common applicant-tracking systems and offer PDF/DOCX export.
- [ ] Never invent employers, dates, degrees, skills, achievements, or numbers. Mark missing facts for the user to supply instead of silently filling them in.
- [ ] Let the user request focused edits (for example, shorten a summary or clarify a bullet). Show before/after text and require the user to accept changes before saving.
- [ ] Save drafts only to the correct account; allow export and deletion. Tell the user what résumé data is sent to an AI provider, and avoid retaining raw documents longer than needed.

Initial workspace: users can start with a blank form, review selected details from their saved profile, or locally read an existing text-based PDF/DOCX for title and skill suggestions. They can edit a live plain-text preview, receive factual-completeness prompts and print/save a PDF. Imported facts enter the draft only after the user clicks to accept them. It keeps the draft only in the current tab and sends nothing to an AI provider. DOCX export, saved drafts, and model-written suggestions remain open. Do not market this initial workspace as AI-generated writing.

## Job seeker: job-specific match score

- [ ] Show a **0–100 match score for a selected job**, based on evidence in the résumé and the original job requirements. Label it as an estimate of fit, not an ATS score or a hiring prediction.
- [ ] Explain the score: matched requirements, missing or uncertain requirements, location/work-style fit, and how the user could improve the résumé truthfully.
- [ ] Recalculate after accepted edits. Never force a 100/100 score by inserting unsupported claims; a perfect score is possible only when the available evidence supports it.
- [ ] Test scoring against diverse roles and résumé formats, including sparse résumés, missing salary/location, and requirements the applicant does not meet. Check that small wording changes do not cause wild score swings.

Initial slice: result cards show a fit estimate only when the user has confirmed résumé skills and the listing has enough text with at least two recognizable skills. The card explains matched and unconfirmed skills, title and years of experience. It does not claim to assess all requirements, location or work style yet, and it shows no number for sparse listings. The full checklist items above remain open until those cases are addressed and validated with real users.

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
