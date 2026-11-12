import { cleanText, mapPartnerJobs } from '../_shared/live-job-partner.mjs';

export function careerjetJobs(payload) {
  if (payload?.type !== 'JOBS') return [];
  return mapPartnerJobs(payload.jobs, row => ({
    title: cleanText(row.title, 300),
    company: cleanText(row.company, 200),
    location: cleanText(row.locations, 200),
    date: cleanText(row.date, 100),
    salary: cleanText(row.salary, 120),
    description: cleanText(row.description, 400),
    url: typeof row.url === 'string' ? row.url : '',
  }));
}

export async function searchCareerjet({ key, q, location, page, ip, userAgent, fetchImpl, signal }) {
  const url = new URL('https://search.api.careerjet.net/v4/query');
  url.search = new URLSearchParams({
    locale_code: 'en_US', keywords: q, location, page: String(page), page_size: '20',
    user_ip: ip, user_agent: userAgent,
  }).toString();
  const response = await fetchImpl(url, {
    headers: {
      Authorization: 'Basic ' + btoa(key + ':'),
      Accept: 'application/json',
      Referer: 'https://fortunejobsai.com/results.html',
    },
    redirect: 'error',
    signal,
  });
  return response.ok ? careerjetJobs(await response.json()) : [];
}
