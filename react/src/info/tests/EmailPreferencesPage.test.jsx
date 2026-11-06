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
    const fetch = vi.fn(async (_url, init) => ({ ok: true, json: async () => (init.method === 'GET' ? { subscribed: false, delivery_active: false } : { subscribed: true, delivery_active: false }) }));
    render(<EmailPreferencesPage client={createPreferenceClient({ sb: fakeSb(SESSION), config: CONFIG, fetch })} />);
    await waitFor(() => expect($('save').disabled).toBe(false));
    expect($('status').textContent).toBe('Newsletter delivery is not active yet. You can choose whether to receive it when it launches.');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://project.supabase.co/functions/v1/email-preferences');
    expect(init).toMatchObject({ method: 'GET', headers: { apikey: 'anon-key', Authorization: 'Bearer tok-123' } });
    fireEvent.click($('weekly'));
    fireEvent.submit($('preferences'));
    await waitFor(() => expect($('status').textContent).toBe('Preference saved. Newsletter delivery is not active yet; we’ll use this choice when it launches.'));
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ subscribed: true, consent_version: 'weekly-v1' }) });
    expect($('weekly').checked).toBe(true);
  });

  it('active delivery uses the active wording', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ subscribed: true, delivery_active: true }) }));
    render(<EmailPreferencesPage client={createPreferenceClient({ sb: fakeSb(SESSION), config: CONFIG, fetch })} />);
    await waitFor(() => expect($('status').textContent).toBe('Your current email preference is shown above.'));
    expect($('weekly').checked).toBe(true);
    fireEvent.submit($('preferences'));
    await waitFor(() => expect($('status').textContent).toBe('Preference saved. Weekly emails follow your choice.'));
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

  it('keeps the static wording of the page', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const old = new DOMParser().parseFromString(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'legacy/email-preferences.html'), 'utf8'), 'text/html');
    old.querySelectorAll('script,style,#status').forEach((n) => n.remove());
    render(<EmailPreferencesPage client={null} />);
    const page = document.body.cloneNode(true); page.querySelector('#status').remove();
    const norm = (s) => s.replace(/\s/g, '');
    expect(norm(page.textContent)).toBe(norm(old.body.textContent));
  });
});
