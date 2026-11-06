import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EmailPreferencesPage, createPreferenceClient } from '../index.js';

afterEach(cleanup);
const $ = (id) => document.getElementById(id);
function fakeSb(session) { return { auth: { getSession: vi.fn(async () => ({ data: { session }, error: null })) } }; }
const SESSION = { access_token: 'tok-123', user: { id: 'u1', email: 'a@b.co' } };
const CONFIG = { url: 'https://project.supabase.co', key: 'anon-key' };
const reply = (body, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));

describe('EmailPreferencesPage', () => {
  it('signed out: shows the sign-in link and keeps the form disabled', async () => {
    const fetch = reply({});
    render(<EmailPreferencesPage client={createPreferenceClient({ sb: fakeSb(null), config: CONFIG, fetch })} />);
    await waitFor(() => expect($('status').textContent).toBe('Sign in to manage your email preferences. Sign in'));
    expect($('status').querySelector('a').getAttribute('href')).toBe('login.html?next=email-preferences.html');
    expect($('weekly').disabled).toBe(true); expect($('save').disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the current choice with the session token, then saves the new one', async () => {
    const fetch = vi.fn(async (_url, init) => ({ ok: true, json: async () => (init.method === 'GET' ? { subscribed: false, delivery_active: false } : { subscribed: true, frequency: 'daily', delivery_active: false }) }));
    render(<EmailPreferencesPage client={createPreferenceClient({ sb: fakeSb(SESSION), config: CONFIG, fetch })} />);
    await waitFor(() => expect($('save').disabled).toBe(false));
    expect($('status').textContent).toBe('Job alert emails are starting soon. Choose now and we’ll use it when they launch.');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://project.supabase.co/functions/v1/email-preferences');
    expect(init).toMatchObject({ method: 'GET', headers: { apikey: 'anon-key', Authorization: 'Bearer tok-123' } });
    fireEvent.click($('weekly'));
    fireEvent.submit($('preferences'));
    await waitFor(() => expect($('status').textContent).toBe('Saved. Job alerts start soon; we’ll email you every morning.'));
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ subscribed: true, frequency: 'daily', consent_version: 'alerts-v2' }) });
    expect($('weekly').checked).toBe(true);
  });

  it('active delivery uses the active wording', async () => {
    const fetch = vi.fn(async (_u, init) => ({ ok: true, json: async () => (init.method === 'GET' ? { subscribed: true, frequency: 'weekly', delivery_active: true } : JSON.parse(init.body) && { subscribed: true, frequency: JSON.parse(init.body).frequency, delivery_active: true }) }));
    render(<EmailPreferencesPage client={createPreferenceClient({ sb: fakeSb(SESSION), config: CONFIG, fetch })} />);
    await waitFor(() => expect($('status').textContent).toBe('Your current email preference is shown above.'));
    expect($('weekly').checked).toBe(true);
    expect(document.querySelector('input[value=weekly]').checked).toBe(true); // keeps the saved frequency
    fireEvent.click(document.querySelector('input[value=daily]'));
    fireEvent.submit($('preferences'));
    await waitFor(() => expect($('status').textContent).toBe('Saved. We’ll email new matching jobs every morning.'));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ subscribed: true, frequency: 'daily', consent_version: 'alerts-v2' });
  });

  it('a failed request says nothing changed; a missing client says accounts are unavailable', async () => {
    render(<EmailPreferencesPage client={createPreferenceClient({ sb: fakeSb(SESSION), config: CONFIG, fetch: reply({}, false) })} />);
    await waitFor(() => expect($('status').textContent).toBe('Newsletter preferences are not available yet. Your choice has not been changed.'));
    expect($('save').disabled).toBe(true);
    cleanup();
    render(<EmailPreferencesPage client={null} />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Accounts are temporarily unavailable.'));
  });

  it('explains unconfirmed email and expired sessions', async () => {
    const confirm = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Confirm your email first' }) }));
    render(<EmailPreferencesPage client={createPreferenceClient({ sb: fakeSb(SESSION), config: CONFIG, fetch: confirm })} />);
    await waitFor(() => expect($('status').textContent).toBe('Confirm your email address first, using the link we sent, then reload this page.'));
    cleanup();
    const expired = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    render(<EmailPreferencesPage client={createPreferenceClient({ sb: fakeSb(SESSION), config: CONFIG, fetch: expired })} />);
    await waitFor(() => expect($('status').textContent).toBe('Your session has expired. Sign in again to manage email preferences.'));
  });

  it('shows the job alert wording (daily or weekly, opt-in)', () => {
    render(<EmailPreferencesPage client={null} />);
    const text = document.body.textContent;
    expect(text).toContain('Job alert emails');
    expect(text).toContain('Creating an account or signing in with Google does not subscribe you.');
    expect(screen.getByLabelText('Daily, each morning')).toBeTruthy();
    expect(screen.getByLabelText('Weekly')).toBeTruthy();
    expect(document.querySelector('fieldset.alert-frequency').disabled).toBe(true); // until opted in
  });
});
