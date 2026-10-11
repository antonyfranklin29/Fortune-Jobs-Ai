# Résumé matching — October 11, 2026

Supported uploads: text-based PDF (up to 30 pages) and DOCX, nonempty and at most 5 MB. Extracted text is capped at 60,000 characters. Scanned, encrypted, malformed and legacy DOC files do not silently become readable résumés; the UI explains conversion/password requirements. OCR is not included.

Extraction runs locally using vendored PDF.js 6.4.299 and Mammoth 1.13.0, with licenses and PDF font/CMap resources. No résumé text, profile or user identity is included in the live-search webhook.

Users review and edit the extracted text, suggested skills, explicit years-of-experience statement and target job title before saving. Unknown fields remain blank. Saving updates the existing profile fields and uses a unique file path. A failed profile update cleans up only the new upload and preserves the prior résumé. Cancel does not write to storage or the database. No new database columns or access policies were introduced.

Quick Match and Live Search first apply the existing source-backed accuracy filters, then rank the remaining jobs using confirmed profile skill overlap in the original listing description/snippet/requirements. Reasons list evidenced skill matches; an explicit minimum experience requirement above the user's experience gets a caution. Missing evidence does not imply eligibility or a guaranteed fit. This is assistance for the job seeker, not employer screening. Ranking operates within the available candidate pool, with the existing ten-result free allowance.

Verification: automated regression, ranking and save-order/failure tests; actual synthetic PDF and DOCX extraction; isolated local browser review/cancel/save checks with mocked storage, not a real user's profile. Production candidate reads passed the same six accuracy cases. Production private storage permissions and authenticated save require separate end-to-end verification before calling this launch-ready; this work does not complete the security audit.

Live configuration inspection confirmed the resumes bucket is private, capped at 5 MB and allows PDF/DOCX MIME types; SELECT/INSERT/UPDATE/DELETE storage policies require the authenticated user's own first path segment. Profile SELECT/INSERT/UPDATE policies require auth.uid() = id. These are configuration checks, not a complete security audit.

Final automated suite: 35 passed (npm ci then npm test). Browser synthetic review/cancel/save passed. Post-change Quick Match benchmark: 30 sequential requests, zero failures, p95 589 ms; 100 simultaneous requests, zero failures, p95 1,401 ms. This is database-read performance from one machine, not 100 concurrent live scrapes.

Deployment b402ef7 succeeded. Production profile and all extraction/matching assets returned HTTP 200. The existing authenticated account's saved DOCX was downloaded from its private bucket through a signed URL and extracted in the live browser: 6,924 characters, with editable suggested skills. The draft was left unsaved for the account owner to review the title and experience. No private resume content or credentials were copied into this report. A real authenticated save remains an acceptance check; the synthetic browser save used mocks.
