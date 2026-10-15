// Server-side building blocks only. There is no public endpoint or publisher.
// The source object MUST come from a protected, operator-approved registry,
// never a request body. An API being public is not publication permission.
import { classifyRole, stateFromEvidence, parsePostedAt } from '../job-ingest/lib.mjs';

export const MAX_JOBS = 500;
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const ATS_HOSTS = new Set(['boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.eu.lever.co']);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const hostOK = host => typeof host === 'string' && host.length <= 253 &&
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) &&
  !/\.(?:localhost|local|internal|test|invalid)$/.test(host);

export function approvedSource(source, now = new Date()) {
  if (!source || source.status !== 'approved' || source.enabled !== true ||
      source.rights_basis !== 'employer_written_permission' ||
      source.allow_display !== true || source.allow_refresh !== true ||
      !ID.test(source.id || '') || !TOKEN.test(source.board_token || '') ||
      !['greenhouse', 'lever'].includes(source.adapter) ||
      !['global', 'eu'].includes(source.api_region) ||
      !plainText(source.employer_name, 200) ||
      typeof source.permission_ref !== 'string' || !source.permission_ref.trim() ||
      typeof source.approved_by !== 'string' || !source.approved_by.trim() ||
      !validDate(source.approved_at) || Date.parse(source.approved_at) > now.getTime() ||
      !validDate(source.domain_verified_at) || Date.parse(source.domain_verified_at) > now.getTime() ||
      !validDate(source.authorization_expires_at) || Date.parse(source.authorization_expires_at) <= now.getTime() ||
      !Array.isArray(source.allowed_apply_hosts) || !source.allowed_apply_hosts.length ||
      source.allowed_apply_hosts.length > 8 || !source.allowed_apply_hosts.every(hostOK) ||
      typeof source.attribution_text !== 'string' || source.attribution_text.length > 120 ||
      /[<>\u0000-\u001f\u007f]/.test(source.attribution_text) ||
      typeof source.allow_description !== 'boolean') throw new Error('source_not_approved');
  if (source.adapter === 'greenhouse' && source.api_region !== 'global') throw new Error('unsupported_api_region');
  return source;
}

// Feed URL is constructed from fixed hosts and a strict tenant token. Never
// accept an arbitrary URL, URL credentials, port, path or redirect destination.
export function feedUrl(source, { offset = 0, limit = 100, now = new Date() } = {}) {
  approvedSource(source, now);
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_JOBS ||
      !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid_page');
  if (source.adapter === 'greenhouse') {
    if (offset !== 0) throw new Error('invalid_page');
    return `https://boards-api.greenhouse.io/v1/boards/${source.board_token}/jobs?content=${source.allow_description}`;
  }
  const host = source.api_region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
  return `https://${host}/v0/postings/${source.board_token}?mode=json&skip=${offset}&limit=${limit}`;
}

