const test = require('node:test');
const assert = require('node:assert/strict');
const { selectJobs, cleanDescription } = require('../featured-jobs.js');

const now = Date.parse('2026-10-26T04:00:00Z');
const safeUrl = value => { try { return new URL(value).protocol === 'https:' ? value : ''; } catch { return ''; } };
const job = (source, i, extras = {}) => ({
  job_title: `Analyst ${i}`, company: `Company ${i}`, source,
  posted_at: '2026-10-25T12:00:00Z', apply_url: `https://jobs.example/${source}/${i}`,
  ...extras
});

test('preview contains ten distinct, recent real rows from both source groups', () => {
  const adzuna = Array.from({ length: 8 }, (_, i) => job('adzuna', i, { job_description: `Real description ${i}` }));
  const other = Array.from({ length: 8 }, (_, i) => job('indeed', i + 20));
  const rows = selectJobs(adzuna, other, now, safeUrl);
  assert.equal(rows.length, 10);
  assert.equal(rows.filter(row => row.source === 'adzuna').length, 7);
  assert.equal(rows.filter(row => row.source === 'indeed').length, 3);
  assert.equal(new Set(rows.map(row => `${row.job_title}|${row.company}`)).size, 10);
});

test('preview excludes stale, unsafe and duplicate rows without inventing replacements', () => {
  const rows = selectJobs([
    job('adzuna', 1, { job_description: 'Real description' }),
    job('adzuna', 1, { job_description: 'Real description' }),
    job('adzuna', 2, { job_description: 'Old', posted_at: '2026-08-01T12:00:00Z' }),
    job('adzuna', 3, { job_description: 'Unsafe', apply_url: 'javascript:alert(1)' })
  ], [job('indeed', 4)], now, safeUrl);
  assert.deepEqual(rows.map(row => row.job_title), ['Analyst 1', 'Analyst 4']);
  assert.equal(cleanDescription('<p>Build &amp; review reports</p>'), 'Build & review reports');
});

test('preview limits repeated employers when other real jobs are available', () => {
  const sameEmployer = Array.from({ length: 7 }, (_, i) => job('adzuna', i, {
    company: 'Repeated Employer', job_description: 'Real description'
  }));
  const varied = Array.from({ length: 10 }, (_, i) => job('indeed', i + 20));
  const rows = selectJobs(sameEmployer, varied, now, safeUrl);
  assert.equal(rows.length, 10);
  assert.equal(rows.filter(row => row.company === 'Repeated Employer').length, 2);
});
