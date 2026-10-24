// Account-deletion controls (account-deletion.js) with a fake DOM and a stubbed
// Supabase client. No network, no account.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../account-deletion.js');

class El {
  constructor(id) { this.id = id; this.hidden = false; this.disabled = false; this.value = ''; this.checked = false;
    this.textContent = ''; this.attrs = {}; this.events = {}; this.focused = false; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, fn) { this.events[k] = fn; }
  focus() { this.focused = true; }
}
const tick = () => new Promise(setImmediate);

function setup({ responses = [], email = 'person@example.test', session = true } = {}) {
  const nodes = {};
  const doc = { getElementById: (id) => nodes[id] || (nodes[id] = new El(id)) };
  ['delConfirmPanel', 'delReauth', 'delDone'].forEach((id) => { doc.getElementById(id).hidden = true; });
  const calls = { fetch: [], signOut: [] };
  const FJ = {
    sb: { auth: {
      getSession: async () => { if (session === 'throw') throw new Error('session unavailable'); return { data: { session: session ? { access_token: 'tok' } : null } }; },
      signOut: async (opts) => { calls.signOut.push(opts || null); return { error: null }; },
    } },
    loginUrl: (next) => 'login.html' + (next ? '?next=' + encodeURIComponent(next) : ''),
  };
  const location = { href: 'profile.html#delete-account' };
  const queue = [...responses];
  const fetch = async (url, init) => {
    calls.fetch.push({ url, init });
    const r = queue.shift();
    if (r === 'network') throw new TypeError('Failed to fetch');
    return { status: r.status, json: async () => r.body };
  };
  const ctl = D.mount({ doc, FJ, user: { email }, location, fetch, url: 'https://x.supabase.co/functions/v1/delete-account' });
  const n = (id) => doc.getElementById(id);
  const fill = (phrase = 'DELETE MY ACCOUNT', mail = email, understood = true) => {
    n('delPhrase').value = phrase; n('delEmail').value = mail; n('delUnderstand').checked = understood;
  };
  return { n, calls, ctl, location, fill };
}

test('validation needs the exact phrase, the account email and the acknowledgement', () => {
  assert.equal(D.validate({ phrase: 'DELETE MY ACCOUNT', email: 'A@B.test', understood: true }, 'a@b.test').ok, true);
  const v = D.validate({ phrase: 'delete my account', email: 'other@b.test', understood: false }, 'a@b.test');
  assert.deepEqual(Object.keys(v.errors).sort(), ['email', 'phrase', 'understood']);
  assert.match(D.validate({ phrase: 'DELETE MY ACCOUNT', email: '', understood: true }, 'a@b.test').errors.email, /Enter the email/);
});

test('each server answer maps to a distinct, honest message', () => {
  const kinds = [
    [200, { status: 'deleted' }, 'deleted'],
    [401, { reason: 'reauth_required' }, 'reauth'],
    [401, { reason: 'not_authenticated' }, 'reauth'],
    [400, { reason: 'confirmation_required' }, 'phrase'],
    [400, { reason: 'email_mismatch' }, 'email'],
    [409, { status: 'incomplete', reason: 'partial_cleanup' }, 'partial'],
    [409, { status: 'incomplete', reason: 'identity_not_closed' }, 'identity'],
    [0, null, 'unknown'],
    [503, { status: 'error' }, 'unknown'],
  ];
  for (const [s, b, k] of kinds) assert.equal(D.outcome(s, b).kind, k, `${s} ${JSON.stringify(b)}`);
  assert.match(D.outcome(409, { status: 'incomplete', reason: 'partial_cleanup' }).message, /cannot be restored/);
  assert.doesNotMatch(D.outcome(409, { status: 'incomplete', reason: 'partial_cleanup' }).message, /has been restored|were restored/);
  assert.match(D.outcome(401, { reason: 'reauth_required' }).message, /Nothing has been deleted/);
});

test('mounting, even on #delete-account, never sends a deletion', async () => {
  const { calls } = setup({ responses: [{ status: 200, body: { status: 'deleted' } }] });
  await tick();
  assert.equal(calls.fetch.length, 0);
});

