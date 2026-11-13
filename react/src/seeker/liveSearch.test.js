import { describe, expect, it, vi } from 'vitest';
import { liveSearch, mergeLive, partnerJob, partnerPostedAt } from './liveSearch.js';

const NOW = Date.parse('2026-11-13T12:00:00Z');

describe('partnerPostedAt', () => {
  it('reads ISO dates, relative ages and unknowns', () => {
    expect(partnerPostedAt('2026-11-12T08:00:00Z', NOW)).toBe('2026-11-12T08:00:00.000Z');
    expect(partnerPostedAt('3 days ago', NOW)).toBe(new Date(NOW - 3 * 86400000).toISOString());
    expect(partnerPostedAt('2 hours ago', NOW)).toBe(new Date(NOW).toISOString());
    expect(partnerPostedAt('', NOW)).toBeNull();
    expect(partnerPostedAt('soon', NOW)).toBeNull();
  });
});

describe('mergeLive', () => {
  it('keeps our catalogue copy of a duplicate and sorts newest first', () => {
    const ours = { job_title: 'Data Analyst', company: 'Acme Inc', apply_url: 'https://acme.com/1', posted_at: '2026-11-10T00:00:00Z', source: 'greenhouse' };
    const dup = partnerJob({ title: 'Data analyst', company: 'ACME, Inc.', url: 'https://jooble.org/x', date: '2026-11-12T00:00:00Z' }, 'jooble');
    const fresh = partnerJob({ title: 'BI Analyst', company: 'Beta', url: 'https://whatjobs.com/y', date: '2026-11-13T00:00:00Z' }, 'whatjobs');
    const merged = mergeLive([ours], [dup, fresh]);
    expect(merged.map(j => j.apply_url)).toEqual(['https://whatjobs.com/y', 'https://acme.com/1']);
    expect(fresh.live_partner).toBe('WhatJobs');
  });
});

describe('liveSearch', () => {
  it('asks both partners in parallel and survives a partner failure', async () => {
    window.FJ_CONFIG = { url: 'https://example.supabase.co', key: 'anon' };
    const fetchImpl = vi.fn(async (url) => url.endsWith('jooble-search')
      ? Response.json({ jobs: [{ title: 'Nurse', company: 'Care', url: 'https://jooble.org/n', date: 'Today' }] })
      : new Response('down', { status: 503 }));
    const jobs = await liveSearch({ q: 'nurse', location: 'Greenville, NC' }, async () => [], undefined, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ q: 'nurse', location: 'Greenville, NC', page: 1 });
    expect(jobs.map(j => j.job_title)).toEqual(['Nurse']);
  });

  it('does nothing without a search term', async () => {
    const fetchImpl = vi.fn();
    expect(await liveSearch({ q: '  ' }, async () => [], undefined, fetchImpl)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
