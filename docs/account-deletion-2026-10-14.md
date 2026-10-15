# Self-service account deletion

Owner: Claude. Google sign-in, newsletters, payments and Live Search behaviour
are untouched. `login.html`, `account-flow.js` and the sign-in flow belong to
Codex and were read only.

## What the inspection found

The important discovery is which data is **not** protected by a cascade.

| Table | Foreign key to `auth.users` | On delete |
| --- | --- | --- |
| `public.profiles` (`id`) | yes | **CASCADE** |
| `public.saved_jobs` (`user_id`) | yes | **CASCADE** |
| `public.search_history` (`user_id`) | yes | **CASCADE** |
| `storage.objects` | **none** | nothing happens |
| `live_search_admissions.account_id` | **none** | nothing happens |

So deleting the auth user already removes the three public tables by itself.
It does **not** remove résumés or avatars, and it does **not** unlink the
account id recorded against Live Search admissions. Without this function, a
deleted account would leave its résumé file in storage indefinitely — which is
the single most sensitive artefact a user leaves with us.

RLS is sound and owner-scoped throughout: `profiles` allows select, insert and
update of one's own row but **no delete**, which is why a profile cannot be
removed from the browser and why this work needs a server-side component at all.
Storage policies scope both buckets by the `<uid>/` first path segment.

Buckets: `resumes` is private (5 MB, PDF/DOC/DOCX); `avatars` is **public**
(2 MB, images) — an avatar URL is readable by anyone holding it, so removing the
object is what actually protects the user.

## What was built

Edge Function `delete-account`, version 1, deployed.

    POST https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/delete-account
    Authorization: Bearer <the caller's access token>
    { "confirm": "DELETE MY ACCOUNT", "email": "<their own email>" }

**Identity comes only from the token.** The body cannot name a user. The caller
is resolved by calling `/auth/v1/user` with their token; a body field such as
`user_id` is ignored entirely. That is what stops one account deleting another.

**`verify_jwt` is off deliberately, and this is stricter rather than weaker.**
The platform check accepts any token this project signed — including the
publishable anon key, which is a JWT and ships in `config.js`. Resolving the
user in the handler rejects it. Leaving the platform check off also keeps the
CORS preflight working, since an `OPTIONS` request carries no `Authorization`.

**Recent authentication required.** Freshness is read from the token's `amr`
claim, which records when the user actually authenticated, not when the access
token was last refreshed — a token silently refreshed an hour later does not
count as recent. Outside 15 minutes the reply is `401 reauth_required` and the
page should send them through sign-in again.

**Explicit confirmation.** The exact phrase `DELETE MY ACCOUNT` plus the
caller's own email address typed back. Neither value can select a different
account; they only confirm the one the token already identifies.

### Order of operations, and why

1. `resumes/<uid>/*`
2. `avatars/<uid>/*`
3. `saved_jobs`
4. `search_history`
5. `live_search_admissions` — `account_id` set to null, rows kept
6. `profiles`
7. **the auth user, last**

The auth user goes last on purpose. If any earlier step fails the function stops
and returns `409 incomplete` with `retryable: true` and a per-step breakdown —
the account still works, so the person can sign in and try again. Deleting the
auth user first would strand whatever remained with nobody able to ask for it
again. Every step is an idempotent delete, so a retry resumes rather than
breaking, and the cascade finds nothing left to do.

Live Search admissions are **unlinked, not deleted**: those rows are capacity and
cost accounting. Removing them would corrupt the rate-limit history; nulling
`account_id` removes the person from them. Nothing about Live Search behaviour
changes.

## Test evidence

### Authentication gate — live against the deployed function

| Attempt | Result |
| --- | --- |
| No `Authorization` header | 401 `not_authenticated` |
| Malformed token | 401 `not_authenticated` |
| Empty bearer | 401 `not_authenticated` |
| **The site's publishable anon key as the bearer token** | **401 `not_authenticated`** |

The anon key probe matters: it is a genuine project-signed JWT
(`key_is_jwt: true`), so a function relying on `verify_jwt` alone would have
accepted it. Each attempt also carried `user_id` for another account in the
body; it was ignored in every case.

### Scoping — seeded and evaluated in a transaction that was rolled back

The three cascading tables are scoped by the foreign key, so the risk sits in
the two relations with no key. Both were seeded for a victim and a bystander,
including adversarial object names:

| Check | Result |
| --- | --- |
| Objects the `<uid>/` filter matches | 2 — exactly the victim's `cv.pdf` and `pic.png` |
| Bystander objects caught by that filter | **0** |
| `…bystander/…victim…/cv.pdf` (contains the victim's id) | not matched |
| `…victim-evil/cv.pdf` (prefix-adjacent) | not matched |
| Admissions rows the `account_id` filter matches | 1 — the victim's only |
| Bystander admission caught by that filter | **0** |

Nothing was deleted and nothing persisted.

## Blocker: the signed-in half is untested

Creating accounts and entering passwords is outside what I will do, and the
exception for a developer's own application covers local development hosts
only — not the live site. So these paths are **implemented but unproven**:

- a valid user token completing a deletion end to end
- `reauth_required` firing on a session older than 15 minutes
- `confirmation_required` and `email_mismatch` with a real token
- a retry after a forced partial failure

Tony can close this in a few minutes with two disposable accounts. Sign in as
each, open the browser console on `fortunejobsai.com`, and run:

```js
const { data } = await FJ.sb.auth.getSession();
await fetch('https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/delete-account', {
  method: 'POST',
  headers: { 'content-type': 'application/json',
             authorization: `Bearer ${data.session.access_token}` },
  body: JSON.stringify({ confirm: 'DELETE MY ACCOUNT', email: '<that account\'s email>' })
}).then(r => r.json()).then(console.log);
```

Worth running in this order: wrong email (expect `email_mismatch`), wrong phrase
(expect `confirmation_required`), the second account's email while signed in as
the first (expect `email_mismatch` — the token decides, not the body), then the
real one. No real user should be used.

## Not yet applied

- **Profile UI.** A danger-zone section in `profile.html` with the typed
  confirmation. Held back because Codex is working in the account files; the
  diff goes to Tony before it is applied.
- **Privacy policy.** `privacy.html` currently says "A complete self-service
  account deletion feature is not available yet," which stays accurate until the
  UI ships. The replacement wording is prepared and applied in the same change,
  so the policy never claims a control the page does not offer.
