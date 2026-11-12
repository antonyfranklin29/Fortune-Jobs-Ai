import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PartnerJobs, partnerQuery } from './PartnerJobs.jsx';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('uses only the title and location for eligible US text searches', () => {
  const params = { q: ' Analyst ', location: ' Raleigh ', email: 'test@example.com' };
  expect(partnerQuery(params)).toEqual({ q: 'Analyst', location: 'Raleigh', page: 1 });
  for (const filters of [{ resume: '1' }, { mode: 'live' }, { country: 'ca' }, { sponsorship: 'sponsors' }, { salary_min: '90000' }]) {
    expect(partnerQuery({ ...params, ...filters })).toBeNull();
  }
});

it('renders attributed partner links and omits browser credentials', async () => {
  window.FJ_CONFIG = { url: 'https://example.test', key: 'public-key-fixture' };
  const fetchJobs = vi.fn(async () => Response.json({
    jobs: [{ title: 'Analyst', company: 'Example', url: 'https://jobviewtrack.com/v2/example' }],
  }));
  vi.stubGlobal('fetch', fetchJobs);
  const query = partnerQuery({ q: 'Analyst' });
  render(<PartnerJobs query={query} name="Careerjet" site="https://www.careerjet.com/" endpoint="careerjet-search" />);
  const job = await screen.findByRole('link', { name: 'Analyst' });
  expect(job.href).toBe('https://jobviewtrack.com/v2/example');
  expect(job.rel).toBe('nofollow sponsored noopener noreferrer');
  expect(screen.getByRole('link', { name: 'Jobs by Careerjet' }).href).toBe('https://www.careerjet.com/');
  expect(fetchJobs).toHaveBeenCalledWith('https://example.test/functions/v1/careerjet-search', expect.objectContaining({
    credentials: 'omit', body: JSON.stringify(query),
  }));
});

it('waits for a visitor to request Jooble and handles a provider failure', async () => {
  window.FJ_CONFIG = { url: 'https://example.test', key: 'public-key-fixture' };
  const fetchJobs = vi.fn(async () => new Response(null, { status: 429 }));
  vi.stubGlobal('fetch', fetchJobs);
  render(<PartnerJobs query={partnerQuery({ q: 'Analyst' })} name="Jooble" site="https://jooble.org/" endpoint="jooble-search" onDemand />);
  expect(fetchJobs).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Search Jooble' }));
  expect(await screen.findByText('No Jooble results available for this search.')).toBeTruthy();
  expect(fetchJobs).toHaveBeenCalledTimes(1);
});
