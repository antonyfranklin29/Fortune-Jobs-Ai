import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('./catalogue.js', () => ({
  cleanDescription: value => value || '',
  fitFor: () => null,
  jobAge: () => '',
  logoFor: () => null,
  safeApplyUrl: value => value,
}));

import { JobDetail } from './JobViews.jsx';

const job = { job_title: 'Data Analyst', company: 'Example Co', location: 'Remote', apply_url: 'https://example.com/job' };

it('explains when a confirmed profile cannot be scored against a sparse listing', () => {
  render(<JobDetail job={job} profile={{ skills: ['SQL'] }} />);
  expect(screen.getByText('Fit estimate unavailable')).toBeTruthy();
  expect(screen.queryByText('See how well it fits you')).toBeNull();
});

it('invites a direct-search visitor to add optional experience', () => {
  render(<JobDetail job={job} profile={null} />);
  expect(screen.getByText('See how well it fits you')).toBeTruthy();
});
it('shows feed eligibility and links directly to the credited remote listing', () => {
  const sourceUrl = 'https://himalayas.app/companies/example/jobs/data-analyst';
  const applyUrl = sourceUrl + '?utm_source=api';
  render(<JobDetail job={{ ...job, source: 'himalayas', attribution: 'Himalayas', source_url: sourceUrl,
    apply_url: applyUrl, location: 'Remote · Poland' }} />);
  expect(screen.getByText('Remote · Poland')).toBeTruthy();
  const credit = screen.getByRole('link', { name: 'via Himalayas' });
  expect(credit.getAttribute('href')).toBe(sourceUrl);
  expect(credit.getAttribute('rel')).not.toContain('nofollow');
  expect(screen.getByRole('link', { name: /Apply on Himalayas/ }).getAttribute('href')).toBe(applyUrl);
});
