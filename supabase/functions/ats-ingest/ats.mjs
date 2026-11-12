// Pure rules for company career-board ingestion.
// No network, no database. Every kept job links to the employer's own posting, so the
// Apply button never sends a person through another job site.
import { canonicalUrl, classifyRole, parsePostedAt, stateFromEvidence } from './core.mjs';

export const PROVIDERS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'breezy'];

// Public, keyless job-list feeds that each provider publishes for a company's own career page.
export function boardUrl(provider, slug) {
  const s = encodeURIComponent(slug);
  switch (provider) {
    case 'greenhouse': return `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`;
    case 'lever': return `https://api.lever.co/v0/postings/${s}?mode=json`;
    case 'ashby': return `https://api.ashbyhq.com/posting-api/job-board/${s}`;
    case 'smartrecruiters': return `https://api.smartrecruiters.com/v1/companies/${s}/postings?country=us&limit=100`;
    case 'workable': return `https://apply.workable.com/api/v1/widget/accounts/${s}`;
    case 'breezy':
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid Breezy board slug');
      return `https://${slug}.breezy.hr/json`;
    default: throw new Error('unknown provider');
  }
}

// The job list inside each provider's response.
export function listOf(provider, body) {
  if (provider === 'breezy') {
    if (!Array.isArray(body) || body.some(row => !row || typeof row !== 'object' || typeof row.id !== 'string' || typeof row.name !== 'string')) {
      throw new Error('Unexpected Breezy feed format');
    }
    return body;
  }
  if (provider === 'lever') return Array.isArray(body) ? body : [];
  if (provider === 'smartrecruiters') return Array.isArray(body?.content) ? body.content : [];
  return Array.isArray(body?.jobs) ? body.jobs : [];
}

// Employer hosts we accept as the posting's own page, per provider. A board could list an
// external link; we keep only links on the provider's hosted career pages or the company's site.
const HOSTED = {
  greenhouse: /(^|\.)greenhouse\.io$/i,
  lever: /(^|\.)lever\.co$/i,
  ashby: /(^|\.)ashbyhq\.com$/i,
  smartrecruiters: /(^|\.)smartrecruiters\.com$/i,
  workable: /(^|\.)workable\.com$/i,
  breezy: /^[a-z0-9-]+\.breezy\.hr$/i,
};
const AGGREGATORS = /(^|\.)(indeed|linkedin|ziprecruiter|glassdoor|careerjet|jobviewtrack|jooble|haystackapp|adzuna|monster|simplyhired|talent)\.(com|io|org|net)$/i;

export function employerUrl(provider, raw, companySite) {
  const ok = canonicalUrl(raw);
  if (!ok) return null;
  const host = new URL(ok).hostname;
  if (AGGREGATORS.test(host)) return null;
  if (HOSTED[provider].test(host)) return String(raw).trim().replace(/^http:/i, 'https:');
  // Greenhouse boards often point at the company's own careers site (e.g. stripe.com/jobs/...).
  // The link is set by the company itself on its own board, so any non-aggregator host is its site.
  if (provider === 'greenhouse' || (companySite && (host === companySite || host.endsWith('.' + companySite)))) return String(raw).trim().replace(/^http:/i, 'https:');
  return null;
}

// "San Francisco, CA; New York, NY" / "Austin, Texas, United States" / "NYC (Hybrid)" → first US state found.
export function stateOf(locations, idx) {
  for (const loc of locations) {
    for (const part of String(loc || '').split(/;|\||\s\/\s|\bor\b|•/i)) {
      const clean = part.replace(/\([^)]*\)/g, ' ').replace(/,?\s*(united states( of america)?|usa|u\.s\.a?\.?|us)\s*$/i, '').replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      const st = stateFromEvidence({ location: clean }, idx);
      if (st) return st;
    }
  }
  return null;
}

