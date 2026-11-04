import { afterEach, expect, it } from 'vitest';
import { save } from '../resume/lib/guestResume.js';
import { fitFor, guestMatchProfile } from './catalogue.js';

afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, '', '/results.html');
});

it('carries confirmed guest skills into a job fit estimate', () => {
  const profile = save(sessionStorage, {
    match_id: '12345678-1234-1234-1234-123456789abc',
    current_title: 'Data Analyst',
    skills: ['SQL', 'Python'],
    years_experience: 2,
  });
  window.history.replaceState({}, '', `/results.html?resume=1&resume_id=${profile.match_id}`);
  const confirmed = guestMatchProfile();
  expect(confirmed?.skills).toEqual(['SQL', 'Python']);
  const fit = fitFor({
    job_title: 'Data Analyst',
    job_description: 'Analyze business data using SQL, Python, and Tableau. Build reports, review datasets, and work with product teams to explain trends and insights.'
  }, confirmed);
  expect(fit?.score).toBeGreaterThan(0);
  expect(fit?.matched).toEqual(expect.arrayContaining(['SQL', 'Python']));
});

it('respects the visitor choice to search without résumé details', () => {
  save(sessionStorage, { current_title: 'Data Analyst', skills: ['SQL'] });
  window.history.replaceState({}, '', '/results.html?resume=0');
  expect(guestMatchProfile()).toBeNull();
});
