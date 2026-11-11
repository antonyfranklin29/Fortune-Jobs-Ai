// Public catalogue reads use the same anonymous access and visibility rules as Quick Match.
import { fixApplyUrl } from '../react/src/shared/applyUrl.js';

export const SITE = 'https://fortunejobsai.com';
export const MIN_CITY_JOBS = 5;
const DAY = 86400000;
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
    posted <= now && (job.source === 'employer_direct' || posted >= now - 30 * DAY) && expiry > now &&
    Boolean(job.job_title?.trim() && job.company?.trim() && job.location?.trim() && applicationUrl(job.apply_url)) &&
    !/\b(?:please ignore|do not apply|test listing|test posting|fortune jobs ai test)\b/i.test(job.job_title);
}

function cityName(value) {
  const city = String(value).split(',')[0].trim().toLowerCase();
  return city === 'new york city' ? 'new york' : city;
}

export function cityListings(rows, { city, state, role }, now = Date.now()) {
  const seen = new Set();
  return rows.filter(job => {
    if (!openListing(job, now) || job.state_code !== state || job.canonical_role !== role ||
        cityName(job.location) !== cityName(city)) return false;
    const key = applicationUrl(job.apply_url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

export function eligiblePosting(job, now = Date.now()) {
  if (!openListing(job, now) || job.source !== 'employer_direct' || !job.expires_at ||
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
  });
  if (!response.ok) throw new Error('Public catalogue returned HTTP ' + response.status);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Expected a catalogue row array');
  return rows;
}

export async function getCityListings(config, target, now = Date.now()) {
  const rows = await read(config, {
    select: summaryFields, country: 'eq.us', closed_at: 'is.null',
    canonical_role: 'eq.' + target.role, state_code: 'eq.' + target.state,
    location: 'ilike.' + target.city + '*', order: 'posted_at.desc.nullslast,id.desc', limit: '80',
    or: '(source.eq.employer_direct,posted_at.gte.' + new Date(now - 30 * DAY).toISOString() + ')',
  });
  return cityListings(rows, target, now);
}

export async function getEmployerPostings(config, id) {
  const params = {
    select: postingFields, country: 'eq.us', source: 'eq.employer_direct', closed_at: 'is.null',
    order: 'posted_at.desc.nullslast,id.desc', limit: id === undefined ? '250' : '1',
  };
  if (id !== undefined) {
    if (!/^\d+$/.test(String(id))) return [];
    params.id = 'eq.' + id;
  }
  return read(config, params);
}
