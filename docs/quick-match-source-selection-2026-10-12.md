# Quick Match refresh: source selection

Owner: Codex. Claude owns Live Search gateway/admission control. Do not modify Claude's gateway or shared frontend without coordination through Franklin.

## Verified starting point

Production read found exactly 657 pre_scraped_jobs rows, all country=us. Posting dates range from 2023-01-02 to 2026-10-08. Posting age does not by itself prove expiration. No refresh implementation exists in this repository. Earlier Kolkata test returned no saved India/Kolkata inventory; Live retrieved ten candidates in about fourteen seconds, of which five matched the requested role/location.

## Candidate assessment

1. Adzuna: strongest first candidate for a five-country evaluation. Official OpenAPI country enum includes us, gb, ca, de and in. Supports location hierarchy, pagination, category, date sorting and max_days_old. Publishing listings is a listed permissible use with mandatory per-advert linked Adzuna attribution. Default limits: 25/minute, 250/day, 1000/week, 2500/month. All limits apply together. Do not budget 250 requests every day for a month. API credentials and actual local coverage have not been obtained/tested. Confirm persistent storage/cache duration, matching, deduplication, refresh/expiry handling and subscription placement with the provider. Other commercial data uses have a limited evaluation provision; do not interpret the publishing permission as unrestricted data resale or research rights.

2. Careerjet: publisher program offers API and XML feeds. Search API requires actual triggering user IP/user-agent and referer. It is not a justified background-harvesting endpoint: request an appropriate XML/feed arrangement and confirm storage and display conditions. Do not fabricate visitor details. Pricing and five-country feed coverage remain unverified.

3. Jooble: country-specific keys are required. Official August 2026 docs state a total lifetime free quota of 500 requests per key. Not an adequate unlimited recurring source; discuss production access and caching/display terms before integration.

No source is activated or purchased. No application, email or agreement has been submitted. User asked for suitable-source research first and previously deferred LinkedIn/Indeed partnership applications.

## Official references

- https://developer.adzuna.com/overview
- https://developer.adzuna.com/swagger/spec/test2.json
- https://developer.adzuna.com/docs/terms_of_service
- https://www.careerjet.com/partners/publishers
- https://www.careerjet.com/partners/api
- https://www.careerjet.com/partners/api/javascript
- https://help.jooble.org/en/support/solutions/articles/60000922689-how-to-connect-to-the-jooble-rest-api-after-receiving-the-key
- https://jooblehelpcenter.freshdesk.com/en/support/solutions/articles/60001448238-rest-api-documentation

## Proposed Adzuna evaluation request (draft only)

Fortune Jobs AI is a pre-launch job discovery and resume-matching platform at https://fortunejobsai.com, targeting the United States, United Kingdom, Canada, Germany and India. Contact: info@fortunejobsai.com. Launch target: December 1, 2026. Payments are not currently enabled; the intended Pro subscription is $7.99/month.

We want to publish attributed job listings with the provided destination links and serve fast, location-aware search. Please confirm whether our use may include scheduled retrieval, temporary or persistent database storage, deduplication and skill/experience matching against user-provided profiles. What cache duration and removal obligations apply? May listings appear in our free results and subscription experience? What request allowance and commercial terms would support regularly refreshing coverage across states/provinces/regions in all five countries? Can job IDs and closure/expiry signals support reliable updates? We will preserve original posting dates and distinguish them from retrieval times.

We have not demonstrated regional coverage, secured credentials or received provider approval yet. Please describe account setup and any restrictions applicable to this implementation.

## Implementation after source confirmation

- Backend-only credentials; never re-enable browser writes or commit secrets.
- Source identity plus source job ID; original posting date, fetched/last-seen times and expiry separately.
- Country/location normalization preserves uncertain evidence instead of inventing cities or remote eligibility.
- Paginated retrieval, bounded request budget and provider-aware retry/backoff; no overlapping refresh writes.
- Validate staged records; transactional upserts. Failed/partial requests never clear the existing catalogue. A job missing from a paginated search is not proof of closure.
- Use explicit closure/expiry or documented revalidation policy; age alone is not a dead-link test.
- Region coverage/freshness report, source errors and stale-data notice; agree alert destination and schedule before activation.
- Source-specific attribution on cards according to terms, despite earlier preference to omit implementation-provider branding.
- Synthetic failure/idempotence/expiry tests, then bounded real five-country samples and repeated scheduled production refreshes.

Acceptance: real permitted-source refreshes are running, inventory/freshness measurable, rollback verified, and representative regional searches useful. A written plan, an API account or a manually imported batch is not completion.