export function plainText(value, max = 4000) {
  if (typeof value !== 'string') return '';
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi,
      m => ({'&nbsp;':' ', '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'"})[m.toLowerCase()])
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function applicationUrl(value, source, listingId) {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !source.allowed_apply_hosts.includes(url.hostname)) return null;
  if (ATS_HOSTS.has(url.hostname)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== source.board_token ||
        (source.adapter === 'greenhouse'
          ? !['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(url.hostname) || parts[1] !== 'jobs' || parts[2] !== listingId
          : !['jobs.lever.co', 'jobs.eu.lever.co'].includes(url.hostname) || parts[1] !== listingId)) return null;
  }
  url.hash = '';
  return url.href;
}

export function unpackFeed(payload, adapter, limit = 100) {
  if (adapter === 'greenhouse') {
    if (!payload || !Array.isArray(payload.jobs) || !Number.isInteger(payload.meta?.total) ||
        payload.meta.total !== payload.jobs.length || payload.jobs.length > MAX_JOBS) throw new Error('incomplete_or_invalid_feed');
    return { records: payload.jobs, enumeration_complete: true };
  }
  if (adapter !== 'lever' || !Array.isArray(payload) || payload.length > limit) throw new Error('incomplete_or_invalid_feed');
  // Exactly limit rows means the next page is required, including an empty
  // terminal page. Caller must not infer completion from a successful response.
  return { records: payload, enumeration_complete: payload.length < limit };
}

export function normalizeEmployerJob(raw, source, { roles, idx, now = new Date() }) {
  approvedSource(source, now);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reject: 'malformed' };
  const id = String(raw.id ?? '');
  if (!ID.test(id)) return { reject: 'invalid_source_id' };
  const greenhouse = source.adapter === 'greenhouse';
  // Greenhouse prospect posts are not an open job vacancy.
  if (greenhouse && raw.internal_job_id == null) return { reject: 'not_a_vacancy' };
  const title = plainText(greenhouse ? raw.title : raw.text, 300);
  if (!title) return { reject: 'no_title' };
  const roleId = classifyRole(title, roles);
  if (!roleId) return { reject: 'no_role' };
  if (raw.country != null && String(raw.country).toLowerCase() !== 'us') return { reject: 'other_country' };
  const location = plainText(greenhouse ? raw.location?.name : raw.categories?.location, 200);
  // First version accepts one explicit U.S. location; no guessing a state from
  // the employer's headquarters or scattering remote work into all 50 states.
  if (/[;|\n]/.test(greenhouse ? raw.location?.name || '' : raw.categories?.location || '')) return { reject: 'ambiguous_location' };
  const state = stateFromEvidence({ location }, idx);
  if (!state) return { reject: 'no_state_evidence' };
  const applyUrl = applicationUrl(greenhouse ? raw.absolute_url : raw.applyUrl || raw.hostedUrl, source, id);
  if (!applyUrl) return { reject: 'invalid_apply_url' };
  if (raw.application_deadline != null) {
    if (!validDate(raw.application_deadline)) return { reject: 'invalid_deadline' };
    if (Date.parse(raw.application_deadline) <= now.getTime()) return { reject: 'expired' };
  }
  // updated_at is NOT a posting date; Lever's public schema promises no date.
  const postedAt = greenhouse ? parsePostedAt(raw.first_published, now) : null;
  const workMode = !greenhouse ? ({'remote':'remote', 'hybrid':'hybrid', 'on-site':'onsite'})[raw.workplaceType] || null : null;
  const employment = !greenhouse ? ({'full-time':'Full-time', 'part-time':'Part-time', 'contract':'Contract', 'internship':'Internship'})[String(raw.categories?.commitment || '').toLowerCase()] || null : null;
  return { row: {
    source: 'employer_feed', source_listing_id: `${source.id}:${id}`,
    employer_source_id: source.id, canonical_role: roleId,
    category: roles.find(role => role.id === roleId).name,
    state_code: state, country: 'us', job_title: title,
    company: plainText(source.employer_name, 200), location,
    salary: null, apply_url: applyUrl, source_url: applyUrl,
    job_description: source.allow_description ? plainText(greenhouse ? raw.content : raw.descriptionPlain) || null : null,
    employment_type: employment, work_mode: workMode, is_remote: workMode === 'remote',
    posted_at: postedAt, fetched_at: now.toISOString(),
    attribution: source.attribution_text || null,
  } };
}

// No writes, no closures. A future publisher must re-check registry approval
// transactionally and handle cross-source duplicates without erasing credit.
export function normalizeEmployerFeed(payload, source, options) {
  approvedSource(source, options.now);
  const { records, enumeration_complete } = unpackFeed(payload, source.adapter, options.limit ?? 100);
  const rows = [], rejected = {}, seen = new Set();
  for (const raw of records) {
    const result = normalizeEmployerJob(raw, source, options);
    if (result.reject) { rejected[result.reject] = (rejected[result.reject] || 0) + 1; continue; }
    if (seen.has(result.row.source_listing_id)) throw new Error('duplicate_source_id');
    seen.add(result.row.source_listing_id); rows.push(result.row);
  }
  return { rows, rejected, received: records.length, enumeration_complete };
}
