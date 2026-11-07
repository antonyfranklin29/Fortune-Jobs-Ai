// Company career boards we read. [provider, board slug, display name].
// Each slug was checked against the provider's public feed (see `checked`); a board that
// starts failing is reported by the worker and should be removed here.
export const checked = '2026-11-07';
const B = (provider, slug, name) => ({ provider, slug, name });
export const BOARDS = [
  // Greenhouse
  ...[
    ['stripe', 'Stripe'], ['airbnb', 'Airbnb'], ['databricks', 'Databricks'], ['coinbase', 'Coinbase'],
    ['robinhood', 'Robinhood'], ['lyft', 'Lyft'], ['dropbox', 'Dropbox'], ['figma', 'Figma'],
    ['discord', 'Discord'], ['reddit', 'Reddit'], ['instacart', 'Instacart'], ['doordashusa', 'DoorDash'],
    ['pinterest', 'Pinterest'], ['gitlab', 'GitLab'], ['cloudflare', 'Cloudflare'], ['datadog', 'Datadog'],
    ['mongodb', 'MongoDB'], ['elastic', 'Elastic'], ['twilio', 'Twilio'], ['okta', 'Okta'],
    ['asana', 'Asana'], ['airtable', 'Airtable'], ['gusto', 'Gusto'], ['brex', 'Brex'],
    ['samsara', 'Samsara'], ['affirm', 'Affirm'], ['chime', 'Chime'], ['duolingo', 'Duolingo'],
    ['roblox', 'Roblox'], ['squarespace', 'Squarespace'], ['toast', 'Toast'], ['anthropic', 'Anthropic'],
    ['scaleai', 'Scale AI'], ['vercel', 'Vercel'], ['flexport', 'Flexport'], ['carta', 'Carta'],
    ['betterment', 'Betterment'], ['oscar', 'Oscar Health'], ['peloton', 'Peloton'], ['confluent', 'Confluent'],
    ['netlify', 'Netlify'], ['grammarly', 'Grammarly'], ['hubspot', 'HubSpot'], ['zscaler', 'Zscaler'],
    ['snowflakecomputing', 'Snowflake'], ['nerdwallet', 'NerdWallet'], ['sofi', 'SoFi'], ['marqeta', 'Marqeta'],
    ['block', 'Block'], ['etsy', 'Etsy'], ['yext', 'Yext'], ['datarobot', 'DataRobot'],
    ['alteryx', 'Alteryx'], ['fivetran', 'Fivetran'], ['dbtlabsinc', 'dbt Labs'], ['hashicorp', 'HashiCorp'],
    ['pagerduty', 'PagerDuty'], ['newrelic', 'New Relic'], ['sumologic', 'Sumo Logic'], ['crowdstrike', 'CrowdStrike'],
    ['sentinelone', 'SentinelOne'], ['tanium', 'Tanium'], ['rubrik', 'Rubrik'], ['cohesity', 'Cohesity'],
    ['nutanix', 'Nutanix'], ['purestorage', 'Pure Storage'], ['appian', 'Appian'], ['servicetitan', 'ServiceTitan'],
    ['zillow', 'Zillow'], ['wayfair', 'Wayfair'], ['chewy', 'Chewy'],
    ['spacex', 'SpaceX'], ['anduril', 'Anduril'], ['waymo', 'Waymo'], ['nuro', 'Nuro'],
    ['intercom', 'Intercom'], ['zendesk', 'Zendesk'], ['mixpanel', 'Mixpanel'], ['amplitude', 'Amplitude'],
    ['twitch', 'Twitch'], ['epicgames', 'Epic Games'], ['unity3d', 'Unity'], ['niantic', 'Niantic'],
    ['calendly', 'Calendly'], ['webflow', 'Webflow'], ['postman', 'Postman'], ['launchdarkly', 'LaunchDarkly'],
    ['sigmacomputing', 'Sigma Computing'], ['thoughtspot', 'ThoughtSpot'], ['dataiku', 'Dataiku'], ['anaplan', 'Anaplan'],
  ].map(([s, n]) => B('greenhouse', s, n)),
  // Lever
  ...[
    ['palantir', 'Palantir'], ['plaid', 'Plaid'], ['spotify', 'Spotify'], ['netflix', 'Netflix'],
    ['kraken', 'Kraken'], ['attentive', 'Attentive'], ['zoox', 'Zoox'], ['outreach', 'Outreach'],
    ['highspot', 'Highspot'], ['mux', 'Mux'], ['quizlet', 'Quizlet'], ['eventbrite', 'Eventbrite'],
    ['wealthfront', 'Wealthfront'], ['lucidmotors', 'Lucid Motors'], ['shieldai', 'Shield AI'], ['veeva', 'Veeva Systems'],
  ].map(([s, n]) => B('lever', s, n)),
  // Ashby
  ...[
    ['openai', 'OpenAI'], ['notion', 'Notion'], ['ramp', 'Ramp'], ['linear', 'Linear'],
    ['deel', 'Deel'], ['replit', 'Replit'], ['perplexity', 'Perplexity'], ['cursor', 'Cursor'],
    ['retool', 'Retool'], ['supabase', 'Supabase'], ['posthog', 'PostHog'], ['clickhouse', 'ClickHouse'],
    ['snowflake', 'Snowflake'], ['cohere', 'Cohere'], ['mercury', 'Mercury'], ['vanta', 'Vanta'],
    ['drata', 'Drata'], ['benchling', 'Benchling'], ['hex', 'Hex'], ['modal', 'Modal'],
  ].map(([s, n]) => B('ashby', s, n)),
  // SmartRecruiters
  ...[
    ['Visa', 'Visa'], ['ServiceNow', 'ServiceNow'], ['BoschGroup', 'Bosch'], ['Equinix', 'Equinix'],
    ['WesternDigital', 'Western Digital'], ['Experian', 'Experian'], ['Square', 'Square'],
  ].map(([s, n]) => B('smartrecruiters', s, n)),
];
