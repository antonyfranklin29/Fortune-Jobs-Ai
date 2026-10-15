// Import-only transport. Not deployed, not called by visitors. No credentials,
// user identity, résumé, search query or application is sent to a job provider.
import { feedUrl } from './lib.mjs';
const MAX_BYTES = 2 * 1024 * 1024;

export async function fetchApprovedFeed(source, { now = new Date(), offset = 0, limit = 100, fetchImpl = fetch } = {}) {
  const url = feedUrl(source, { offset, limit, now });
  const response = await fetchImpl(url, {
    method: 'GET', redirect: 'error', credentials: 'omit',
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
  });
  // Also check the response because injected/test clients may ignore redirect.
  if (!response.ok || response.redirected || (response.url && response.url !== url)) throw new Error('feed_request_failed');
  if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('invalid_feed_type');
  if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) throw new Error('feed_too_large_or_empty');
  const reader = response.body.getReader(), parts = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new Error('feed_too_large_or_empty');
      parts.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let pos = 0;
  for (const part of parts) { bytes.set(part, pos); pos += part.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('invalid_feed_json'); }
}
