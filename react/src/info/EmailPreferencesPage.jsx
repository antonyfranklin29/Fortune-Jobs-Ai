// email-preferences.html: the signed-in person's job alert emails (opt-in, daily or weekly).
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
      if (response.status === 401) throw new Error('Your session has expired. Sign in again to manage email preferences.');
      if (response.status === 403) {
        const detail = await response.json().catch(() => ({}));
        if (/confirm/i.test(detail.error || '')) throw new Error('Confirm your email address first, using the link we sent, then reload this page.');
      }
      if (!response.ok) throw new Error(NOT_AVAILABLE);
      return response.json();
    },
  };
}

export function EmailPreferencesPage({ client }) {
  const [subscribed, setSubscribed] = useState(false);
  const [frequency, setFrequency] = useState('daily');
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
        if (current.subscribed && (current.frequency === 'daily' || current.frequency === 'weekly')) setFrequency(current.frequency);
        setStatus(current.delivery_active ? 'Your current email preference is shown above.' : 'Job alert emails are starting soon. Choose now and we’ll use it when they launch.');
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
      const data = await client.request({ subscribed, frequency, consent_version: 'alerts-v2' });
      setSubscribed(!!data.subscribed);
      const how = data.frequency === 'daily' ? 'every morning' : 'once a week';
      setStatus(!data.subscribed ? 'Saved. You won’t get job alert emails.' : data.delivery_active ? `Saved. We’ll email new matching jobs ${how}.` : `Saved. Job alerts start soon; we’ll email you ${how}.`);
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
      <h1>Job alert emails</h1>
      <p>New jobs matching your role and area, up to five per email. If there are no new matches, we don't send anything.</p>
      <form id="preferences" onSubmit={onSubmit}>
        <label><input type="checkbox" id="weekly" disabled={disabled} checked={subscribed} onChange={(e) => setSubscribed(e.target.checked)} /><span>Yes, email me job alerts from Fortune Jobs AI. I can unsubscribe at any time.</span></label>
        <fieldset className="alert-frequency" disabled={disabled || !subscribed}><legend>How often?</legend>
          <label><input type="radio" name="frequency" value="daily" checked={frequency === 'daily'} onChange={() => setFrequency('daily')} /><span>Daily, each morning</span></label>
          <label><input type="radio" name="frequency" value="weekly" checked={frequency === 'weekly'} onChange={() => setFrequency('weekly')} /><span>Weekly</span></label>
        </fieldset>
        <p style={{ fontSize: '14px' }}>Optional. Creating an account or signing in with Google does not subscribe you. Matches use the job title on your profile and the location from your last search or profile. Résumé documents are not sent to the email provider.</p>
        <button className="btn btn-primary" type="submit" id="save" disabled={disabled}>Save email preference</button>
      </form>
      <p id="status" role="status" aria-live="polite">{status}{signIn && <a href="login.html?next=email-preferences.html"> Sign in</a>}</p>
      <p><a href="privacy.html">Privacy</a> · <a href="mailto:info@fortunejobsai.com">info@fortunejobsai.com</a></p>
    </main>
  </>;
}
