# Codex brief — Nov 17 2026: ready-to-send applications

## Why
Perplexity launched an AI job-search assistant: it matches roles, rewrites the résumé and writes a cover letter for each job, and tracks applications. It is a general paid agent, not student-focused, but students will now expect "ready to send" materials.

**We already have** the AI Coach on each job (`supabase/functions/ai-assist`, `react/src/seeker/AiTools.jsx`): `tailor_resume`, `fit_explain`, `interview_prep`, `skill_gap`, with daily limits (25 free / 50 Pro, `LIMITS` in tasks.ts) and the application tracker (`saved_jobs.stage`).

**The gap:** our tailored résumé appears as on-screen sections only. There is no cover letter, no file the student can submit, and nothing is kept with the job in the tracker.

## Build (one PR, branch `codex/ready-to-send`)

### 1. Cover letter task
- Add `cover_letter` to `TaskName` and `RESUME_TASKS` in `tasks.ts`, following the existing pattern: the `HONEST` and `DATA` rules, `jobXml` + `resumeXml`, and a tool schema.
- Output fields: `greeting`, 3–4 `paragraphs`, `closing`, and `not_supported` (requirements it chose not to claim).
- Keep it under 300 words, plain and specific, with no invented facts. Use `NO_DESCRIPTION` behaviour when the job text is missing.
- Add a "✉️ Write a cover letter" button to `JOB_TOOLS` in AiTools.jsx, plus a view.
- It counts against the same daily limit. No new limits.

### 2. Download and copy
- For the tailored résumé and the cover letter, add "Copy" and "Download .docx" buttons.
- Generate the file in the browser (e.g. the `docx` npm package, lazy-loaded so the main bundle doesn't grow). Use a clean one-column ATS-safe layout: no tables or columns, standard headings.
- The résumé .docx must merge the tailored sections with the person's own contact details and education from their profile. Never invent missing parts; leave a clearly marked placeholder instead.
- Do not send the file to any server.

### 3. Keep it with the job in the tracker
- When a signed-in user generates a tailored résumé or cover letter for a job they've saved (or saves the job then), store the latest version on that saved job. Use a new nullable `jsonb` column on `saved_jobs` (e.g. `materials`). Write the migration file only; **do not apply it**. Claude applies it after review.
- RLS: same owner-only policies as `saved_jobs` today.
- In the tracker, show "Résumé ✓ · Cover letter ✓" chips on the job card, with a link to re-open or download.
- Account deletion must remove this data. Check `delete-account` covers it.

### 4. Paste-your-LinkedIn shortcut (small)
- On the profile résumé field, add helper text: "No résumé file? Paste your LinkedIn 'About' and 'Experience' text here." No LinkedIn login or scraping.

## Rules
- Branch + PR only. Do NOT merge, deploy, apply migrations or change crons. Claude reviews and deploys after Franklin approves.
- No auto-applying or submitting anything on a user's behalf; the student always sends it themselves.
- Never add Google for Jobs / JobPosting markup.
- Copy: call it a "job portal". No "straight from employers" or "skip the middleman" claims. Don't use the tagline "Search U.S. jobs in every field…" anywhere.
- Tests: add unit tests for the `cover_letter` prompt/schema/`usable()` and for the .docx builder (contents, no placeholders filled with invented data). `npm test` has 32 known failures on main; don't add new ones.
- Keep the main bundle size flat: lazy-load the docx code.

## Reply with
The PR link, a screenshot of a job with both buttons, a sample .docx (from a test résumé), and the migration SQL.
