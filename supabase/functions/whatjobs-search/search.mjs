import { cleanText, mapPartnerJobs } from '../_shared/live-job-partner.mjs';

export function whatJobsListings(payload) {
  return mapPartnerJobs(payload?.data, row => ({
    title: cleanText(row.title, 300),
    company: cleanText(row.company, 200),
    location: cleanText(row.location, 200),
    date: cleanText(row.age, 100),
    salary: cleanText(row.salary, 120),
    description: cleanText(row.snippet, 400),
    url: typeof row.url === 'string' ? row.url : '',
  }));
}

export async function searchWhatJobs({ key, q, location, page, ip, userAgent, fetchImpl, signal }) {
  if (!/^\d+$/.test(key)) return [];
  const url = new URL('https://api.whatjobs.com/api/v1/jobs.json');
  url.search = new URLSearchParams({
    publisher: key, user_ip: ip, user_agent: userAgent, keyword: q,
    location, limit: '20', page: String(page),
  }).toString();
  if (location) url.searchParams.set('radius', '25');
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal,
  });
  return response.ok ? whatJobsListings(await response.json()) : [];
}
