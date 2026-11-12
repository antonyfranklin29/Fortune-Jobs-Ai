// Company career boards we read. [provider, board slug, display name].
// Each slug was checked against the provider's public feed (see `checked`); a board that
// starts failing is reported by the worker and should be removed here.
export const checked = '2026-11-09'; // boards that answered with jobs; ones that 404ed or listed nothing were removed
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
    // Added 2026-11-09 (each answered with US IT jobs)
    ['andurilindustries', 'Anduril Industries'], ['axon', 'Axon'], ['lucidmotors', 'Lucid Motors'], ['relativity', 'Relativity Space'],
    ['coreweave', 'CoreWeave'], ['verkada', 'Verkada'], ['braze', 'Braze'], ['klaviyo', 'Klaviyo'], ['justworks', 'Justworks'],
    ['sentinellabs', 'SentinelOne'], ['zoominfo', 'ZoomInfo'], ['grafanalabs', 'Grafana Labs'], ['abnormalsecurity', 'Abnormal Security'],
    ['zocdoc', 'Zocdoc'], ['smartsheet', 'Smartsheet'], ['billcom', 'BILL'], ['checkr', 'Checkr'], ['tailscale', 'Tailscale'],
    ['attentive', 'Attentive'], ['gemini', 'Gemini'], ['later', 'Later'], ['nextdoor', 'Nextdoor'], ['circleci', 'CircleCI'],
    ['jfrog', 'JFrog'], ['mozilla', 'Mozilla'], ['bitwarden', 'Bitwarden'], ['wrike', 'Wrike'], ['komodohealth', 'Komodo Health'],
    ['coursera', 'Coursera'],
  ].map(([s, n]) => B('greenhouse', s, n)),
  // Lever
  ...[
    ['palantir', 'Palantir'], ['spotify', 'Spotify'],
    ['zoox', 'Zoox'], ['outreach', 'Outreach'],
   
    ['wealthfront', 'Wealthfront'], ['shieldai', 'Shield AI'], ['veeva', 'Veeva Systems'],
    ['hermeus', 'Hermeus'], ['ro', 'Ro'], ['gohighlevel', 'HighLevel'], ['sysdig', 'Sysdig'], ['rover', 'Rover'], ['dexterity', 'Dexterity'],
  ].map(([s, n]) => B('lever', s, n)),
  // Ashby
  ...[
    ['openai', 'OpenAI'], ['notion', 'Notion'], ['ramp', 'Ramp'], ['linear', 'Linear'],
    ['replit', 'Replit'], ['perplexity', 'Perplexity'], ['cursor', 'Cursor'],
    ['supabase', 'Supabase'], ['posthog', 'PostHog'], ['clickhouse', 'ClickHouse'],
    ['snowflake', 'Snowflake'], ['cohere', 'Cohere'], ['vanta', 'Vanta'],
    ['drata', 'Drata'], ['benchling', 'Benchling'], ['hex', 'Hex'], ['modal', 'Modal'],
    ['crusoe', 'Crusoe'], ['harvey', 'Harvey'], ['plaid', 'Plaid'], ['sierra', 'Sierra'], ['decagon', 'Decagon'],
    ['baseten', 'Baseten'], ['lambda', 'Lambda'], ['langchain', 'LangChain'], ['fireworks', 'Fireworks AI'],
    ['temporal', 'Temporal Technologies'], ['rogo', 'Rogo'], ['elevenlabs', 'ElevenLabs'], ['cognition', 'Cognition'],
    ['writer', 'Writer'], ['rho', 'Rho'], ['anyscale', 'Anyscale'], ['sentry', 'Sentry'], ['socket', 'Socket'],
    ['semgrep', 'Semgrep'], ['alchemy', 'Alchemy'], ['phantom', 'Phantom'], ['webflow', 'Webflow'],
  ].map(([s, n]) => B('ashby', s, n)),
  // SmartRecruiters
  ...[
    ['ServiceNow', 'ServiceNow'], ['BoschGroup', 'Bosch'],
    ['WesternDigital', 'Western Digital'], ['Experian', 'Experian'],
  ].map(([s, n]) => B('smartrecruiters', s, n)),
  // Workable
  ...[
    ['valsoft-corp', 'Valsoft Corporation'], ['seeq', 'Seeq'],
  ].map(([s, n]) => B('workable', s, n)),
  // Breezy HR boards verified to have US openings on 2026-11-11.
  ...[
    ["acute-nursing-care", "Acute Nursing Care"],
    ["adaco-construction-llc", "AdaCo Construction LLC"],
    ["atec-inc", "Atec, Inc."],
    ["atlas-technica", "Atlas Technica"],
    ["bitdeer", "Bitdeer Technologies Group"],
    ["casm-limitlessli", "Limitlessli"],
    ["clf-healthcare-and-communications", "CLFC Healthcare and Communications"],
    ["comprehensive-rehab-consultants", "Comprehensive Rehab Consultants"],
    ["delan-associates-inc", "Delan Associates, Inc"],
    ["diverge-it", "Diverge IT"],
    ["expression-networks", "Expression"],
    ["home-genius-exteriors", "Home Genius Exteriors"],
    ["intecon-llc", "INTECON"],
    ["jnd-inc", "JND"],
    ["kare", "KARE"],
    ["kimmel-associates", "Kimmel & Associates"],
    ["localize", "Localize"],
    ["montage-marketing", "Montage Marketing Group"],
    ["nationsbenefits", "NationsBenefits, LLC"],
    ["navaide", "Navaide"],
    ["netsync-network-solutions", "Netsync Network Solutions"],
    ["norman-international-inc", "Norman International Inc."],
    ["nuview", "NuView Analytics"],
    ["onsetto-inc", "Onsetto, Inc"],
    ["recruiting", "HIKINEX"],
    ["resupply", "ReSupply"],
    ["rinvio", "Rinvio"],
    ["rosenblum-law", "Rosenblum Law"],
    ["rule4", "Rule4"],
    ["salesdraft-recruiting", "SalesDraft Recruiting"],
    ["sentinel-blue", "Sentinel Blue"],
    ["serious-development", "Serious Development"],
    ["strata-g-llc", "Strata-G, LLC"],
    ["subscribe", "SUBSCRIBE"],
    ["surgeprofessional", "Surge Staffing"],
    ["talon-hiring-solutions", "Talon Hiring Solutions"],
    ["timeless-select-llc", "Timeless"],
    ["vetsez", "VetsEZ"],
    ["victory", "Victory"],
    ["vitality-hospice", "Vitality Hospice"],
  ].map(([s, n]) => B('breezy', s, n)),
];