const strip = (v, n) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// One provider job → the fields we need, or null.
export function extract(provider, j, board) {
  if (!j || typeof j !== 'object') return null;
  switch (provider) {
    case 'greenhouse': return {
      id: j.id, title: j.title, url: j.absolute_url,
      locations: [j.location?.name, ...(j.offices || []).map((o) => o?.location || o?.name)],
      posted: j.first_published || j.updated_at, workplace: '', employment: null, description: null };
    case 'lever': return {
      id: j.id, title: j.text, url: j.hostedUrl,
      locations: [j.categories?.location, ...(j.categories?.allLocations || [])],
      posted: Number.isFinite(j.createdAt) ? new Date(j.createdAt).toISOString() : null,
      workplace: j.workplaceType || '', employment: j.categories?.commitment || null, description: j.descriptionPlain || null };
    case 'ashby': {
      if (j.isListed === false) return null;
      const region = j.address?.postalAddress?.addressRegion, city = j.address?.postalAddress?.addressLocality;
      return {
        id: j.id || j.jobUrl, title: j.title, url: j.jobUrl,
        locations: [city && region ? `${city}, ${region}` : region, j.location, ...(j.secondaryLocations || []).map((l) => l?.location)],
        posted: j.publishedAt, workplace: j.workplaceType || (j.isRemote ? 'remote' : ''), employment: j.employmentType || null,
        description: j.descriptionPlain || null };
    }
    case 'smartrecruiters': {
      const l = j.location || {};
      if (l.country && String(l.country).toLowerCase() !== 'us') return null;
      return {
        id: j.id, title: j.name, url: `https://jobs.smartrecruiters.com/${encodeURIComponent(board.slug)}/${encodeURIComponent(j.id)}`,
        locations: [l.city && l.region ? `${l.city}, ${l.region}` : l.region, l.fullLocation],
        posted: j.releasedDate, workplace: l.remote ? 'remote' : (l.hybrid ? 'hybrid' : ''), employment: j.typeOfEmployment?.label || null,
        description: null };
    }
    case 'workable': {
      // Only the job's US locations; a job listed only outside the US is skipped.
      const us = (Array.isArray(j.locations) ? j.locations : []).filter((l) => l && !l.hidden && String(l.countryCode || '').toUpperCase() === 'US');
      if (!us.length) return null;
      return {
        id: j.shortcode, title: j.title, url: j.url || j.shortlink,
        locations: us.map((l) => (l.city && l.region ? `${l.city}, ${l.region}` : l.region || l.city)),
        posted: j.published_on || j.created_at, workplace: j.telecommuting ? 'remote' : '', employment: j.employment_type || null,
        description: null };
    }
    case 'breezy': {
      const us = [j.location, ...(Array.isArray(j.locations) ? j.locations : [])]
        .filter(location => location?.country?.id === 'US' && /^[A-Z]{2}$/.test(location.state?.id || ''));
      if (!us.length) return null;
      const location = us[0];
      let url;
      try { url = new URL(j.url); } catch { return null; }
      const id = String(j.id || '');
      if (!/^[a-z0-9]+$/i.test(id) || url.origin !== `https://${board.slug}.breezy.hr` ||
          url.username || url.password ||
          !(url.pathname === `/p/${id}` || url.pathname.startsWith(`/p/${id}-`))) return null;
      return {
        id, title: j.name, url: j.url,
        locations: [[location.city, location.state.id].filter(Boolean).join(', ')],
        posted: j.published_date, workplace: location.is_remote === true ? 'remote' : '',
        employment: j.type?.name || null, description: null,
      };
    }
  }
  return null;
}

const EMPLOYMENT = (v) => {
  const s = String(v || '').toLowerCase();
  if (/full/.test(s)) return 'Full-time';
  if (/part/.test(s)) return 'Part-time';
  if (/contract|temp/.test(s)) return 'Contract';
  if (/intern/.test(s)) return 'Internship';
  return null;
};

// One job → a catalogue row, or the reason it was left out. Nothing is invented:
// a job without a US state, an IT role or an employer link is skipped, not guessed.
export function normalize(provider, raw, board, { roles, idx, fetchedAt, maxAgeDays = 60, now = new Date() }) {
  const j = extract(provider, raw, board);
  if (!j) return { reject: 'malformed_or_non_us' };
  const id = String(j.id ?? '').trim();
  const title = strip(j.title, 300);
  if (!id || !title) return { reject: 'no_id_or_title' };
  const url = employerUrl(provider, j.url, board.site);
  if (!url) return { reject: 'not_employer_link' };
  const roleId = classifyRole(title, roles);
  if (!roleId) return { reject: 'no_role' };
  const locations = j.locations.filter(Boolean).map((x) => strip(x, 200));
  const state = stateOf(locations, idx);
  if (!state) return { reject: 'no_us_state' };
  const posted = parsePostedAt(j.posted, now);
  if (posted && now - new Date(posted) > maxAgeDays * 86400000) return { reject: 'too_old' };
  const where = `${locations.join(' ')} ${j.workplace} ${title}`;
  const mode = /remote/i.test(where) ? 'remote' : /hybrid/i.test(where) ? 'hybrid' : null;
  const role = roles.find((r) => r.id === roleId);
  return { row: {
    source: provider,
    source_listing_id: `${board.slug}:${id}`.slice(0, 200),
    canonical_role: roleId,
    category: role.name,
    state_code: state,
    country: 'us',
    job_title: title,
    company: board.name,
    location: locations[0] || null,
    salary: null,
    apply_url: url,
    source_url: url,
    job_description: null, // never copied: the employer's own page has the full text
    employment_type: EMPLOYMENT(j.employment),
    is_remote: mode === 'remote',
    work_mode: mode,
    posted_at: posted,
    fetched_at: fetchedAt,
    attribution: `${board.name} careers`,
  } };
}

// Which boards a run covers: the list is split into `parts` slices, one slice per run.
export function sliceFor(boards, part, parts) {
  return boards.filter((_, i) => i % parts === ((part % parts) + parts) % parts);
}
