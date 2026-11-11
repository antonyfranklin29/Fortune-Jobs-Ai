# City and role job pages

Run `node --test tests/job-seo.mjs` and `node scripts/build-job-seo.mjs` from the repository root. The builder reads the public catalogue and updates `jobs/` and `sitemap.xml`. Review the generated diff before release. City pages with fewer than five current listings stay out of the sitemap and use `noindex`.

Single-job pages add Google for Jobs markup after verifying that a direct employer listing is open and has a description, a physical U.S. location, a closing date and an HTTPS application link. City pages show listing summaries with source credit. Third-party jobs and email-only applications are outside the first markup release.

Regenerate when a direct posting opens or closes and on a regular cadence for city snapshots. The job page rechecks availability on every visit and omits structured data for closed or expired jobs. Regeneration removes obsolete single-job pages and sitemap entries. This PR uses a manual build and leaves scheduling and Indexing API setup for a future release. Check the first eligible public posting with Google's Rich Results Test before requesting indexing. [Google's job posting documentation](https://developers.google.com/search/docs/appearance/structured-data/job-posting)
