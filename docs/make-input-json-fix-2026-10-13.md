# Make actor input JSON fix

Applied to live Integration Webhooks scenario 4555354, Apify Run an Actor module 4. Only the Input JSON mapping was changed. Actor kaix~indeed-scraper, ten candidates, basic mode, $0.10 maximum actor charge, synchronous execution and 120-second timeout were preserved. Scenario remained Active.

Previously dynamic keyword and location were interpolated raw inside JSON strings. Quotes, backslashes or newlines could invalidate the document. Make officially documents `escapeJSON(text)` for raw JSON string escaping: https://help.make.com/text-and-binary-functions. `toJSON` was not adopted.

Saved expression (Make's mapping keys are case-sensitive: `2.result`, displayed as Result):

```text
{"keyword":"{{escapeJSON(trim(2.result))}}","location":"{{escapeJSON(1.location)}}","country":"{{escapeJSON(replace(upper(ifempty(1.country; "US")); "GB"; "UK"))}}","maxItems":10,"searchMode":"basic","proxyConfig":{"useApifyProxy":true}}
```

The quotes inside mapping expressions are Make string literals. They are evaluated before the actor receives JSON. `escapeJSON` escapes the string contents; it does not replace the enclosing JSON quotation marks. Country is escaped too: upper()/replace() do not prove input contains only letters. Country allowlisting remains a gateway validation concern.

Verification: module mapping tokens were recognized, module saved, scenario saved, and scenario reload showed edit events. One production statewide search (Data Analyst, New Jersey, country us, location_scope region) completed successfully in Make in 12 seconds, execution 5b091b55468b421ba074959b226fa0f4. Live website displayed six matching jobs in Trenton, Dover, Skillman, Eatontown, Camden and Newark. This resolves the previously observed marker-only NJ result in that retest.

Only one normal Live Search was run after the change. No high-load test, arbitrary special-character end-to-end test or replay of incomplete executions was performed. Three historical incomplete executions remain for separately bounded replay. No actor/Make credentials were read, no subscriptions purchased and no gateway cutover performed.

Remaining: keyword normalizer output should be a bare phrase; error handlers must distinguish source failure from a successful empty search instead of reporting both as no matching jobs. This change fixes serialization, not catalogue freshness or five-country coverage.
