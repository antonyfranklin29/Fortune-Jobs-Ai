// Self-service account deletion on profile.html.
//
// Deletion runs only from an explicit click on the final "Delete permanently"
// button, never from page load, a link, a hash or a return from sign-in. The
// server (supabase/functions/delete-account) re-checks everything: a recent
// interactive sign-in, the typed phrase and the caller's own email.
(function (root) {
  'use strict';
  const PHRASE = 'DELETE MY ACCOUNT';
  const RETURN_TO = 'profile.html#delete-account';

  function validate(input, accountEmail) {
    const errors = {};
    if (String(input.phrase || '').trim() !== PHRASE) errors.phrase = `Type ${PHRASE} exactly, in capital letters.`;
    const email = String(input.email || '').trim().toLowerCase();
    if (!email) errors.email = 'Enter the email address for this account.';
    else if (!accountEmail || email !== String(accountEmail).trim().toLowerCase()) errors.email = 'This does not match the email address for this account.';
    if (input.understood !== true) errors.understood = 'Confirm that you understand deletion is permanent.';
    return { ok: Object.keys(errors).length === 0, errors };
  }

  // Map the server's answer to what the person sees. Each case is distinct.
  function outcome(status, body) {
    const b = body && typeof body === 'object' ? body : {};
    if (status === 200 && b.status === 'deleted') return { kind: 'deleted', message: 'Your account and personal data have been deleted.' };
    if (b.reason === 'reauth_required' || b.reason === 'not_authenticated' || status === 401) {
      return { kind: 'reauth', message: 'For your security, sign in again, then come back here to delete your account. Nothing has been deleted.' };
    }
    if (b.reason === 'confirmation_required') return { kind: 'phrase', message: `Type ${PHRASE} exactly. Nothing has been deleted.` };
    if (b.reason === 'email_mismatch') return { kind: 'email', message: 'The email address does not match this account. Nothing has been deleted.' };
    if (b.status === 'incomplete' && b.reason === 'identity_not_closed') {
      return { kind: 'identity', message: 'Your data was permanently deleted, but the account itself could not be closed. Please try again.' };
    }
    if (b.status === 'incomplete') {
      return { kind: 'partial', message: 'We could not finish deleting your data. Anything already removed is permanently deleted and cannot be restored. Your account is still open, so you can try again.' };
    }
    if (status === 0) return { kind: 'unknown', message: 'We could not reach the deletion service, so we cannot confirm what happened. Reload this page: if your account is still here, try again.' };
    return { kind: 'unknown', message: 'Deletion is unavailable right now. Nothing was confirmed as deleted. Please try again later or contact info@fortunejobsai.com.' };
  }

  async function submit(fetchFn, url, token, phrase, email) {
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: phrase, email }),
      });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    } catch {
      return { status: 0, body: null };
    }
  }

  // Binds the controls in profile.html. Returns the controller for tests.
  function mount(env) {
    const { doc, FJ, url, user, location } = env;
    const $ = (id) => doc.getElementById(id);
    const el = {
      phrase: $('delPhrase'), email: $('delEmail'), understood: $('delUnderstand'),
      start: $('delStart'), panel: $('delConfirmPanel'), confirm: $('delConfirm'), cancel: $('delCancel'),
      status: $('delStatus'), phraseErr: $('delPhraseErr'), emailErr: $('delEmailErr'), understoodErr: $('delUnderstandErr'),
      reauth: $('delReauth'), done: $('delDone'), app: $('app'),
    };
    const state = { busy: false, leaving: false, deleted: false };
    const show = (node, on) => { if (node) node.hidden = !on; };
    const setErrors = (errors) => {
      el.phraseErr.textContent = errors.phrase || '';
      el.emailErr.textContent = errors.email || '';
      el.understoodErr.textContent = errors.understood || '';
      el.phrase.setAttribute('aria-invalid', errors.phrase ? 'true' : 'false');
      el.email.setAttribute('aria-invalid', errors.email ? 'true' : 'false');
    };
    const setBusy = (on) => {
      state.busy = on;
      el.start.disabled = on; el.confirm.disabled = on; el.cancel.disabled = on;
      el.confirm.textContent = on ? 'Deleting…' : 'Delete permanently';
    };
    const values = () => ({ phrase: el.phrase.value, email: el.email.value, understood: el.understood.checked === true });

    function start() {
      if (state.busy) return;
      el.status.textContent = '';
      show(el.reauth, false);
      const v = validate(values(), user && user.email);
      setErrors(v.errors);
      if (!v.ok) { (v.errors.phrase ? el.phrase : v.errors.email ? el.email : el.understood).focus(); return; }
      show(el.panel, true);
      el.confirm.focus();
    }
    function cancel() {
      if (state.busy) return;
      show(el.panel, false);
      el.start.focus();
    }
    async function confirm() {
      if (state.busy || state.deleted) return;          // one request at a time
      const v = validate(values(), user && user.email);
      setErrors(v.errors);
      if (!v.ok) { show(el.panel, false); return; }
      setBusy(true);
      el.status.textContent = 'Deleting your account. Keep this page open…';
      let token = '';
      try {
        const { data } = await FJ.sb.auth.getSession();
        token = data && data.session ? data.session.access_token : '';
      } catch { /* Treat a session read failure as a sign-in failure. */ }
      const r = token ? await submit(env.fetch, url, token, el.phrase.value.trim(), el.email.value.trim()) : { status: 401, body: { reason: 'not_authenticated' } };
      const o = outcome(r.status, r.body);
      if (o.kind === 'deleted') {
        state.deleted = true; state.leaving = true;
        // The server already ended every session; only the local copy remains.
        try { await FJ.sb.auth.signOut({ scope: 'local' }); } catch { /* already gone */ }
        show(el.app, false); show(el.done, true);
        el.done.focus && el.done.focus();
        return;
      }
      setBusy(false);
      show(el.panel, false);
      el.status.textContent = o.message;
      if (o.kind === 'phrase') setErrors({ phrase: o.message });
      if (o.kind === 'email') setErrors({ email: o.message });
      if (o.kind === 'reauth') { show(el.reauth, true); el.reauth.focus(); }
    }
    async function reauth() {
      if (state.busy) return;
      state.leaving = true;           // the page's own SIGNED_OUT redirect must not win
      try { await FJ.sb.auth.signOut(); } catch { /* continue to sign-in */ }
      location.href = FJ.loginUrl(RETURN_TO);
    }
    el.start.addEventListener('click', start);
    el.cancel.addEventListener('click', cancel);
    el.confirm.addEventListener('click', confirm);
    el.reauth.addEventListener('click', reauth);
    return { start, cancel, confirm, reauth, state };
  }

  let active = null;
  const api = {
    PHRASE, RETURN_TO, validate, outcome, submit,
    mount(env) { active = mount(env); return active; },
    // profile.html asks this before its own redirect on SIGNED_OUT.
    handlesSignOut() { return !!(active && active.state.leaving); },
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FJAccountDeletion = api;
})(typeof window === 'object' ? window : globalThis);
