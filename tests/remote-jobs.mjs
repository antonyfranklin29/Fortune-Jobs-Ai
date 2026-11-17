import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { storeRemoteJobs } from '../scripts/store-remote-jobs.mjs';
import { normalizeRemote, enabledSources, dedupeRemote } from '../scripts/remote-jobs.mjs';
import { jobPosting, openListing } from '../jobs/catalogue.mjs';

const now = Date.parse('2026-11-17T10:00:00Z');
const remotive = {
  id: 1, title: 'Data Analyst', company_name: 'Example',
  url: 'https://remotive.com/remote-jobs/data/example-1',
  publication_date: '2026-11-16T10:00:00Z', candidate_required_location: 'Europe only',
};
const himalayas = {
  guid: 'https://himalayas.app/companies/example/jobs/data-analyst',
  applicationLink: 'https://himalayas.app/companies/example/jobs/data-analyst?utm_source=api',
  title: 'Data Analyst', companyName: 'Example',
  locationRestrictions: [], timezoneRestrictions: [1, 2],
  expiryDate: Math.floor(now / 1000) + 3600,
};

test('Remotive requires the explicit flag and a full 24 hours', () => {
  assert.deepEqual(enabledSources({}), ['himalayas']);
  assert.deepEqual(enabledSources({ ENABLE_REMOTIVE: 'true' }), ['himalayas', 'remotive']);
  assert.equal(normalizeRemote('remotive', remotive, now - 1), null);
  const row = normalizeRemote('remotive', remotive, now);
  assert.equal(row.location, 'Remote · Europe only');
  assert.equal(row.state_code, null);
  assert.equal(row.attribution, 'Remotive');
  assert.equal(row.source_url, remotive.url);
  assert.equal(normalizeRemote('remotive', { ...remotive, candidate_required_location: 'Texas, USA' }, now).state_code, 'TX');
});

test('Himalayas keeps its application link and source eligibility and drops expired jobs', () => {
  const row = normalizeRemote('himalayas', { ...himalayas, title: 'Culinary Director' }, now);
  assert.equal(row.location, 'Remote · Worldwide · UTC offsets 1, 2');
  assert.equal(row.canonical_role, null);
  assert.equal(row.apply_url, himalayas.applicationLink);
  assert.equal(row.source_url, himalayas.guid);
  assert.equal(row.attribution, 'Himalayas');
  assert.equal(normalizeRemote('himalayas', { ...himalayas, expiryDate: Math.floor(now / 1000) }, now), null);
});

test('Remote feeds deduplicate cross-source copies and stay out of indexable catalogue rows', () => {
  const a = normalizeRemote('himalayas', himalayas, now);
  const b = normalizeRemote('remotive', remotive, now);
  assert.deepEqual(dedupeRemote([a, b]), [a]);
  for (const row of [a, b]) {
    const indexCandidate = { ...row, id: 10, country: 'us', state_code: 'TX' };
    assert.equal(openListing(indexCandidate, now), false);
    assert.equal(jobPosting(indexCandidate, now), null);
  }
});
test('A complete snapshot preserves existing catalogue duplicates and closes missing feed rows', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table pre_scraped_jobs (
      source text, source_listing_id text, source_url text, apply_url text unique, job_title text,
      company text, location text, canonical_role text, category text, state_code text, country text,
      is_remote boolean, work_mode text, attribution text, posted_at timestamptz, expires_at timestamptz,
      search_text text, fetched_at timestamptz, last_seen_at timestamptz, scraped_at timestamptz, closed_at timestamptz
    );
    create unique index source_key on pre_scraped_jobs (source, source_listing_id) where source_listing_id is not null;
    insert into pre_scraped_jobs (source, source_listing_id, apply_url, job_title, company, is_remote)
      values ('greenhouse', 'company:1', 'https://example.com/1', 'Data Analyst', 'Example', true),
             ('himalayas', 'old', 'https://himalayas.app/old', 'Old job', 'Example', true);`);
    const duplicate = normalizeRemote('himalayas', himalayas, now);
    const fresh = normalizeRemote('remotive', { ...remotive, title: 'Cloud Engineer' }, now);
    assert.equal(await storeRemoteJobs(db, [duplicate, fresh], ['himalayas', 'remotive'], now), 1);
    const { rows } = await db.query('select source, closed_at, attribution from pre_scraped_jobs order by source');
    assert.deepEqual(rows.map(row => [row.source, Boolean(row.closed_at), row.attribution]), [
      ['greenhouse', false, null], ['himalayas', true, null], ['remotive', false, 'Remotive'],
    ]);
    await assert.rejects(storeRemoteJobs(db, [fresh], ['remotive'], now - 1), /newer snapshot/);
  } finally {
    await db.close();
  }
});
