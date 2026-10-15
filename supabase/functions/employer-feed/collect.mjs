// Bounded, READ-ONLY collection for one server-registered source. No database
// writes, account billing, publication, scheduling, email or closures occur.
// loadSource is a trusted server-side port, not a user-supplied source object.
import { approvedSource, normalizeEmployerFeed, MAX_JOBS } from './lib.mjs';
import { fetchApprovedFeed } from './fetch.mjs';

const EXPECTED_ERRORS = new Set([
  'source_not_approved', 'unsupported_api_region', 'invalid_page',
  'incomplete_or_invalid_feed', 'invalid_feed_type', 'feed_too_large_or_empty',
  'invalid_feed_json', 'feed_request_failed', 'duplicate_source_id',
  'source_changed', 'invalid_registry_record', 'job_limit',
]);
// Compare the approved configuration as well as the revision: a faulty registry
// updater must not silently change a board/host without incrementing revision.
const sameSource = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function collectEmployerFeed(sourceId, {
  loadSource, roles, idx, maxRequests = 2, now = () => new Date(),
  fetchPage = fetchApprovedFeed,
} = {}) {
  if (typeof sourceId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(sourceId) ||
      typeof loadSource !== 'function' || !Array.isArray(roles) || !idx ||
      !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 6) throw new Error('invalid_collection_options');
  const rows = [], rejected = {}, ids = new Set();
  let requests = 0, received = 0, offset = 0, initial, source;
  const result = (status, reason, complete = false) => ({
    source_id: sourceId, source_revision: initial?.revision ?? null,
    status, reason, requests_used: requests, received, rows, rejected,
    enumeration_complete: complete,
    // Merely a read-only recommendation. The publisher still needs a locked,
    // source-scoped sweep, fresh approval, quota checks and a closure guard.
    reconcile_candidate: complete && Object.keys(rejected).length === 0,
    next_offset: complete ? null : offset,
  });
  async function readApproved() {
    const record = await loadSource(sourceId);
    if (!record || record.source?.id !== sourceId || !Number.isSafeInteger(record.revision) || record.revision < 1)
      throw new Error('invalid_registry_record');
    approvedSource(record.source, now());
    // Snapshot values so later mutations of a test/port object cannot rewrite
    // what this run originally approved.
    return JSON.parse(JSON.stringify(record));
  }
  async function recheck() {
    const current = await readApproved();
    if (current.revision !== initial.revision || !sameSource(current.source, source)) throw new Error('source_changed');
  }
  try {
    initial = await readApproved(); source = initial.source;
    while (requests < maxRequests) {
      await recheck();
      requests++;
      const payload = await fetchPage(source, { now: now(), offset, limit: 100 });
      await recheck(); // Revocation during a fetch stops processing its response.
      const page = normalizeEmployerFeed(payload, source, { roles, idx, now: now(), limit: 100 });
      if (received + page.received > MAX_JOBS) throw new Error('job_limit');
      for (const row of page.rows) {
        if (ids.has(row.source_listing_id)) throw new Error('duplicate_source_id');
        ids.add(row.source_listing_id);
      }
      rows.push(...page.rows); received += page.received;
      for (const [reason, count] of Object.entries(page.rejected)) rejected[reason] = (rejected[reason] || 0) + count;
      offset += page.received;
      if (page.enumeration_complete) return result('complete', null, true);
      // At exactly 500 Lever records, one empty terminal page is allowed; any
      // additional non-empty page exceeds the catalogue limit and fails safely.
      if (source.adapter !== 'lever') throw new Error('incomplete_or_invalid_feed');
    }
    return result('partial', 'request_budget');
  } catch (error) {
    // Never leak raw registry/provider exception text (possibly credentials or
    // internal addresses). Discard collected rows on ANY failed run so callers
    // cannot accidentally publish a revoked or inconsistent earlier page.
    rows.length = 0;
    return result('failed', EXPECTED_ERRORS.has(error?.message) ? error.message : 'feed_request_failed');
  }
}
