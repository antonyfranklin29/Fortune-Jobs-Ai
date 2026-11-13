import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HiringNow, loadHiringCompanies } from './HiringNow.jsx';

const config = { url: 'https://example.test', key: 'public-fixture' };
const rows = [{ company: 'Oracle', open_jobs: 566 }, { company: 'Unknown employer fixture', open_jobs: 1 }];

beforeEach(() => { window.sessionStorage.clear(); window.FJ_CONFIG = config; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('shows live companies, counts, original text labels and encoded search links', async () => {
  const request = vi.fn(async () => Response.json(rows));
  vi.stubGlobal('fetch', request);
  render(<HiringNow />);
  expect(await screen.findByRole('heading', { name: 'Companies hiring now on Fortune Jobs AI' })).toBeTruthy();
  const link = screen.getByRole('link', { name: 'Oracle · 566 open jobs' });
  expect(link.getAttribute('href')).toBe('/results.html?mode=quick&country=us&q=Oracle');
  const logo = link.querySelector('img');
  expect(logo?.getAttribute('loading')).toBe('lazy');
  const unknown = screen.getByRole('link', { name: 'Unknown employer fixture · 1 open job' });
  expect(unknown.querySelector('.featured-logo')?.textContent).toBe('U');
  expect(unknown.querySelector('img')).toBeNull();
  expect(screen.getByText(/Not affiliated/)).toBeTruthy();
  expect(request).toHaveBeenCalledWith(config.url + '/rest/v1/rpc/top_hiring_companies',
    expect.objectContaining({ body: JSON.stringify({ limit: 24 }) }));
});

it('reuses the cache for an hour and hides the strip on a failed refresh', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(4_000_000);
  const request = vi.fn().mockResolvedValueOnce(Response.json(rows)).mockResolvedValueOnce(new Response(null, { status: 404 }));
  vi.stubGlobal('fetch', request);
  expect(await loadHiringCompanies(config)).toEqual(rows);
  now.mockReturnValue(7_599_999);
  expect(await loadHiringCompanies(config)).toEqual(rows);
  expect(request).toHaveBeenCalledTimes(1);
  now.mockReturnValue(7_600_000);
  expect(await loadHiringCompanies(config)).toEqual([]);
  expect(request).toHaveBeenCalledTimes(2);
  request.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await act(async () => { render(<HiringNow />); });
  expect(screen.queryByRole('region')).toBeNull();
  expect(request).toHaveBeenCalledTimes(3);
});

it('has no pause button and keeps repeat chips out of keyboard navigation', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(rows)));
  const { container } = render(<HiringNow />);
  await waitFor(() => expect(container.querySelector('.hiring-viewport.is-moving')).toBeTruthy());
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(container.querySelectorAll('.hiring-copy a[tabindex="-1"]')).toHaveLength(2);
});
