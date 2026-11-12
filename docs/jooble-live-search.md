# Jooble live search

Jooble's public API portal describes showing results for user searches. Its public website terms reserve republication rights, and the public API materials reviewed did not grant permission for a persistent listings catalogue. This integration requests results only after a visitor chooses Jooble. It keeps the original click link and stores no listings in the database or search cache. [API portal](https://jooble.org/api/about) · [Public terms](https://jooble.org/info/terms)

Jooble documents 100 requests per day per key on the free U.S. plan. The button makes one request per eligible search per page visit, and the edge function includes local burst protection. The account-wide limit is enforced by Jooble. This integration sends search keywords and selected location, with no visitor IP or browser user-agent in the provider request. [REST API documentation](https://help.jooble.org/en/support/solutions/articles/60001448238)

When release is approved, deploy `jooble-search` with `--no-verify-jwt` using the existing `JOOBLE_API_KEY`. Release the React site and Privacy Policy together. Confirm that one U.S. search shows the provider credit and its original link and that a provider failure leaves the main results available. Avoid logging upstream request URLs, which contain the API key.
