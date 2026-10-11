# Operations and data governance

Owner: Franklin. Launch target: December 1, 2026. Payments remain deferred at the owner's request.

## Current data inventory

| Data | Purpose and location | Current control |
| --- | --- | --- |
| Guest resume document | Browser extraction only | Not uploaded to resume storage |
| Guest reduced matching details | sessionStorage, two-hour expiry | Clear in editor/results; opaque match ID |
| Account identity | Supabase Auth | Auth session; account deletion not yet implemented |
| Profile and extracted resume text | Supabase profiles | Owner-only RLS; editable; resume text cleared with removal |
| Original account resume | Private resumes bucket | Owner-prefix RLS; 5 MB limit; signed URLs last 120 seconds |
| Avatar | Public avatars bucket | Owner-only upload/mutations; publicly accessible file URL |
| Saved jobs and search history | Owner rows in Supabase | Owner-only RLS; removal/clear controls; account-data export |
| Job catalogue and live result rows | Public listing database | Public reads; browser writes revoked October 11 |
| Query/location/filter settings | Live workflow and geocoding services | No full resume or profile identity in live webhook |

Account data currently has no automated expiry. Do not claim a 30-day retention policy is enforced. Deletion of real user data or changing retention requires a reviewed procedure and owner decision. Operational provider logs and backup retention need explicit review before publishing a final policy. Public privacy/contact pages explicitly describe their pre-launch status.

## Support and requests

Planned public email: info@fortunejobsai.com. Mailbox NOT created or verified. No working mailto link is published. Owner must provision a mailbox or dependable forwarding plus reply capability, configure SPF/DKIM/DMARC, and verify incoming/outgoing mail before launch. Do not send real resumes or identity documents to an unverified mailbox.

Account export: profile Download my data; includes extracted text, saved jobs and paginated history, excluding file binaries. Removal: owned resume deletion detaches the matching profile conditionally before storage cleanup, restores details on storage failure without overwriting another upload, and reports failures. Complete account deletion, orphan-file cleanup and designated-account end-to-end tests remain outstanding.

## Recovery and backups

Supabase dashboard currently shows Free plan and no backups. No recovery capability is accepted based on source Git commits alone. Official guidance: https://supabase.com/docs/guides/platform/backups. Free projects require regular exports; paid daily database backups do not include Storage file objects.

Required recovery implementation: encrypted database exports plus separate private file backups, off-site destination with restricted access, chosen retention, and restore drill in an isolated project. Do not put private exports or connection strings in Git. RPO/RTO targets must be chosen by the owner and demonstrated, not assumed. Manual CLI exports require a secure database credential, and automatic managed backup plans require an owner billing decision. No credential was retrieved or plan purchased during this pass.

## Incident response

1. Record incident time, affected search IDs, status codes and quota signals. Redact tokens, resume text and private contact details.
2. If scraping fails or credits/capacity are exhausted, stop new paid Live work and keep Quick Match available using LIVE_SEARCH_PAUSED. Publish an honest availability notice.
3. Inspect Make execution status, Apify concurrent-run limits and Supabase health. Do not retry uncontrolled bursts.
4. Roll back frontend via a reviewed Git revision. External Make and database changes have separate rollback requirements. Never re-enable public result insertion as a convenience fix.
5. Verify bounded Quick and Live searches after remediation, and document the cause and fix. In a suspected credential exposure, have the owner rotate it in the service, remove leaked copies and check access logs.

## Monitoring and capacity acceptance

Run `node scripts/production-health.cjs path/to/report.json` for public asset checks. This is a smoke-check tool, not a scheduled monitor or alert system. Scheduling and alert destinations remain unset.

October 11: 30 Quick reads with zero errors, p95 440 ms; 100 simultaneous Quick reads with zero errors, p95 1,665 ms. These exclude browser rendering/global traffic and do not simulate 100 live scrapes. One Live search after DB permission lockdown returned nine jobs and completed in 12,130 ms.

Apify historically allows five concurrent actor runs; Make's 100-start/minute setting does not change this. Before accepting 100 simultaneous Live users, implement a server admission queue/rate limits and shared safe search caching, define waiting/cancellation behavior and budget caps, test overload recovery, and collect production reliability evidence. The directly callable public Make webhook still needs an abuse-prevention gateway. Search result reads are public listing reads scoped by search ID in the client, not a private owner-enforced result API.

## Release gates

- Backend public write lockdown applied and verified; every security change has evidence and rollback considerations.
- Cross-account storage/profile/saved/history tests with designated test accounts; full account deletion and file cleanup accepted.
- Backup destination, real backup and isolated restore drill complete.
- Public mailbox receives/replies reliably; final privacy/contact policy aligns with actual retention and processors.
- 100-user Live admission/load/recovery test and monitored costs accepted; seven-day reliability review.
- Registration/recovery/mobile/accessibility review and useful monitoring/alerts complete.
- Payments remain a later launch gate. Ten-result cap and subscription offer are not billing implementation.
- Remove noindex/robots disallow only when the owner approves public launch; December 1 is a target, not an automatic approval.

## Verification evidence

Local task work directory: security-configuration-audit-2026-10-11.json (before), security-effective-permissions.json (after), security-live-after-lockdown.json, quick-match-security-check.json. No private row contents or backend credentials are included in these reports. Authenticated RLS role simulation with an unrelated UUID returned zero profile, saved job, history and private-file rows. This is not a substitute for a full two-real-account end-to-end test.