test('invalid input shows inline errors and no final confirmation', async () => {
  const { n, ctl, calls, fill } = setup();
  fill('DELETE', 'wrong@example.test', false);
  ctl.start();
  assert.equal(n('delConfirmPanel').hidden, true);
  assert.match(n('delPhraseErr').textContent, /DELETE MY ACCOUNT/);
  assert.match(n('delEmailErr').textContent, /does not match/);
  assert.equal(n('delPhrase').attrs['aria-invalid'], 'true');
  assert.equal(n('delPhrase').focused, true);
  assert.equal(calls.fetch.length, 0);
});

test('two clicks on the final button send exactly one request', async () => {
  const { n, ctl, calls, fill } = setup({ responses: [{ status: 200, body: { status: 'deleted' } }] });
  fill(); ctl.start();
  assert.equal(n('delConfirmPanel').hidden, false);
  const a = ctl.confirm(); const b = ctl.confirm();
  await Promise.all([a, b]);
  assert.equal(calls.fetch.length, 1);
  const sent = calls.fetch[0];
  assert.equal(sent.init.headers.authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(sent.init.body), { confirm: 'DELETE MY ACCOUNT', email: 'person@example.test' });
});

test('success signs out locally only after confirmed deletion and shows the result', async () => {
  const { n, ctl, calls, fill } = setup({ responses: [{ status: 200, body: { status: 'deleted' } }] });
  fill(); ctl.start(); await ctl.confirm();
  assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
  assert.equal(n('app').hidden, true);
  assert.equal(n('delDone').hidden, false);
  assert.equal(D.handlesSignOut(), true, "the page's SIGNED_OUT redirect must not override the result");
});

test('a stale session asks for sign-in again and returns to the deletion section, without deleting', async () => {
  const { n, ctl, calls, fill, location } = setup({ responses: [{ status: 401, body: { reason: 'reauth_required' } }] });
  fill(); ctl.start(); await ctl.confirm();
  assert.equal(calls.signOut.length, 0, 'no sign-out until the person chooses to sign in again');
  assert.equal(n('delReauth').hidden, false);
  assert.match(n('delStatus').textContent, /Nothing has been deleted/);
  await ctl.reauth();
  assert.equal(calls.signOut.length, 1);
  assert.equal(location.href, 'login.html?next=' + encodeURIComponent('profile.html#delete-account'));
  assert.equal(D.handlesSignOut(), true);
});

test('partial cleanup keeps the person signed in and allows a retry', async () => {
  const { n, ctl, calls, fill } = setup({ responses: [
    { status: 409, body: { status: 'incomplete', reason: 'partial_cleanup', message: 'x' } },
    { status: 200, body: { status: 'deleted' } },
  ] });
  fill(); ctl.start(); await ctl.confirm();
  assert.equal(calls.signOut.length, 0);
  assert.match(n('delStatus').textContent, /cannot be restored/);
  assert.equal(n('delConfirm').disabled, false);
  assert.equal(n('app').hidden, false);
  ctl.start(); await ctl.confirm();
  assert.equal(calls.fetch.length, 2);
  assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
});

test('a server-side mismatch is shown on the matching field', async () => {
  const { n, ctl, fill } = setup({ responses: [{ status: 400, body: { reason: 'email_mismatch' } }] });
  fill(); ctl.start(); await ctl.confirm();
  assert.match(n('delEmailErr').textContent, /does not match/);
});

test('a network failure does not claim anything was deleted', async () => {
  const { n, ctl, calls, fill } = setup({ responses: ['network'] });
  fill(); ctl.start(); await ctl.confirm();
  assert.equal(calls.signOut.length, 0);
  assert.match(n('delStatus').textContent, /cannot confirm/);
});

test('a failed session read offers sign-in again without leaving the button stuck', async () => {
  const { n, ctl, calls, fill } = setup({ session: 'throw' });
  fill(); ctl.start(); await ctl.confirm();
  assert.equal(calls.fetch.length, 0);
  assert.equal(n('delConfirm').disabled, false);
  assert.equal(n('delReauth').hidden, false);
});
