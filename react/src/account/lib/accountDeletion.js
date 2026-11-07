// ESM port of the pure parts of /account-deletion.js. The server
// (supabase/functions/delete-account) re-checks everything: a recent
// interactive sign-in, the typed phrase and the caller's own email.
// Parity is checked in tests/accountDeletion.parity.test.js.

export const PHRASE = 'DELETE MY ACCOUNT';
export const RETURN_TO = 'profile.html#delete-account';

export function validate(input, accountEmail) {
  const errors = {};
  if (String(input.phrase || '').trim() !== PHRASE) errors.phrase = `Type ${PHRASE} exactly, in capital letters.`;
  const email = String(input.email || '').trim().toLowerCase();
  if (!email) errors.email = 'Enter the email address for this account.';
  else if (!accountEmail || email !== String(accountEmail).trim().toLowerCase()) errors.email = 'This does not match the email address for this account.';
  if (input.understood !== true) errors.understood = 'Confirm that you understand deletion is permanent.';
  return { ok: Object.keys(errors).length === 0, errors };
}

// Map the server's answer to what the person sees. Each case is distinct.
export function outcome(status, body) {
  const b = body && typeof body === 'object' ? body : {};
  if (status === 200 && b.status === 'deleted') return { kind: 'deleted', message: 'Your account and personal data have been deleted.' };
  if (b.reason === 'reauth_required' || b.reason === 'not_authenticated' || status === 401) {
    return { kind: 'reauth', message: 'For your security, sign in again, then come back here to delete your account. Nothing has been deleted.' };
  }
  if (b.reason === 'confirmation_required') return { kind: 'phrase', message: `Type ${PHRASE} exactly. Nothing has been deleted.` };
  if (b.reason === 'email_mismatch') return { kind: 'email', message: 'The email address does not match this account. Nothing has been deleted.' };
  if (b.reason === 'subscription_not_cancelled') {
    return { kind: 'subscription', message: 'We could not cancel your Pro subscription, so nothing was deleted. Try again in a minute, or cancel Pro first with “Manage or cancel” under Subscription.' };
  }
  if (b.status === 'incomplete' && b.reason === 'identity_not_closed') {
    return { kind: 'identity', message: 'Your data was permanently deleted, but the account itself could not be closed. Please try again.' };
  }
  if (b.status === 'incomplete') {
    return { kind: 'partial', message: 'We could not finish deleting your data. Anything already removed is permanently deleted and cannot be restored. Your account is still open, so you can try again.' };
  }
  if (status === 0) return { kind: 'unknown', message: 'We could not reach the deletion service, so we cannot confirm what happened. Reload this page: if your account is still here, try again.' };
  return { kind: 'unknown', message: 'Deletion is unavailable right now. Nothing was confirmed as deleted. Please try again later or contact info@fortunejobsai.com.' };
}

export async function submit(fetchFn, url, token, phrase, email) {
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
