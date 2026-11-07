// Pure rules for USAJOBS (the official U.S. federal jobs API). No network, no database.
// Every kept job links to its usajobs.gov posting, where the person applies.
import { classifyRole, parsePostedAt } from './core.mjs';

// Occupational series for IT and data work: 2210 IT Management, 1550 Computer Science,
// 1560 Data Science, 0854 Computer Engineering, 1530 Statistics.
export const SERIES = ['2210', '1550', '1560', '0854', '1530'];
export const PAGE_SIZE = 500; // the API's maximum

export function searchUrl(series, page) {
  const q = new URLSearchParams({ JobCategoryCode: series, ResultsPerPage: String(PAGE_SIZE), Page: String(page), DatePosted: '60', SortField: 'opendate', SortDirection: 'desc' });
  return `https://data.usajobs.gov/api/search?${q}`;
}

const strip = (v, n) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function stateOf(locations, idx) {
  for (const l of locations || []) {
    if (l?.CountryCode && !/^(united states|us)$/i.test(String(l.CountryCode))) continue;
    const name = String(l?.CountrySubDivisionCode || '').trim().toLowerCase();
    if (name === 'district of columbia' || /washington,?\s*d\.?c\.?/i.test(String(l?.LocationName || ''))) return 'DC';
    const hit = idx.byName.get(name);
    if (hit) return hit.code;
  }
  return null;
}

// "$95,000–$150,000" only for yearly pay the posting states; never estimated.
export function salaryOf(pay) {
  const p = (pay || [])[0];
  if (!p || p.RateIntervalCode !== 'PA') return null;
  const lo = Number(p.MinimumRange), hi = Number(p.MaximumRange);
  if (!Number.isFinite(lo) || lo <= 0) return null;
  const f = (n) => '$' + Math.round(n).toLocaleString('en-US');
  return Number.isFinite(hi) && hi > lo ? `${f(lo)}–${f(hi)}` : f(lo);
}

export function normalize(item, { roles, idx, fetchedAt, now = new Date() }) {
  const d = item?.MatchedObjectDescriptor;
  if (!d) return { reject: 'malformed' };
  const id = String(item.MatchedObjectId || d.PositionID || '').trim();
  const title = strip(d.PositionTitle, 300);
  if (!id || !title) return { reject: 'no_id_or_title' };
  let url = '';
  try { const u = new URL(String(d.PositionURI || '')); if (u.protocol === 'https:' && /(^|\.)usajobs\.gov$/i.test(u.hostname)) url = u.href; } catch { /* none */ }
  if (!url) return { reject: 'not_usajobs_link' };
  const close = Date.parse(d.ApplicationCloseDate || '');
  if (Number.isFinite(close) && close < now.getTime()) return { reject: 'closed' };
  const roleId = classifyRole(title, roles);
  if (!roleId) return { reject: 'no_role' };
  const state = stateOf(d.PositionLocation, idx);
  if (!state) return { reject: 'no_us_state' };
  const where = `${d.PositionLocationDisplay || ''} ${title}`;
  const remote = /remote/i.test(where) || d.UserArea?.Details?.RemoteIndicator === true;
  const role = roles.find((r) => r.id === roleId);
  const schedule = String(d.PositionSchedule?.[0]?.Name || '');
  return { row: {
    source: 'usajobs',
    source_listing_id: id.slice(0, 200),
    canonical_role: roleId,
    category: role.name,
    state_code: state,
    country: 'us',
    job_title: title,
    company: strip(d.OrganizationName || d.DepartmentName, 200) || null,
    location: strip(d.PositionLocationDisplay, 200) || null,
    salary: salaryOf(d.PositionRemuneration),
    apply_url: url,
    source_url: url,
    job_description: null, // the posting on usajobs.gov has the full text
    employment_type: /full/i.test(schedule) ? 'Full-time' : /part/i.test(schedule) ? 'Part-time' : null,
    is_remote: remote,
    work_mode: remote ? 'remote' : null,
    posted_at: parsePostedAt(d.PublicationStartDate, now),
    fetched_at: fetchedAt,
    attribution: 'USAJOBS',
  } };
}
