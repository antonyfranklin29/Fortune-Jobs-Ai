# Launch audit — 31 October 2026

Read-only checks run against the public site and public Supabase catalogue at approximately 02:02 UTC on November 1 (October 31 Eastern). No paid search, ingest request or account mutation was made.

## Catalogue and public site

- All ten checked public pages and shared assets returned HTTP 200. This is availability evidence, not a complete user journey.
- 4,190 open public listings; 3,802 posted within 30 days; at least one recent listing in each of the 50 states. Latest source sighting was 0.9 hours old.
- Sources: 3,513 Adzuna, 540 legacy Dice, 137 legacy Indeed. The older sources are not being refreshed.
- The quality audit (`node scripts/catalogue-quality.mjs`) found zero missing titles, one missing company, 109 unclassified roles and 63 rows without a state code. Some rows may be remote or outside the United States; inspect before changing them.
- All 3,513 Adzuna rows have a saved description and an HTTPS application link. All 677 legacy Dice/Indeed rows lack a saved description. Two Indeed rows (public IDs 753 and 767) have HTTP application links. Link syntax was checked; destination pages and final redirects were **not** visited, so this does not certify every listing is still open.
- 2,826 listings have a local or exact-name Logo.dev mapping. This is name mapping, not a guarantee that every CDN image loads or that the employer has verified the posting. Unknown/ambiguous names correctly retain an initial.
- 343 occupied role/state cells have fewer than five listings. Data Analyst has 457 nationwide but only one each in Kentucky and Indiana. State coverage therefore does not imply strong coverage for a specific role in a specific state.

## Security and recovery

- Unauthenticated POST requests to `delete-account`, `employer-submissions` and `email-preferences` were refused with HTTP 401. This is a narrow smoke check; it does not replace a signed-in cross-account review.
- Focused local tests for data safety, company logos, featured jobs, search accuracy and backup encryption all passed: 28/28.
- The Supabase CLI can see the active Fortune Jobs AI project. No database password, private Storage export, independent encryption key, off-site backup location or isolated restore target was available to this run. The real backup and restore gate remains open. `scripts/private-backup.cjs` only encrypts already downloaded files; it cannot by itself capture the live database or Storage objects.
- Supabase Free's leaked-password protection and managed backup limitations still need an owner decision. Do not claim recovery readiness from synthetic encryption tests.

## Next actions

1. Live Search: Claude is checking the Make path. Keep the site paused until the corrected webhook URL, keyed dry run, guarded real test and Make marker are verified.
2. Job quality: remove or replace the two HTTP legacy links after checking their destinations; avoid displaying a fabricated description for the 677 legacy rows. Continue employer identity review for unmapped logos and sample final apply destinations with a controlled audit.
3. Recovery: choose an encrypted off-site destination and independent recovery-key custody, export the database and private files, then restore into a separate project. Record counts and elapsed time.
4. Employer: appoint an independent reviewer and run a real end-to-end company and post pilot.
5. App: recommend a staged installable web app first, reusing the functioning mobile website. A native-store launch needs separate developer accounts, authentication redirects, privacy/store review and a different release date. No app shell exists yet.

Stripe and paid subscriptions stay deferred until incorporation and legal review. The December 1 target is for the website; this audit does not claim the gates above are closed.

## Live Search decision later tonight

Claude verified that the Supabase `MAKE_LIVE_WEBHOOK_URL` fingerprint differs from the gateway-only Make webhook. Codex prepared the exact Make URL in Supabase, but Franklin declined the irreversible replacement confirmation. The prepared tab closed without saving. The secret remains unchanged; no dry run, Apify run, Make activation or site switch followed. Claude was told to hold. Live Search therefore remains a launch blocker until Franklin decides to authorize a correction and the guarded end-to-end test passes.

**Superseded later October 31:** Franklin saved the correct URL himself. Supabase now shows the expected `770372c7` digest, and Claude documented a successful keyed dry run. The Make shared key still needs an approved real dispatch to verify; the site remains paused. See `docs/live-search-cutover-checklist-2026-10-25.md` for the current sequence.
