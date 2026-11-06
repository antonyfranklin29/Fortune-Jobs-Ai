import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountServicesProvider, createAccountServices } from '../services.jsx';
import { EmployerLoginPage, LoginPage } from '../AuthPage.jsx';
import { CONFIG, fakeLocation, fakeSupabase } from './fakeSupabase.js';

afterEach(cleanup);

function mount(Page, { href = 'https://fortunejobsai.com/login.html', user = null, google = false, auth } = {}) {
  const sb = fakeSupabase({ user, auth });
  const loc = fakeLocation(href);
  const navigated = [];
  const fetch = async () => ({ ok: true, json: async () => ({ external: { google } }) });
  const services = createAccountServices({ sb, config: CONFIG, location: loc, fetch, navigate: (u) => navigated.push(u) });
  render(<AccountServicesProvider services={services}><Page /></AccountServicesProvider>);
  return { sb, loc, navigated };
}
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('LoginPage', () => {
  it('shows job seeker wording and checks sign-in providers', async () => {
    mount(LoginPage, { google: true });
    expect(screen.getByText('JOB SEEKER ACCOUNT')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Employer sign in' }).getAttribute('href')).toBe('employer-login.html');
    await waitFor(() => expect(screen.getByRole('button', { name: /Continue with Google/ }).disabled).toBe(false));
  });

  it('signs in and returns only to an allowed page', async () => {
    const { sb, navigated } = mount(LoginPage, { href: 'https://fortunejobsai.com/login.html?next=https%3A%2F%2Fevil.example%2F' });
    type('Username (email)', 'jane@example.com'); type('Password', 'secret');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); });
    expect(sb.calls).toContainEqual(['signInWithPassword', { email: 'jane@example.com', password: 'secret' }]);
    expect(navigated).toEqual(['profile.html']);
  });

  it('validates before calling Supabase', async () => {
    const { sb } = mount(LoginPage);
    type('Username (email)', 'not-an-email');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); });
    expect(screen.getByRole('alert').textContent).toBe('Please enter a valid email address.');
    expect(sb.calls.some((c) => c[0] === 'signInWithPassword')).toBe(false);
  });

  it('maps Supabase errors to friendly text', async () => {
    mount(LoginPage, { auth: { signInWithPassword: () => ({ error: { message: 'Invalid login credentials' } }) } });
    type('Username (email)', 'jane@example.com'); type('Password', 'wrong');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); });
    expect(screen.getByRole('alert').textContent).toBe('Wrong email or password.');
  });

  it('sign-up confirmation links return through login.html with a safe next', async () => {
    const { sb } = mount(LoginPage, { href: 'https://fortunejobsai.com/login.html?mode=signup&next=results.html%3Fq%3Ddata' });
    type('Full name', 'Jane'); type('Email', 'jane@example.com'); type('Password', 'longenough');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create account' })); });
    // Letters only is rejected before anything is sent (matches the Supabase rule).
    expect(screen.getByRole('alert').textContent).toBe('Use at least 8 characters, with letters and numbers.');
    expect(sb.calls.some((c) => c[0] === 'signUp')).toBe(false);
    type('Password', 'longenough7');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create account' })); });
    const call = sb.calls.find((c) => c[0] === 'signUp')[1];
    expect(call.options.emailRedirectTo).toBe('https://fortunejobsai.com/login.html?next=' + encodeURIComponent('results.html?q=data'));
    expect(call.options.data).toEqual({ full_name: 'Jane' });
    expect(screen.getByRole('alert').textContent).toMatch(/confirmation link to jane@example.com/);
  });

  it('redirects a signed-in visitor, but not on a password reset link', async () => {
    const a = mount(LoginPage, { user: { id: 'u1', email: 'a@x.com' } });
    await waitFor(() => expect(a.loc.replaced).toEqual(['profile.html']));
    cleanup();
    const b = mount(LoginPage, { href: 'https://fortunejobsai.com/login.html?mode=reset', user: { id: 'u1' } });
    await act(async () => {});
    expect(b.loc.replaced).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
  });

  it('switches to the reset form on PASSWORD_RECOVERY', async () => {
    const { sb } = mount(LoginPage);
    await act(async () => { sb.emit('PASSWORD_RECOVERY'); });
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
  });

  it('shows the callback error and stays put', async () => {
    const { loc } = mount(LoginPage, { href: 'https://fortunejobsai.com/login.html?error_code=otp_expired', user: { id: 'u1' } });
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toMatch(/expired or was already used/);
    expect(loc.replaced).toEqual([]);
  });
});

describe('EmployerLoginPage', () => {
  it('uses employer wording and always returns to the workspace', async () => {
    const { navigated } = mount(EmployerLoginPage, { href: 'https://fortunejobsai.com/employer-login.html?next=profile.html' });
    expect(screen.getByText('EMPLOYER ACCOUNT')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Welcome back, employers' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Job seeker sign in' }).getAttribute('href')).toBe('login.html');
    type('Username (email)', 'hr@company.com'); type('Password', 'secret');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); });
    expect(navigated).toEqual(['employers.html']);
  });

  it('password reset keeps the employer destination', async () => {
    const { sb } = mount(EmployerLoginPage, { href: 'https://fortunejobsai.com/employer-login.html?mode=forgot' });
    type('Email', 'hr@company.com');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send reset link' })); });
    expect(sb.calls.find((c) => c[0] === 'resetPasswordForEmail')[2]).toEqual({ redirectTo: 'https://fortunejobsai.com/login.html?mode=reset&next=employers.html' });
  });

  it('login.html with an employer next keeps employer context', () => {
    mount(LoginPage, { href: 'https://fortunejobsai.com/login.html?next=employers.html' });
    expect(screen.getByText('EMPLOYER ACCOUNT')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your next hire starts here.' })).toBeTruthy();
  });
});
