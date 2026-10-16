// node --test tests/employer-submissions.mjs
// Offline checks for the employer domain-proof helpers and the employer page.
// Database permissions and quota: tests/employer-submissions-db.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proofName, proofMatches, proofValue, isUuid } from '../supabase/functions/employer-submissions/lib.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TOKEN = 'a'.repeat(32);

test('domain proof is looked up only under public domains', () => {
  assert.equal(proofName('Acme.com'), '_fortunejobsai.acme.com');
  for (const bad of ['localhost', 'intranet.local', 'db.internal', 'x.test', 'https://acme.com', 'acme.com/x', '10.0.0.1', '', null, 'a..com', '-acme.com'])
    assert.equal(proofName(bad), null, String(bad));
});

test('domain proof needs the exact TXT value', () => {
  assert.equal(proofMatches([['fortunejobsai-verify=', TOKEN]], TOKEN), true, 'split character-strings are joined');
  assert.equal(proofMatches([[proofValue(TOKEN)]], TOKEN), true);
  assert.equal(proofMatches([[proofValue(TOKEN) + 'x']], TOKEN), false, 'suffix');
  assert.equal(proofMatches([['x' + proofValue(TOKEN)]], TOKEN), false, 'prefix');
  assert.equal(proofMatches([[proofValue('b'.repeat(32))]], TOKEN), false, 'other org token');
  assert.equal(proofMatches([], TOKEN), false);
  assert.equal(proofMatches([[proofValue('')]], ''), false, 'empty token never matches');
  assert.equal(isUuid('3f1c2d4e-1111-4222-8333-444455556666'), true);
  assert.equal(isUuid('1; drop table x'), false);
});

const js = read('employer-submissions.js');
const html = read('employers.html');

test('employer page never takes plan, payment or approval state from the client side', () => {
  assert.doesNotMatch(js, /location\.(search|hash)|URLSearchParams/, 'no URL-derived state (a checkout return URL changes nothing)');
  assert.doesNotMatch(js + html, /stripe|checkout\.|\bcard number\b/i, 'no payment integration');
  assert.match(js, /Not available yet/, 'paid plan shown as unavailable');
  assert.doesNotMatch(js, /unlimited/i, 'no unlimited posting claim');
  assert.match(js, /plan\.monthly_price_cents/, 'price comes from the server read model');
  // The post form sends only its content fields.
  const keys = [...js.matchAll(/^\s{6}(\w+): (?:h\(|select\()/gm)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), ['apply_url', 'canonical_role', 'city', 'closing_date', 'description', 'employment_type',
    'job_title', 'posting_date', 'state_code', 'work_mode']);
  for (const fn of ['employer_publish_post_internal', 'employer_publish_feed_jobs', 'employer_mark_domain_verified', 'employer_entitlements', 'employer_billing_config'])
    assert.ok(!js.includes(fn), `page does not call ${fn}`);
});

test('employer page renders data as text, not HTML', () => {
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(js, /el\.textContent = v/);
  assert.match(js, /rel: 'noopener noreferrer nofollow'/, 'reviewer links to employer URLs are isolated');
});

test('employer page is private to search engines and loads no inline script', () => {
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.doesNotMatch(html, /<script>(?!<\/script>)/);
  assert.match(html, /src="employer-submissions\.js"/);
  assert.doesNotMatch(html, /<a [^>]*(index|results|find-jobs)\.html[^>]*>Post jobs/i, 'no shared navigation change');
});
