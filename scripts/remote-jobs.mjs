import { canonicalUrl, classifyRole, compileRoles, regionIndex } from '../supabase/functions/ats-ingest/core.mjs';
import { ROLES, REGIONS } from '../supabase/functions/ats-ingest/config.mjs';

const roles = compileRoles(ROLES);
const states = regionIndex(REGIONS);
const day = 86_400_000;
const labels = { remotive: 'Remotive', himalayas: 'Himalayas' };
const searchCountries = new Map([['us', 'us'], ['usa', 'us'], ['united states', 'us'],
  ['ca', 'ca'], ['canada', 'ca'], ['gb', 'gb'], ['uk', 'gb'], ['united kingdom', 'gb'], ['in', 'in'], ['india', 'in']]);

export function enabledSources(env) {
  return ['himalayas', ...(env.ENABLE_REMOTIVE === 'true' ? ['remotive'] : [])];
}

export function normalizeRemote(source, job, now) {
  const himalayas = source === 'himalayas';
  const posted = himalayas ? Number(job.pubDate) * 1000 : Date.parse(job.publication_date);
  const expiry = himalayas ? Number(job.expiryDate) * 1000 : 0;
  if (himalayas ? expiry && expiry <= now : !Number.isFinite(posted) || now - posted < day) return null;

  const title = job.title?.trim();
  const company = (himalayas ? job.companyName : job.company_name)?.trim();
  const apply = himalayas ? job.applicationLink : job.url;
  const link = himalayas ? job.guid : job.url;
  const id = himalayas ? job.guid : job.id;
  if (!title || !company || id == null || !canonicalUrl(apply) || !canonicalUrl(link) ||
      !apply.startsWith('https://') || new URL(link).hostname !== (himalayas ? 'himalayas.app' : 'remotive.com')) {
    throw new Error(`Invalid ${source} listing`);
  }

  const countries = himalayas ? job.locationRestrictions : null;
  const zones = himalayas ? job.timezoneRestrictions : null;
  const eligibility = himalayas
    ? [Array.isArray(countries) ? countries.join(', ') || 'Worldwide' : '', ...(zones?.length ? [`UTC offsets ${zones.join(', ')}`] : [])].filter(Boolean).join(' · ')
    : job.candidate_required_location?.trim();
  // State labels must stand alone or be explicitly qualified as US. Country names
  // such as Georgia also appear in both feeds and must not be interpreted as states.
  const state = !himalayas && /(?:,|\()\s*(?:US|USA|United States)\)?$/i.test(eligibility || '')
    ? states.byName?.get(eligibility.replace(/(?:,|\()\s*(?:US|USA|United States)\)?$/i, '').trim().toLowerCase())?.code ?? null
    : null;
  const singleCountry = himalayas && countries?.length === 1 ? countries[0] : job.candidate_required_location;
  const country = state ? 'us' : searchCountries.get(singleCountry?.toLowerCase().trim().replace(/ only$/, '')) ?? null;
  const role = roles.find(role => role.id === classifyRole(title, roles));
  const location = `Remote · ${eligibility || 'Eligibility unspecified'}`;
  return {
    source, source_listing_id: String(id), source_url: link, apply_url: apply,
    job_title: title.slice(0, 300), company, location, canonical_role: role?.id ?? null,
    category: role?.name ?? 'Remote', state_code: state,
    country,
    is_remote: true, work_mode: 'remote', attribution: labels[source],
    posted_at: Number.isFinite(posted) && posted > 0 ? new Date(posted).toISOString() : null,
    expires_at: expiry ? new Date(expiry).toISOString() : null,
    search_text: `${title} ${company} ${location}`.toLowerCase(),
  };
}

export function remoteIdentity(job) {
  const clean = value => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  return JSON.stringify([clean(job.company), clean(job.job_title)]);
}

export function dedupeRemote(rows) {
  const urls = new Set();
  const identities = new Map();
  const ids = new Set();
  return rows.filter(job => {
    const id = JSON.stringify([job.source, job.source_listing_id]);
    const url = canonicalUrl(job.apply_url);
    const identity = remoteIdentity(job);
    if (ids.has(id) || urls.has(url) || (identities.has(identity) && identities.get(identity) !== job.source)) return false;
    ids.add(id);
    urls.add(url);
    identities.set(identity, job.source);
    return true;
  });
}
