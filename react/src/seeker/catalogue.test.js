import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { quickMatches, searchCity } from './catalogue.js';
import { workAuthorizationLabel } from './workAuthorization.js';

const now = new Date().toISOString();
const job = (title, company, location, n) => ({ job_title: title, company, location, salary: null, apply_url: `https://jobs.example.com/${n}`, employment_type: null, work_mode: null, is_remote: false, posted_at: now, category: 'IT Jobs', country: 'us', job_description: '', source: 'greenhouse', closed_at: null });

beforeEach(() => { window.FJ_CONFIG = { url: 'https://db.example.com', key: 'test' }; });
afterEach(() => vi.unstubAllGlobals());

describe('searchCity', () => {
  it('reads the city from the location and normalises aliases', () => {
    expect(searchCity({ location: 'Chicago, IL' })).toBe('chicago');
    expect(searchCity({ location: 'NYC' })).toBe('new york');
    expect(searchCity({ city: 'St. Louis' })).toBe('st. louis');
    expect(searchCity({ location: 'Ohio', location_scope: 'region' })).toBe('');
    expect(searchCity({ location: 'a*b(c),x' })).toBe('a b c');
  });
});

describe('quickMatches with a city', () => {
  it('finds the city jobs that the nationwide top 300 leaves out', async () => {
    const national = Array.from({ length: 300 }, (_, i) => job('Software Engineer', `Co ${i}`, 'Austin, TX', i));
    national[0] = job('DevOps Engineer', 'Chi Ops', 'Chicago, IL', 'devops');
    const chicago = [job('Software Engineer', 'Acme', 'Chicago, IL', 'a'), job('Software Engineer II', 'Beta', 'Chicago, IL', 'b')];
    const urls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      urls.push(String(url));
      const body = String(url).includes('location=ilike') ? chicago : national;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const top = await quickMatches('Software Engineer', { location: 'Chicago, IL' });
    expect(urls.some(u => decodeURIComponent(u).includes('location=ilike.*chicago*'))).toBe(true);
    expect(top.map(j => j.company)).toEqual(expect.arrayContaining(['Acme', 'Beta']));
    expect(top.every(j => j.location.startsWith('Chicago'))).toBe(true);
  });

  it('does not add a city query when there is no city', async () => {
    const urls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => { urls.push(String(url)); return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }); }));
    await quickMatches('Data Analyst', {});
    expect(urls.some(u => u.includes('location='))).toBe(false);
  });
});

describe('catalogue retry', () => {
  it('retries once when the database times out', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++n === 1 ? new Response('{}', { status: 500 }) : new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))));
    await quickMatches('Data Analyst', {});
    expect(n).toBe(2);
  });
});

describe('work authorization', () => {
  it.each(['sponsors', 'opt_friendly'])('applies %s before the catalogue limit', async (sponsorship) => {
    const urls = [];
    vi.stubGlobal('fetch', vi.fn(async url => {
      urls.push(new URL(url));
      return Response.json([]);
    }));
    await quickMatches('Data Analyst', { sponsorship, location: 'Chicago, IL' });
    expect(urls.length).toBeGreaterThan(0);
    for (const { searchParams } of urls) {
      expect(searchParams.get('sponsorship')).toBe(`eq.${sponsorship}`);
      expect(searchParams.get('select')).toContain('sponsorship');
    }
  });

  it('preserves unknown listings and keyword search when hiding restrictions', async () => {
    const urls = [];
    vi.stubGlobal('fetch', vi.fn(async url => {
      urls.push(new URL(url));
      return Response.json([]);
    }));
    await quickMatches('Data Analyst', { sponsorship: 'hide_no_sponsorship' });
    expect(urls[0].searchParams.get('and')).toBe('(or(search_text.ilike.*data*,search_text.ilike.*analyst*),or(sponsorship.is.null,sponsorship.neq.no_sponsorship))');
    await quickMatches('', { sponsorship: 'hide_no_sponsorship' });
    expect(urls[1].searchParams.get('or')).toBe('(sponsorship.is.null,sponsorship.neq.no_sponsorship)');
  });

  it('describes explicit signals and leaves unknown listings unbadged', () => {
    expect(workAuthorizationLabel('sponsors')).toBe('Mentions visa sponsorship');
    expect(workAuthorizationLabel('opt_friendly')).toBe('Mentions OPT/CPT');
    expect(workAuthorizationLabel(null)).toBe('');
    expect(workAuthorizationLabel('unknown')).toBe('');
  });
});
