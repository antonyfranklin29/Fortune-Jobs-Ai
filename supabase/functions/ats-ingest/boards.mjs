// Company career boards we read. [provider, board slug, display name].
// Each slug was checked against the provider's public feed (see `checked`); a board that
// starts failing is reported by the worker and should be removed here.
export const checked = '2026-11-07'; // boards that answered with jobs; ones that 404ed or listed nothing were removed
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
    ['betterment', 'Betterment'], ['oscar', 'Oscar Health'], ['peloton', 'Peloton'],
    ['netlify', 'Netlify'], ['zscaler', 'Zscaler'],
    ['sofi', 'SoFi'],
    ['block', 'Block'], ['yext', 'Yext'],
    ['fivetran', 'Fivetran'],
    ['pagerduty', 'PagerDuty'], ['newrelic', 'New Relic'], ['sumologic', 'Sumo Logic'],
    ['tanium', 'Tanium'], ['rubrik', 'Rubrik'],
    ['purestorage', 'Pure Storage'], ['appian', 'Appian'],
   
    ['spacex', 'SpaceX'], ['waymo', 'Waymo'], ['nuro', 'Nuro'],
    ['intercom', 'Intercom'], ['mixpanel', 'Mixpanel'],
    ['twitch', 'Twitch'], ['epicgames', 'Epic Games'],
    ['calendly', 'Calendly'], ['launchdarkly', 'LaunchDarkly'],
    ['sigmacomputing', 'Sigma Computing'], ['dataiku', 'Dataiku'], ['anaplan', 'Anaplan'],
  ].map(([s, n]) => B('greenhouse', s, n)),
  // Lever
  ...[
    ['palantir', 'Palantir'], ['spotify', 'Spotify'],
    ['zoox', 'Zoox'], ['outreach', 'Outreach'],
   
    ['wealthfront', 'Wealthfront'], ['shieldai', 'Shield AI'], ['veeva', 'Veeva Systems'],
  ].map(([s, n]) => B('lever', s, n)),
  // Ashby
  ...[
    ['openai', 'OpenAI'], ['notion', 'Notion'], ['ramp', 'Ramp'], ['linear', 'Linear'],
    ['replit', 'Replit'], ['perplexity', 'Perplexity'], ['cursor', 'Cursor'],
    ['supabase', 'Supabase'], ['posthog', 'PostHog'], ['clickhouse', 'ClickHouse'],
    ['snowflake', 'Snowflake'], ['cohere', 'Cohere'], ['vanta', 'Vanta'],
    ['drata', 'Drata'], ['benchling', 'Benchling'], ['hex', 'Hex'], ['modal', 'Modal'],
  ].map(([s, n]) => B('ashby', s, n)),
  // SmartRecruiters
  ...[
    ['ServiceNow', 'ServiceNow'], ['BoschGroup', 'Bosch'],
    ['WesternDigital', 'Western Digital'], ['Experian', 'Experian'],
  ].map(([s, n]) => B('smartrecruiters', s, n)),
];
