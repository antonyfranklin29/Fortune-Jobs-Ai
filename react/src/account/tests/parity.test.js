// The ESM ports must behave exactly like the legacy scripts the live site still runs.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import * as Flow from '../lib/accountFlow.js';
import * as Deletion from '../lib/accountDeletion.js';
import * as Safety from '../lib/dataSafety.js';

const require = createRequire(import.meta.url);
const legacyFlow = require('../../../../account-flow.js');
const legacyDeletion = require('../../../../account-deletion.js');
const legacySafety = require('../../../../data-safety.js');

const NEXT_INPUTS = ['profile.html', 'employers.html', 'employers.html?x=1#y', 'https://evil.example/', '//evil.example', 'profile.html\\x', 'results.html?q=a b',
  'resume-builder.html', 'login.html', '', null, 42, 'a'.repeat(1801), 'find-jobs.html?q=data', 'javascript:alert(1)'];

describe('account flow parity', () => {
  it('next() and the employer helpers match the legacy script', () => {
    for (const v of NEXT_INPUTS) {
      expect(Flow.next(v)).toBe(legacyFlow.next(v));
      expect(Flow.next(v, '')).toBe(legacyFlow.next(v, ''));
      expect(Flow.isEmployerNext(v)).toBe(legacyFlow.isEmployerNext(v));
      expect(Flow.employerNext(v)).toBe(legacyFlow.employerNext(v));
    }
  });
  it('callbackError() and providers() match', () => {
    const cases = [['', ''], ['?error_code=otp_expired', ''], ['', '#error=access_denied'], ['?error=server_error', ''], ['?code=abc', '']];
    for (const [s, h] of cases) expect(Flow.callbackError(s, h)).toBe(legacyFlow.callbackError(s, h));
    for (const s of [null, {}, { external: { google: true } }, { external: { google: 'true' } }]) expect(Flow.providers(s)).toEqual(legacyFlow.providers(s));
  });
});

describe('account deletion parity', () => {
  it('validate() matches', () => {
    const inputs = [{}, { phrase: 'DELETE MY ACCOUNT', email: 'A@x.com', understood: true }, { phrase: 'delete my account', email: 'a@x.com', understood: true },
      { phrase: ' DELETE MY ACCOUNT ', email: 'b@x.com', understood: true }, { phrase: 'DELETE MY ACCOUNT', email: 'a@x.com', understood: 'yes' }];
    for (const i of inputs) for (const e of ['a@x.com', '', null]) expect(Deletion.validate(i, e)).toEqual(legacyDeletion.validate(i, e));
  });
  it('outcome() matches for every server answer', () => {
    const answers = [[200, { status: 'deleted' }], [401, null], [403, { reason: 'reauth_required' }], [400, { reason: 'confirmation_required' }], [400, { reason: 'email_mismatch' }],
      [500, { status: 'incomplete', reason: 'identity_not_closed' }], [500, { status: 'incomplete' }], [0, null], [502, 'text'], [200, { status: 'other' }]];
    for (const [s, b] of answers) expect(Deletion.outcome(s, b)).toEqual(legacyDeletion.outcome(s, b));
    expect(Deletion.PHRASE).toBe(legacyDeletion.PHRASE);
    expect(Deletion.RETURN_TO).toBe(legacyDeletion.RETURN_TO);
  });
});

describe('data safety parity', () => {
  it('httpUrl, ownedPath and avatarPath match', () => {
    for (const u of ['https://a.com/x', 'http://a.com', 'javascript:alert(1)', 'https://u:p@a.com', 'ftp://a.com', 'x', '', null, 'https://a.com/\u0000'])
      expect(Safety.httpUrl(u)).toBe(legacySafety.httpUrl(u));
    for (const [p, id] of [['u1/a.pdf', 'u1'], ['u1/../x', 'u1'], ['u2/a.pdf', 'u1'], ['u1/a/b.pdf', 'u1'], ['u1\\a', 'u1'], [null, 'u1']])
      expect(Safety.ownedPath(p, id)).toBe(legacySafety.ownedPath(p, id));
    const base = 'https://project.supabase.co';
    for (const u of [`${base}/storage/v1/object/public/avatars/u1/a.png`, `${base}/storage/v1/object/public/avatars/u2/a.png`, 'https://evil.example/storage/v1/object/public/avatars/u1/a.png', `${base}/storage/v1/object/public/resumes/u1/a.pdf`, 'nope'])
      expect(Safety.avatarPath(u, base, 'u1')).toBe(legacySafety.avatarPath(u, base, 'u1'));
  });
  it('Adzuna credit appears for exactly the listings the legacy helper credits', () => {
    for (const j of [{ source: 'adzuna' }, { apply_url: 'https://www.adzuna.com/details/1' }, { apply_url: 'https://adzuna.co.uk/x' }, { apply_url: 'https://notadzuna.com' }, {}, null])
      expect(Safety.isAdzunaJob(j)).toBe(legacySafety.adzunaAttribution(j) !== '');
  });
});
