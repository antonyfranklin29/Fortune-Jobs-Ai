// Public catalogue reads use the same anonymous access and visibility rules as Quick Match.
import { fixApplyUrl } from '../react/src/shared/applyUrl.js';

export const SITE = 'https://fortunejobsai.com';
export const MIN_CITY_JOBS = 5;
export const MIN_STATE_JOBS = 40;
export const DISPLAY_LIMIT = 20;
const PAGE_SIZE = 1000;
const summaryFields = 'id,job_title,company,location,state_code,canonical_role,country,posted_at,expires_at,closed_at,source,apply_url';
const postingFields = summaryFields + ',job_description,is_remote,work_mode';

export function applicationUrl(value) {
  try {
    const url = new URL(fixApplyUrl(value));
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* An unparseable link cannot be used to apply. */ }
  return '';
}

export function openListing(job, now = Date.now()) {
  const posted = Date.parse(job?.posted_at);
  const expiry = job?.expires_at == null ? Infinity : Date.parse(job.expires_at);
  return /^\d+$/.test(String(job?.id)) && job.country === 'us' && job.closed_at == null &&
    (job.posted_at == null || posted <= now) && expiry > now &&
    Boolean(job.job_title?.trim() && job.company?.trim() && job.location?.trim() && applicationUrl(job.apply_url)) &&
    !/\b(?:please ignore|do not apply|test listing|test posting|fortune jobs ai test)\b/i.test(job.job_title);
}

function cityName(value) {
  const city = String(value).split(',')[0].trim().toLowerCase().replace(/[.]/g, '');
  return city === 'new york city' ? 'new york' : city;
}

export function areaListings(rows, { city, state, role }, now = Date.now()) {
  const seen = new Set();
  return rows.filter(job => {
    if (!openListing(job, now) || job.state_code !== state || job.canonical_role !== role ||
        (city && cityName(job.location) !== cityName(city))) return false;
    const key = applicationUrl(job.apply_url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cityListings(rows, target, now = Date.now()) {
  return areaListings(rows, target, now).slice(0, DISPLAY_LIMIT);
}

export function eligiblePosting(job, now = Date.now()) {
  if (!openListing(job, now) || job.source !== 'employer_direct' || !job.posted_at || !job.expires_at ||
      job.is_remote || /^remote$/i.test(job.work_mode || '') ||
      !/^[A-Z]{2}$/.test(job.state_code || '') || !job.location.includes(',') ||
      (job.job_description || '').trim().length < 50) return false;
  const destination = new URL(applicationUrl(job.apply_url));
  // The Fortune Jobs AI site itself is not an employer application destination.
  return !/(^|\.)fortunejobsai\.com$/i.test(destination.hostname);
}

export const postingPath = id => '/jobs/posting/' + id + '/';

export function jobPosting(job, now = Date.now()) {
  if (!eligiblePosting(job, now)) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.job_title.trim(),
    description: job.job_description.trim(),
    identifier: { '@type': 'PropertyValue', name: job.company.trim(), value: String(job.id) },
    datePosted: new Date(job.posted_at).toISOString(),
    validThrough: new Date(job.expires_at).toISOString(),
    hiringOrganization: { '@type': 'Organization', name: job.company.trim() },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: job.location.split(',')[0].trim(),
        addressRegion: job.state_code,
        addressCountry: 'US',
      },
    },
    url: SITE + postingPath(job.id),
  };
}

async function read(config, params) {
  const response = await fetch(config.url + '/rest/v1/pre_scraped_jobs?' + new URLSearchParams(params), {
    headers: { apikey: config.key, Authorization: 'Bearer ' + config.key },
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Public catalogue returned HTTP ' + response.status);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Expected a catalogue row array');
  return rows;
}

async function readPages(config, filters, select = summaryFields) {
  const rows = [];
  let after;
  for (let page = 0; page < 100; page++) {
    const batch = await read(config, {
      select, country: 'eq.us', closed_at: 'is.null', ...filters,
      order: 'id.asc', limit: String(PAGE_SIZE), ...(after && { id: 'gt.' + after }),
    });
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
    const last = batch.at(-1).id;
    if (!/^\d+$/.test(String(last)) || (after && Number(last) <= Number(after))) throw new Error('Catalogue pagination stalled');
    after = last;
  }
  throw new Error('Catalogue page limit reached');
}

export const readOpenCatalogue = config => readPages(config, {});

export function newestFirst(a, b) {
  return (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0) || Number(b.id) - Number(a.id);
}

export async function getAreaListings(config, target, now = Date.now()) {
  const rows = await readPages(config, { canonical_role: 'eq.' + target.role, state_code: 'eq.' + target.state });
  return areaListings(rows.sort(newestFirst), target, now);
}

export async function getEmployerPostings(config, id) {
  if (id === undefined) return readPages(config, { source: 'eq.employer_direct' }, postingFields);
  if (!/^\d+$/.test(String(id))) return [];
  return read(config, {
    select: postingFields, country: 'eq.us', source: 'eq.employer_direct', closed_at: 'is.null',
    id: 'eq.' + id, limit: '1',
  });
}
