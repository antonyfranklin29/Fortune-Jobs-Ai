// email-preferences.html: the signed-in person's weekly newsletter choice.
// Port of newsletter-preferences.js. The choice is read and saved only through
// the email-preferences Edge Function with the person's own session token.
import React, { useEffect, useRef, useState } from 'react';

const NOT_AVAILABLE = 'Newsletter preferences are not available yet. Your choice has not been changed.';

/** @param {{ sb: object, config: { url: string, key: string }, fetch?: typeof fetch }} services */
export function createPreferenceClient({ sb, config, fetch: fetchImpl = (...a) => window.fetch(...a) }) {
  return {
    async user() {
      const { data, error } = await sb.auth.getSession();
      return error ? null : data?.session?.user || null;
    },
    async request(body) {
      const { data, error } = await sb.auth.getSession();
      if (error || !data?.session) throw new Error('Please sign in to manage email preferences.');
      const response = await fetchImpl(config.url + '/functions/v1/email-preferences', {
        method: body ? 'POST' : 'GET',
        headers: { apikey: config.key, Authorization: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(NOT_AVAILABLE);
      return response.json();
    },
  };
}

export function EmailPreferencesPage({ client }) {
  const [subscribed, setSubscribed] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Checking your preferences…');
  const [signIn, setSignIn] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        if (!client) throw new Error('Accounts are temporarily unavailable.');
        if (!(await client.user())) { if (mounted.current) { setStatus('Sign in to manage your email preferences.'); setSignIn(true); } return; }
        const current = await client.request();
        if (!mounted.current) return;
        setSubscribed(!!current.subscribed);
        setStatus(current.delivery_active ? 'Your current email preference is shown above.' : 'Newsletter delivery is not active yet. You can choose whether to receive it when it launches.');
        setReady(true);
      } catch (error) {
        if (mounted.current) setStatus(error.message);
      }
    })();
    return () => { mounted.current = false; };
  }, [client]);

  async function onSubmit(event) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      const data = await client.request({ subscribed, consent_version: 'weekly-v1' });
      setSubscribed(!!data.subscribed);
      setStatus(data.delivery_active ? 'Preference saved. Weekly emails follow your choice.' : 'Preference saved. Newsletter delivery is not active yet; we’ll use this choice when it launches.');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  const disabled = !ready || busy;
  return <>
    <nav className="top-nav"><a className="logo-text" href="index.html">Fortune Jobs AI</a><a className="nav-link" href="profile.html">Back to profile</a></nav>
    <main>
      <h1>Your weekly job digest</h1>
      <p>A short email every seven days with relevant recent jobs, one career tip, and occasional product updates. If we have no suitable fresh listings, we skip that issue.</p>
      <form id="preferences" onSubmit={onSubmit}>
        <label><input type="checkbox" id="weekly" disabled={disabled} checked={subscribed} onChange={(e) => setSubscribed(e.target.checked)} /><span>Yes, email me the Fortune Jobs AI weekly newsletter. I can unsubscribe at any time.</span></label>
        <p style={{ fontSize: '14px' }}>Optional. Creating an account or signing in with Google does not subscribe you. These promotional emails use your saved role and search filters; résumé documents are not sent to the email provider.</p>
        <button className="btn btn-primary" type="submit" id="save" disabled={disabled}>Save email preference</button>
      </form>
      <p id="status" role="status" aria-live="polite">{status}{signIn && <a href="login.html?next=email-preferences.html"> Sign in</a>}</p>
      <p><a href="privacy.html">Privacy</a> · <a href="mailto:info@fortunejobsai.com">info@fortunejobsai.com</a></p>
    </main>
  </>;
}
