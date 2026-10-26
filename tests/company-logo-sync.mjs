import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseCandidate, renderMap } from '../scripts/sync-company-logos.mjs';

test('accepts one exact company identity, including legal suffix', () => {
  assert.equal(chooseCandidate('Acme, Inc.', [{ name: 'Acme', domain: 'acme.com' }]), 'acme.com');
  assert.equal(chooseCandidate('Acme Staffing', [{ name: 'Acme', domain: 'acme.com' }]), null);
  assert.equal(chooseCandidate('Acme', [{ name: 'Acme', domain: 'acme.com' }, { name: 'Acme', domain: 'acme.co' }]), null);
});

test('publishes only matched domains and never includes the secret key', () => {
  const result = renderMap({ acme: { status: 'matched', domain: 'acme.com' }, unknown: { status: 'review' } }, 'pk_public123');
  assert.match(result, /img\.logo\.dev\/acme\.com/);
  assert.doesNotMatch(result, /unknown/);
  assert.doesNotMatch(result, /SECRET/);
});
