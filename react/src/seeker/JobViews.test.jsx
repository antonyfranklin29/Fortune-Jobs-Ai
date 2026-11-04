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
