import { describe, expect, it } from 'vitest';
import { historyRow, savedJobRow, signInToSaveUrl } from './ResultsPage.jsx';
import { filterText } from '../account/ProfilePage.jsx';
import { jobKey } from '../shared/supabase.js';

describe('signed-in search helpers', () => {
  it('signing in to save a job comes back to the same search', () => {
    const url = signInToSaveUrl({ search: '?mode=quick&q=Data+Analyst&location=Chicago' });
    const next = new URL(url, 'https://fortunejobsai.com/').searchParams.get('next');
    expect(url.startsWith('./login.html?mode=signup&next=')).toBe(true);
    expect(next).toBe('results.html?mode=quick&q=Data+Analyst&location=Chicago');
    expect(signInToSaveUrl({ search: '' })).toBe('./login.html?mode=signup&next=results.html');
  });

  it('saved job rows stay inside the saved_jobs column limits', () => {
    const job = { job_title: 'T'.repeat(400), company: 'C'.repeat(250), location: 'L'.repeat(250), salary: 'S'.repeat(200), apply_url: 'https://x.test/' + 'a'.repeat(2100), search_reason: 'R'.repeat(2500) };
    const row = savedJobRow(job, jobKey(job));
    expect([row.job_title.length, row.company.length, row.location.length, row.salary.length, row.apply_url.length, row.match_reason.length]).toEqual([300, 200, 200, 120, 2000, 2000]);
    expect(row.job_key.length).toBeLessThanOrEqual(600);
    expect(savedJobRow({ job_title: 'Nurse', salary: null, company: '' }, 'k')).toEqual({ job_key: 'k', job_title: 'Nurse' });
  });

  it('history rows: quick searches with a query, filters kept, live and empty searches skipped', () => {
    expect(historyRow({ q: ' Data Analyst ', mode: 'quick', location: 'Chicago, Illinois', country: 'us', work_mode: 'Hybrid', resume_id: 'secret' }))
      .toEqual({ query: 'Data Analyst', mode: 'quick', filters: { location: 'Chicago, Illinois', country: 'us', work_mode: 'Hybrid' } });
    expect(historyRow({ q: 'Nurse' })).toEqual({ query: 'Nurse', mode: 'quick', filters: null });
    expect(historyRow({ q: '', mode: 'quick' })).toBeNull();
    expect(historyRow({ q: 'Nurse', mode: 'live' })).toBeNull();
    expect(historyRow({ q: 'x'.repeat(300) }).query.length).toBe(200);
  });

  it('history filter text reads both old codes and new labels', () => {
    expect(filterText({ location: 'Chicago', work_mode: 'Hybrid', job_type: 'Full-time', experience: 'Mid-Senior level' })).toBe('📍 Chicago · Hybrid · Full-time · Mid-Senior level');
    expect(filterText({ work_mode: 'hybrid', job_type: 'fulltime', experience: 'mid_senior' })).toBe('Hybrid · Full-time · Mid-Senior');
  });
});
