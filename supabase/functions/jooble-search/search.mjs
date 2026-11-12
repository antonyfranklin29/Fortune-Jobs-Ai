import { cleanText, mapPartnerJobs } from '../_shared/live-job-partner.mjs';

export function joobleJobs(payload) {
  return mapPartnerJobs(payload?.jobs, row => ({
    title: cleanText(row.title, 300),
    company: cleanText(row.company, 200),
    location: cleanText(row.location, 200),
    date: cleanText(row.updated, 100),
    salary: cleanText(row.salary, 120),
    description: cleanText(row.snippet, 400),
    url: typeof row.link === 'string' ? row.link : '',
  }));
}

export async function searchJooble({ key, q, location, page, fetchImpl, signal }) {
  const response = await fetchImpl('https://jooble.org/api/' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      keywords: q, location: location || 'United States', page, ResultOnPage: 20,
    }),
    redirect: 'error',
    signal,
  });
  return response.ok ? joobleJobs(await response.json()) : [];
}
