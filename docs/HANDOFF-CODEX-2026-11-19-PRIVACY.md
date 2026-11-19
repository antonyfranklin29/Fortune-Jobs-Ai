# Codex brief — Nov 19 2026: plain-language privacy section

## Why
Universities and partners (GW, UC Irvine, Jobg8) ask how we handle student data. The privacy page (`react/src/info/InfoPages.jsx`) doesn't plainly say what we do and don't do. Franklin wants a short, honest "Your data, in plain words" section at the top of the privacy page, so we can quote it in emails and forms.

## Step 1: audit first (don't write anything you can't point to in code)
List, with file/line evidence, everything below. Put the list in the PR description.
- **Collected:** account email (Supabase Auth); profile fields; résumé (is the file or its text ever stored server-side? the ATS check runs in the browser, so confirm); search history; saved jobs/tracker; AI usage; job-alert settings; newsletter; employer accounts.
- **Processors / third parties** that receive any personal data: Supabase (database/auth), Stripe (payments), Anthropic (AI coach requests — what's sent?), email sender (account emails/alerts), Cloudflare Web Analytics, anything else (Make, fonts, CDNs).
- **Tracking:** any ad pixels, Meta/Google tags, or third-party cookies? (Expect none; confirm.)
- **Retention and deletion:** what `delete-account` removes, and what stays (e.g. Stripe records kept for tax/legal).

## Step 2: the section (only statements the audit confirms)
Add near the top of the privacy page, under a heading **"Your data, in plain words"**, about 6–8 bullets. For example (edit to match the audit):
- We don't sell your personal information, and we don't share it for advertising.
- The ATS résumé check reads your file in your browser. [only if confirmed]
- We store what you choose to save: your account email, saved jobs, tracker stages and alert settings.
- When you use the AI coach, the relevant résumé and job text is sent to our AI provider to produce the answer. [match the audit]
- Payments are handled by Stripe; we never see or store card numbers.
- You can delete your account at any time from your profile; this removes your saved data from our database. [match delete-account]
- Questions: info@fortunejobsai.com.

"We don't sell your personal information" is Franklin's policy decision (approved Nov 19 when he asked for this section). Include it only if the audit finds no sale or ad-sharing of personal data anywhere.

## Rules
- Branch `codex/privacy-plain-words` + PR only. Do not merge or deploy.
- Plain English, short sentences. No legal claims you can't back (no "GDPR compliant", "HIPAA", "bank-level security").
- Don't name Franklin or publish the EIN or tax/entity IDs. The "operated by YOU DO LMS INC." line and the Somerset mailing address already on the page stay as they are.
- Wording: "job portal", not "U.S. job site".
- Keep the rest of the policy unchanged except where the audit shows it is wrong. If so, list each correction in the PR.

## Reply with
PR link + the audit list.
