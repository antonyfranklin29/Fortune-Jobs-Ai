# First-party acquisition funnel — proposed, not activated

Migration: migrations/pending/20261124_seo_funnel.sql. Apply only after Franklin approves. No cron, secrets, billing code or production data were changed.

## Meaning

`select * from public.seo_funnel_weekly order by landing_week desc, signups desc;`

Service-role/owner SQL only. Grouping uses the UTC week of the first measured tab-session landing, its allowlisted public path, coarse referrer source and existing campaign source. Metrics: landing_sessions, searched_sessions, searches (distinct tracked combinations per tab, reloads deduplicated), signups (new auth accounts, not necessarily confirmed), pro (first active live Pro subscription (an activation count, not a revenue figure), excludes test mode/trials/expired periods). Canceled customers remain first-conversion counts. Do not interpret the ratios as a strict ordered experiment: a visitor can sign up before searching, and multiple accounts may share one session.

First path wins; query strings, fragments and arbitrary/private paths are discarded. Referrer is a small known-domain bucket or other/direct, never a full URL. No raw search, resume text, IP, user-agent or new third-party pixel is stored. Random tab identifiers expire after seven days and are not cross-device identities. GPC and DNT disable new collection; inaccessible storage or missing RPCs fail open. Counts omit blocked/cross-device activity and are client-declared, not billing authority.

Email signup carries the minimized first-touch context in auth metadata; an insert trigger copies it once. OAuth returns can attach the current tab context only within 24 hours of account creation. Existing accounts cannot be reattributed. Deletion cascades through account-linked attribution and conversions. First-touch auth metadata remains with the account until deletion; raw session/search/attribution records have a service-only 90-day prune procedure. Anonymous event writes have a 300/minute global ceiling and 60 searches/session; telemetry tables and aggregates have no public or ordinary-user read access.

## Release / Franklin

Review and approve the SQL, then deploy client code using the normal release process. Test email and Google signup with disposable accounts, GPC/DNT, a search reload, a test subscription (must NOT count), and an approved live conversion only when separately authorized. No paid test was run here.

Agree who will run `select public.seo_funnel_prune();` regularly before promising retention dates. No maintenance schedule has been installed. The aggregate is a rolling retained-data report, not permanent history. Historical traffic and existing subscriptions are not backfilled.
