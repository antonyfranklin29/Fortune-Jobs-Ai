# Security, data integrity, capacity and launch status

Payments and Stripe account setup are explicitly deferred by the owner. Work moved to launch areas 6, 7 and 8; none is declared fully accepted in this report.

## Applied backend fix

Read-only authenticated SQL inspection found RLS enabled on all five public tables. Profiles, saved jobs and history had authenticated owner policies. Private resumes used authenticated owner-prefix storage policies; avatars were public but writes were owner scoped.

Critical finding: job_matches allowed unrestricted anonymous/authenticated INSERT through an INSERT policy with_check=true and table grants. Applied migrations/20261011_public_job_write_lockdown.sql on production: revoked INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on job_matches and pre_scraped_jobs from anon/authenticated. Existing public listing SELECT remains, and trusted service_role INSERT was checked before the change. No rows were removed and no credential was retrieved or changed.

Verified effective permissions: anon_insert=false; authenticated_insert=false; backend_insert=true; public_job_read=true; anonymous profile/saved/history read permissions=false. A real HTTP anonymous no-row POST to job_matches returned 401. One paid bounded Live Search still completed in 12,130 ms with nine rows. This proves the existing Make backend still writes after lockdown. The old permissive INSERT policy remains ineffective because the browser roles no longer have INSERT grants; do not restore those grants.

Authenticated RLS role simulation with a unrelated UUID returned zero visible profiles, saved jobs, history and private resume objects. This is not a full two-real-user test and does not prove every write path. Source listing reads remain public; current frontend search-ID filtering is not owner-enforced private result access.

## Frontend and governance changes

- Shared URL checks reject executable protocols, embedded credentials and control characters. Application links are validated and attribute escaped. Avatars are restricted to the configured public bucket and current owner's path.
- Avatar save failure removes only its new upload. Replacing a photo removes only the previously referenced owned photo, not every file in the owner's folder.
- Resume deletion conditionally clears the matching profile before file deletion. A failed profile change does not delete the file. Storage failure conditionally restores details without overwriting a different concurrent upload and reports unresolved cleanup honestly.
- Profile Download my data exports owner-scoped profile, saved jobs and paginated history, with no misleading partial export on error. Original file binaries are excluded.
- Added public privacy/contact information marked pre-launch. info@fortunejobsai.com is the owner's chosen address but is NOT created/verified; there is no active mailto link. Complete account deletion is explicitly unfinished.
- Removed unsupported homepage job/accuracy/category statistics and testimonials pending evidence. Replaced an unverified nightly-refresh claim. Footer privacy/contact/upload/category links now point to real pages.
- Added scripts/production-health.cjs, a read-only public asset check. No recurring monitor or alerts have been scheduled.
- Added docs/operations-and-governance.md with data inventory, support setup, recovery/incident procedures and remaining acceptance gates.

## Verification

56 automated tests passed, including URL/path restrictions, resume removal success/database failure/storage failure/concurrent replacement, paginated owner export and failure handling, plus the prior extraction/guest/search suites.

Fresh production Quick verification after lockdown: 30 sequential reads, zero technical failures, p95 440 ms. 100 simultaneous reads, zero technical failures, p95 1,665 ms, maximum 1,723 ms. Six accuracy cases passed. This is one-machine database/client processing, not 100 complete browser users or live scrapes.

## Remaining launch blockers

1. Supabase Free dashboard shows no backups. Implement restricted encrypted DB and Storage backups, separate off-site retention and a real isolated restore drill. Official backup documentation: https://supabase.com/docs/guides/platform/backups. No paid plan or private backup destination was configured.
2. Direct public Make webhook still needs a server admission/abuse gateway and controlled queue. Historical five-actor concurrency limit remains. No 100-Live-user overload/recovery or seven-day reliability acceptance has passed.
3. Complete designated-account cross-user storage/write/save/delete acceptance, orphan cleanup, account deletion and operator access/credential review. Privileged keys belong only on trusted servers.
4. Create and verify info@fortunejobsai.com, including outgoing replies and domain authentication. Finalize legal/privacy/retention choices with the owner. Public policy is an implementation description, not a legal compliance certification.
5. Complete monitoring alerts, mobile/accessibility/account-recovery pilot and deployment/restore drill. Keep robots/noindex until approved launch. Payments remain a separate deferred gate.

Rollback of frontend changes uses Git. Database permission rollback must not reopen anonymous result writing; fix backend credentials privately if a future workflow requires them. External SQL changes are not undone by frontend Git rollback.
