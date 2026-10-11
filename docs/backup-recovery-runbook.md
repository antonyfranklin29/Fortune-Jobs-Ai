# Backup activation and recovery

Status October 11, 2026: tooling prepared and tested with synthetic files only. No real backup, external destination, schedule or restore drill is active. Payments integration remains deferred.

Recommended setup: Supabase Pro daily database backups plus a separate encrypted copy of private resumes and avatars outside the live project. Database backups exclude Storage file objects. Pro starts at $25/month, with seven days of daily backups; usage can add charges. Sources: https://supabase.com/docs/guides/platform/backups and https://supabase.com/pricing.

## Activation

1. Owner activates the managed database backup plan in Supabase and confirms the first successful backup. Do not buy point-in-time recovery initially without an actual requirement.
2. Provision an operator-only backup workspace outside this repository, on an encrypted device with restricted OS access. On Windows, Node's mode flags do not enforce Windows ACLs: explicitly restrict folder access to the operator and administrators. Keep extraction and restore directories away from shared/synced public folders.
3. Use Supabase's supported Storage CLI or S3 tooling to export **both** resumes and avatars recursively, preserving bucket/path structure. Configure credentials directly in the operator environment, never in chat, browser source or Git. Download documentation: https://supabase.com/docs/guides/storage/management/download-objects. Record object counts and sizes, and compare them with downloaded files. Freeze changes or reconcile uploads/deletions during collection; this encryption tool does not make a consistent remote snapshot or download objects itself.
4. Generate an independent random 32-byte key in a secure secret manager. Provide its 64-character hex value through `FJ_BACKUP_KEY` only for the command process. Store a recovery copy separately from backups, with controlled emergency access. Losing this key makes recovery impossible. Do not reuse the Supabase service credential as an encryption key.
5. Run `node scripts/private-backup.cjs backup SOURCE NEW_ARCHIVE_DIRECTORY`, then `node scripts/private-backup.cjs verify ARCHIVE_DIRECTORY`. Files and the manifest are AES-256-GCM encrypted with independent random nonces; paths are only inside the encrypted manifest. Completion requires a verified manifest. Existing output folders are refused. Individual files are limited to 64 MB: this tool is for uploaded files, not large database dump streaming.
6. Copy only the encrypted archive to a private external backup destination with least-privilege access, versioning and separate recovery credentials. Re-download that copy and verify it. Neither destination nor provider has been provisioned. Keep plaintext staging only until verification under an agreed deletion policy; do not promise secure erasure on SSDs.
7. Suggested initial retention: daily file copies for 30 days, with restricted access and deletion propagation documented. This is a proposal, not an enforced policy. Confirm retention in the final privacy review. Set up scheduled collection, encryption, verification and failure alerts once infrastructure and credentials exist; no scheduler is activated by this change.

## Isolated recovery drill

1. Use a separate Supabase test project. Never rehearse by overwriting the live database.
2. Restore the database using the documented Supabase recovery process. Keep the recovered project isolated from real email, payments and production webhooks.
3. Re-download the off-site archive and verify it with the independent recovery key. Run `node scripts/private-backup.cjs restore ARCHIVE_DIRECTORY NEW_ISOLATED_DIRECTORY`. This authenticates every file before output and refuses existing destinations. Use an operator-controlled directory; do not allow another process to alter source/output paths during operation.
4. Upload recovered files into the test project's matching buckets and paths; recreate private/public bucket settings, MIME/size limits and owner policies. Exported file bytes alone do not capture all bucket configuration. Verify manifests/counts/hashes, authorized resume downloads, forbidden cross-account access, profile links and representative Quick searches.
5. Record successful backup time, restore duration, reconciliation gaps and missing objects. Proposed initial targets are 24-hour recovery point and four-hour recovery time; accept only after measurements. No such targets have been demonstrated yet.
6. Follow the account-deletion/retention policy when restoring: do not silently resurrect previously deleted user data. Maintain a restricted deletion ledger as part of operational recovery design before launch.

Tests cover synthetic round trips, wrong keys, corrupted ciphertext, overwrite refusal and path validation. They do not prove real database recovery, remote snapshot completeness, off-site access or scheduled reliability.
