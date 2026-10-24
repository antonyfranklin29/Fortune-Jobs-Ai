# Fortune Jobs AI legal and policy readiness — October 24, 2026

This is a product and operations checklist, not a claim of legal compliance or a substitute for counsel. Billing remains disabled until business formation, terms, taxes and Stripe are ready. No checkout or newsletter send is authorized by this document.

## Completed in this change

- Added public `terms.html` with rules for job seekers, employers, job-feed links, unsafe listings and current free allowances. Linked it from the landing, job search, About and both sign-in pages. It explicitly says paid plans are unavailable.
- Kept the existing privacy/contact pages and `info@fortunejobsai.com` request channel. Did not invent an incorporated entity name, mailing address, data-retention period or legal representative.

## Before the December 1 public launch

| Area | Required decision or evidence | Current state |
| --- | --- | --- |
| Operator identity | Confirm the actual legal operator name, business address and jurisdiction after incorporation. Update Terms, Privacy, email sender and support records consistently; have local counsel review them. | Not supplied; do not state Fortune Jobs AI is incorporated. |
| Privacy notice | Finish a data-flow inventory for account profiles, résumés and extracted text, searches, employer data, logs, Google sign-in, and every recipient. Decide lawful bases, retention/deletion criteria, access/export/erasure process, international transfers and any required local representative. Publish a revised notice *before* collecting data for a new purpose. | Current `privacy.html` is a factual interim notice. Claude is handling deletion UI/privacy coordination; avoid overlapping edits. |
| Cookies and similar storage | Audit first- and third-party storage/network calls on desktop and mobile. Explain essential sign-in and guest-resume storage. If nonessential analytics/ads/tracking are added, implement any required consent before loading them. | No analytics/advertising activation is claimed. Google Fonts and jsDelivr are external assets; check their actual requests. |
| Marketing email | Maintain separate opt-in, consent evidence, unsubscribe and suppression. Obtain a valid physical postal address (a properly registered PO box or private mailbox may qualify) before any US commercial newsletter. Check Canadian CASL identification and unsubscribe requirements before Canadian sends. | Weekly newsletter must stay OFF. `info@` alone is not a substitute for a postal address in US commercial email. Account verification email is a separate transactional flow. |
| Job data rights | Record Adzuna API permissions, required attribution, allowed countries, caching/retention and linking. Obtain documented permission for each employer feed; do not assume public job pages can be scraped and republished. Maintain removal/expiry and attribution checks. | Adzuna account remains on the 25-call trial; no automatic ingest schedule. Legacy Dice/Indeed rows are not evidence of a reusable license. |
| Employer postings | Reviewer process should reject impersonation, scams and discriminatory or unlawful ads. Verify company-domain proof, complaint intake, removal and appeal steps. Test that employer approval and suspension cannot be bypassed. | Backend/pilot exists; real employer acceptance and reviewer operations remain to be proved. |
| Job-seeker safety | Make external-application links and score limitations clear. Provide a fast listing-report route, review reports, and remove known false/closed jobs. Never imply that paying Fortune Jobs AI guarantees a job. | Terms now state these limits and point to `info@`. Operational triage owner/SLA still needed. |
| Security and recovery | Complete real encrypted off-site file backup, managed database backup or equivalent, isolated restore drill, access review, incident response and deletion-on-restore procedure. | `docs/backup-recovery-runbook.md` is still a runbook, not a completed backup. Supabase Pro was explicitly deferred. |
| Accessibility | Test keyboard use, focus, labels, contrast, screen readers and mobile zoom on search, sign-in, employer and deletion flows. Provide an accessible contact path and fix reported barriers. | Contact email exists; no WCAG conformance claim. |
| Country expansion | Review UK/EU privacy and marketing rules, Canadian privacy/CASL, and Indian requirements before expanding accounts, marketing or employer posting there. Map where each provider stores/processes data. | Global coverage has not been promised or legally cleared. |
| Paid plans | After entity and Stripe setup, review checkout disclosure, renewal/cancellation, taxes, refunds, receipts, failed payments and subscription verification for the $7.99 seeker and $14.99 employer plans. | Billing OFF by owner instruction. No paid terms or charge should be presented as active. |

## Current processor and external-service inventory to verify with the privacy owner

The repository references GitHub Pages for site hosting; Supabase for authentication, database and file storage; Google for OAuth and web fonts; jsDelivr for the browser Supabase library; Open-Meteo for location suggestions; Make and Apify for the existing Live Search path; Adzuna for licensed API listings; and Resend code for a **disabled** optional newsletter. This is a code inventory, not proof that every service is used on every page or that any processor agreement is complete. Verify actual production flows and locations before turning this into a public promise.

## Primary guidance used for this checklist

- [FTC CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [Canadian CRTC CASL FAQ](https://crtc.gc.ca/eng/com500/faq500.htm)
- [UK ICO privacy-information checklist](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/checklists/)
- [UK ICO storage and cookie guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/)
- [California Privacy Protection Agency notices explainer](https://cppa.ca.gov/pdf/general_notices.pdf)
- [US EEOC job-ad guidance](https://www.eeoc.gov/prohibited-employment-policiespractices)
- [FTC job-scam warning signs](https://consumer.ftc.gov/consumer-alerts/2024/07/looking-job-spot-scams)
