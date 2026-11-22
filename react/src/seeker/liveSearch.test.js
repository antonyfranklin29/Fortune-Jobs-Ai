import { describe, expect, it, vi } from 'vitest';
import { liveSearch, mergeLive, partnerJob, partnerPostedAt, blendPartners, partnerBlend } from './liveSearch.js';

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
  it('asks only the paying partner (WhatJobs), not Jooble or our catalogue', async () => {
    window.FJ_CONFIG = { url: 'https://example.supabase.co', key: 'anon' };
    const fetchImpl = vi.fn(async () => Response.json({ jobs: [{ title: 'Nurse', company: 'Care', url: 'https://whatjobs.test/n', date: 'Today' }] }));
    const catalogue = vi.fn(async () => [{ job_title: 'Ours', company: 'Acme' }]);
    const jobs = await liveSearch({ q: 'nurse', location: 'Greenville, NC' }, catalogue, undefined, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/whatjobs-search$/);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ q: 'nurse', location: 'Greenville, NC', page: 1 });
    expect(catalogue).not.toHaveBeenCalled();
    expect(jobs.map(j => j.live_partner)).toEqual(['WhatJobs']);
  });

  it('shows at most the plan limit and survives a partner failure', async () => {
    window.FJ_CONFIG = { url: 'https://example.supabase.co', key: 'anon' };
    const many = { jobs: Array.from({ length: 20 }, (_, i) => ({ title: `RN ${i}`, company: `Co ${i}`, url: `https://w.test/${i}` })) };
    expect(await liveSearch({ q: 'nurse' }, null, undefined, async () => Response.json(many))).toHaveLength(10);
    expect(await liveSearch({ q: 'nurse' }, null, undefined, async () => Response.json(many), 15)).toHaveLength(15);
    expect(await liveSearch({ q: 'nurse' }, null, undefined, async () => new Response('down', { status: 503 }))).toEqual([]);
  });

  it('does nothing without a search term', async () => {
    const fetchImpl = vi.fn();
    expect(await liveSearch({ q: '  ' }, async () => [], undefined, fetchImpl)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('blending WhatJobs into normal results', () => {
  const ours = n => Array.from({ length: n }, (_, i) => ({ job_title: `Our job ${i}`, company: 'Acme' }));
  const wj = (title, company = 'Grifols') => ({ job_title: title, company, live_partner: 'WhatJobs', source: 'whatjobs' });

  it('puts one partner job after every 4 of ours, at most 5, no duplicates', () => {
    const partners = [wj('Nurse'), wj('Nurse'), wj('Our job 1', 'Acme'), wj('RN'), wj('LPN'), wj('CNA'), wj('Aide'), wj('Tech')];
    const out = blendPartners(ours(12), partners);
    expect(out.filter(j => j.live_partner).map(j => j.job_title)).toEqual(['Nurse', 'RN', 'LPN', 'CNA', 'Aide']);
    expect(out[4].job_title).toBe('Nurse');
    expect(out[9].job_title).toBe('RN');
    expect(out).toHaveLength(17);
  });

  it('adds partner jobs at the end when we have few results, and keeps ours when there are none', () => {
    expect(blendPartners(ours(2), [wj('Nurse')]).map(j => j.job_title)).toEqual(['Our job 0', 'Our job 1', 'Nurse']);
    expect(blendPartners(ours(3), [])).toHaveLength(3);
  });

  it('hides an all-zero partner salary', () => {
    expect(partnerJob({ title: 'RN', url: 'https://x.test', salary: '0.000000 - 0.000000' }, 'whatjobs').salary).toBe('');
    expect(partnerJob({ title: 'RN', url: 'https://x.test', salary: '$30 - $40' }, 'whatjobs').salary).toBe('$30 - $40');
  });

  it('asks only WhatJobs, and only with a keyword', async () => {
    window.FJ_CONFIG = { url: 'https://db.test', key: 'k' };
    const calls = [];
    const fetchImpl = async (url, opts) => { calls.push(String(url)); return { ok: true, json: async () => ({ jobs: [{ title: 'RN', url: 'https://w.test/1', company: 'P' }] }) }; };
    expect(await partnerBlend({ q: '' }, undefined, fetchImpl)).toEqual([]);
    const rows = await partnerBlend({ q: 'Nurse', location: 'Georgia' }, undefined, fetchImpl);
    expect(calls).toEqual(['https://db.test/functions/v1/whatjobs-search']);
    expect(rows[0].live_partner).toBe('WhatJobs');
  });
});

describe('live jobs link', () => {
  it('keeps the search and location', async () => {
    const { liveJobsUrl } = await import('./ResultsPage.jsx');
    expect(liveJobsUrl({ q: ' Registered Nurse ', location: 'Georgia' })).toBe('./results.html?mode=live&q=Registered+Nurse&location=Georgia');
    expect(liveJobsUrl({ q: 'Data Analyst' })).toBe('./results.html?mode=live&q=Data+Analyst');
  });
});
