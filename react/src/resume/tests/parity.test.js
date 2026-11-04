// The ESM ports must behave exactly like the legacy scripts the live site still runs.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import * as Guest from '../lib/guestResume.js';
import * as Matching from '../lib/resumeMatching.js';
import * as Builder from '../lib/resumeBuilder.js';

const require = createRequire(import.meta.url);
const legacyMatching = require('../../../../resume-matching.js');
const legacyGuest = require('../../../../guest-resume.js');
const legacyBuilder = require('../../../../resume-builder.js');

const RESUME = `Priya Raman
Data Analyst
Edison, New Jersey | priya@example.com
Professional Experience
Data Analyst, Example Co.
Jan 2021 - Present
Built weekly reports with SQL, Python and Power BI.
Junior Data Analyst, Other Inc.
Mar 2018 - Dec 2020
Excel and Tableau dashboards.
Education
B.S. Statistics`;
const TEXTS = [RESUME, 'Job title: Product Manager\n7 years of experience in Figma and SQL', 'nothing useful here', '', 'Registered Nurse\nNursing, Customer Service\n12+ years professional experience'];
const CATALOG = { titles: ['Data Analyst', 'Junior Data Analyst', 'Product Manager', 'Registered Nurse'], skills: ['Statistics', 'Dashboards'], countries: { 'United States': 'us', India: 'in' } };
const NOW = new Date('2026-11-03T12:00:00Z');

function memoryStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; }

describe('résumé matching parity', () => {
  it('suggest() matches', () => {
    for (const t of TEXTS) { expect(Matching.suggest(t)).toEqual(legacyMatching.suggest(t)); expect(Matching.suggest(t, CATALOG)).toEqual(legacyMatching.suggest(t, CATALOG)); }
  });
  it('contains() matches on punctuation-heavy terms', () => {
    for (const [t, s] of [['C++ and C#', 'C++'], ['Node.js dev', 'Node.js'], ['JavaScripting', 'JavaScript'], ['SQL,', 'SQL'], ['nosql', 'SQL']]) expect(Matching.contains(t, s)).toBe(legacyMatching.contains(t, s));
  });
  it('rank() and assess() match, including score explanations', () => {
    const jobs = [
      { job_title: 'Senior Data Analyst', job_description: 'We need SQL, Python and Tableau. 5+ years of experience required. Build dashboards for finance partners across regions.' },
      { job_title: 'Nurse', job_description: 'Short.' },
      { job_title: 'Analyst', job_description: 'Excel, Power BI and SQL reporting for operations; 2 years experience preferred; collaborate with stakeholders weekly.', match_reason: 'Close to you.' },
    ];
    const meta = (job) => (job.job_title === 'Nurse' ? { snippet: 'Nursing and Customer Service roles with 3 years of experience in hospital settings, nights and weekends included.' } : {});
    const profiles = [null, { skills: [] }, { skills: ['SQL', 'Python'], years_experience: 3, current_title: 'Data Analyst' }, { skills: ['Nursing'], years_experience: null }, { skills: ['Excel'], years_experience: 10, resume_text: 'Power BI and SQL' }];
    for (const p of profiles) {
      expect(Matching.rank(jobs, p, meta)).toEqual(legacyMatching.rank(jobs, p, meta));
      for (const j of jobs) { expect(Matching.assess(j, p, meta)).toEqual(legacyMatching.assess(j, p, meta)); expect(Matching.assess(j, p)).toEqual(legacyMatching.assess(j, p)); }
    }
  });
});

describe('guest résumé parity', () => {
  it('detect() matches', () => {
    for (const t of TEXTS) expect(Guest.detect(t, CATALOG, Matching, NOW)).toEqual(legacyGuest.detect(t, CATALOG, legacyMatching, NOW));
  });
  it('clean(), save()/load() expiry and params() match', () => {
    const inputs = [null, {}, { current_title: ' Data Analyst ', skills: ['SQL', '', 'x'.repeat(200)], years_experience: '4', city: 'Edison', region: 'New Jersey', country: 'us', scope: 'region' }, { current_title: 'QA', skills: Array(50).fill('Git'), years_experience: 99, scope: 'city', city: 'Pune', country: 'zz' }];
    for (const i of inputs) {
      expect(Guest.clean(i)).toEqual(legacyGuest.clean(i));
      const c = Guest.clean(i);
      if (c) for (const mode of ['quick', 'live']) expect(Guest.params(c, mode).toString()).toBe(legacyGuest.params(c, mode).toString());
    }
    expect(Guest.KEY).toBe(legacyGuest.KEY); expect(Guest.TTL).toBe(legacyGuest.TTL); expect(Guest.states).toEqual(legacyGuest.states);
    const ID = '11111111-2222-4333-8444-555555555555'; const a = memoryStorage(), b = memoryStorage();
    const sa = Guest.save(a, { ...inputs[2], match_id: ID }, 1000), sb = legacyGuest.save(b, { ...inputs[2], match_id: ID }, 1000);
    expect(sa).toEqual(sb); expect(a.m.get(Guest.KEY)).toBe(b.m.get(legacyGuest.KEY));
    expect(Guest.load(a, 1000 + Guest.TTL - 1, ID)).toEqual(legacyGuest.load(b, 1000 + legacyGuest.TTL - 1, ID));
    expect(Guest.load(a, 1000, 'other')).toBeNull();
    expect(Guest.load(a, 1000 + Guest.TTL)).toBeNull(); expect(a.m.has(Guest.KEY)).toBe(false);
  });
});

describe('résumé builder parity', () => {
  it('draft(), advice() and profileSuggestions() match', () => {
    const inputs = [{}, { name: ' Ana\u0007 ', email: 'a@b.co', experience: 'Responsible for reports\n\nLed migration', skills: Array(40).fill('SQL').join('\n') }, { name: 'B', phone: '1', target: 'Dev', projects: 'P' }];
    for (const i of inputs) { const d = Builder.draft(i); expect(d).toEqual(legacyBuilder.draft(i)); expect(Builder.advice(d)).toEqual(legacyBuilder.advice(d)); }
    for (const [p, e] of [[null], [{ full_name: 'Ana', skills: ['SQL', 3, ' Git '], preferred_locations: ['Austin, TX', 5], current_title: 'Analyst' }, 'ana@x.io'], [{ email: 'p@x.io', skills: 'SQL' }]]) expect(Builder.profileSuggestions(p, e)).toEqual(legacyBuilder.profileSuggestions(p, e));
  });
  it('contactLine() shows only http(s) links, like the legacy preview', () => {
    expect(Builder.contactLine({ email: 'a@b.co', phone: '', location: 'Austin', link: 'javascript:alert(1)' })).toBe('a@b.co  ·  Austin');
    expect(Builder.contactLine({ email: '', phone: '5', location: '', link: 'https://x.dev/me' })).toBe('5  ·  https://x.dev/me');
    expect(Builder.contactLine({ email: '', phone: '', location: '', link: 'not a url' })).toBe('');
  });
});
