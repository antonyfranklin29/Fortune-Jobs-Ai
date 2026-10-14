# Account sign-in implementation and activation

Website integration built for email/password, Google OAuth and Apple OAuth through Supabase. Google/Apple remain disabled in production provider settings; their buttons are disabled by default, enabled only when settings confirm availability, and show an email fallback. An iCloud email address can use ordinary email registration without Sign in with Apple.

Changes: safe local-page return destinations; OAuth returns through login.html for session/error handling; generic callback errors without echoing provider descriptions; missing/expired reset links return to request-link mode; reset requires a current session before updating; provider settings timeout/fail closed; password visibility resets between modes; sign-in tabs expose selected state; duplicate OAuth clicks blocked while request is pending; privacy/help links added. No provider secret is in browser code. Existing Supabase implicit session handling is preserved.

Verification: automated redirect, provider settings, OAuth wiring/failure and form-mode tests; local browser confirms disabled Google/Apple with explanations and expired reset fallback. Real email delivery, real registration/recovery and successful OAuth account creation/linking remain unverified. User reports neither provider account is set up. Do not mark social login complete based on buttons/tests alone.

## Google setup

Official guide: https://supabase.com/docs/guides/auth/social-login/auth-google

- Owner creates/selects a Google Cloud project and Google Auth Platform app for Fortune Jobs AI.
- Configure external audience, support contact and truthful branding. Testing mode allows only configured test users; public access needs the appropriate publishing/verification steps.
- Request only openid, userinfo.email and userinfo.profile scopes. No Gmail inbox access.
- Create a Web application OAuth client. Origin: https://fortunejobsai.com. Supabase callback: https://hqgakkcxcyspqhnlnscv.supabase.co/auth/v1/callback (confirm dashboard value).
- Owner enters client ID/secret directly into Supabase Authentication → Sign In / Providers → Google and enables it. Do not post secrets in chat or Git.
- Supabase Site URL: https://fortunejobsai.com. Review redirect allowlist for login.html callbacks with next query and login.html?mode=reset, using narrowly scoped patterns; preserve existing profile confirmation destinations until old email links expire.
- Test new and existing accounts, cancel/back, disabled provider, profile ownership and sign-out. Do not assume accounts sharing an email safely merge until verified.

## Apple setup

Official guide: https://supabase.com/docs/guides/auth/social-login/auth-apple

- Requires owner Apple Developer setup and Services ID associated with Sign in with Apple. Do not buy enrollment without explicit approval of the terms/cost.
- Configure domain and Supabase callback according to Apple's instructions; owner keeps signing key private and enters generated client secret directly into Supabase Apple provider.
- Web OAuth secret renewal is required every six months. Establish renewal ownership and reminders before launch.
- If supporting Hide My Email, configure permitted outbound email sources with Apple and verify messages reach relay addresses. Do not assume Microsoft 365 support mail is automatically authorized by Apple.
- Test normal and private-relay addresses, first login/name behavior, repeat login, cancellation and Apple devices. Keep button disabled until setup and tests succeed.

## Remaining email acceptance

Test registration/confirmation and reset with designated accounts, verify custom SMTP delivery/limits, inspect redirect configuration, and confirm password policy and abuse controls. Ordinary existing email functionality has not been replaced. No emails were sent or credentials changed during this implementation.
