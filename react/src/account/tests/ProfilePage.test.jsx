import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountServicesProvider, createAccountServices } from '../services.jsx';
import { ProfilePage, completeness, filterText, searchUrl } from '../ProfilePage.jsx';
import { CONFIG, fakeLocation, fakeSupabase } from './fakeSupabase.js';

afterEach(cleanup);
const USER = { id: 'u1', email: 'jane@example.com' };
const PROFILE = { id: 'u1', full_name: 'Jane Doe', current_title: 'Data Analyst', skills: ['SQL'], preferred_locations: [], job_types: ['fulltime'], years_experience: 4 };

function mount({ user = USER, profile = PROFILE, saved = [], saveProgress, history = [], fetch } = {}) {
  const sb = fakeSupabase({ user, tables: {
    profiles: (q) => (q.ops.some(([op]) => op === 'update') ? { data: { ...profile, ...q.ops.find(([op]) => op === 'update')[1] }, error: null } : { data: profile, error: null }),
    saved_jobs: (q) => {
      const update = q.ops.find(([op]) => op === 'update');
      if (update) return saveProgress(update[1]);
      const [, start, end] = q.ops.find(([op]) => op === 'range');
      return { data: saved.slice(start, end + 1), error: null };
    },
    search_history: { data: history, error: null },
  } });
  const loc = fakeLocation('https://fortunejobsai.com/profile.html');
  const navigated = [];
  const services = createAccountServices({ sb, config: CONFIG, location: loc, navigate: (u) => navigated.push(u), fetch: fetch || (async () => ({ status: 500, json: async () => ({}) })) });
  render(<AccountServicesProvider services={services}><ProfilePage /></AccountServicesProvider>);
  return { sb, loc, navigated };
}

describe('ProfilePage', () => {
  it('sends signed-out visitors to sign in with a return path', async () => {
    const { loc } = mount({ user: null });
    await waitFor(() => expect(loc.replaced).toEqual(['login.html?next=profile.html']));
  });

  it('shows the profile, completeness and history links', async () => {
    mount({ history: [{ id: 1, query: 'data analyst', mode: 'quick', filters: { location: 'Raleigh', work_mode: 'remote' }, created_at: new Date().toISOString() }] });
    await screen.findByRole('heading', { name: 'Jane Doe' });
    expect(screen.getByText(/complete/).textContent).toMatch(/63%/); // name, title, experience, skills, job types: 5 of 8
    const again = await screen.findByRole('link', { name: 'Search again' });
    expect(again.getAttribute('href')).toBe('index.html?q=data+analyst&mode=quick&location=Raleigh&work_mode=remote');
  });

  it('never links an unsafe saved-job URL and credits Adzuna', async () => {
    mount({ saved: [
      { id: 1, job_title: 'Analyst', company: 'Acme', apply_url: 'javascript:alert(1)', created_at: new Date().toISOString() },
      { id: 2, job_title: 'Engineer', company: 'Beta', apply_url: 'https://www.adzuna.com/details/9', created_at: new Date().toISOString() },
    ] });
    await screen.findByText('Engineer');
    const applies = screen.getAllByRole('link', { name: 'Apply →' });
    expect(applies.map((a) => a.getAttribute('href'))).toEqual(['https://www.adzuna.com/details/9']);
    expect(screen.getByRole('link', { name: 'Jobs supplied by Adzuna' })).toBeTruthy();
  });

  it('saves a private note and stage, updates counts, and filters saved jobs', async () => {
    const { sb } = mount({
      saved: [{ id: 1, job_title: 'Engineer', created_at: '2026-01-01T12:00:00Z' }],
      saveProgress: changes => ({ data: { ...changes, stage_changed_at: '2026-02-01T12:00:00Z' }, error: null }),
    });
    const stage = await screen.findByLabelText('Stage for Engineer');
    expect(stage.value).toBe('saved');
    fireEvent.change(stage, { target: { value: 'interview' } });
    const note = screen.getByLabelText('Private note for Engineer');
    expect(note.maxLength).toBe(500);
    fireEvent.change(note, { target: { value: '  Follow up Friday  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Application counts' }).textContent).toContain('Interview 1'));
    expect(sb.calls.find(([, table]) => table === 'saved_jobs')[2]).toEqual(expect.arrayContaining([
      ['update', { stage: 'interview', application_note: 'Follow up Friday' }], ['eq', 'id', 1],
    ]));
    expect(screen.getByLabelText('Private note for Engineer').value).toBe('Follow up Friday');
    expect(screen.getByText('Stage changed').querySelector('time').dateTime).toBe('2026-02-01T12:00:00Z');
    fireEvent.change(screen.getByLabelText('Filter by stage'), { target: { value: 'offer' } });
    expect(screen.getByText('No jobs at this stage.')).toBeTruthy();
  });

  it('keeps unsaved input and counts on a write error', async () => {
    mount({
      saved: [{ id: 1, job_title: 'Engineer', created_at: '2026-01-01T12:00:00Z' }],
      saveProgress: () => ({ data: null, error: { message: 'write failed' } }),
    });
    fireEvent.change(await screen.findByLabelText('Stage for Engineer'), { target: { value: 'applied' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }));
    await screen.findByText("Couldn't save application progress.");
    expect(screen.getByLabelText('Stage for Engineer').value).toBe('applied');
    expect(screen.getByRole('list', { name: 'Application counts' }).textContent).toContain('Saved 1');
  });

  it('saves profile details including a typed but unconfirmed skill', async () => {
    const { sb } = mount();
    await screen.findByRole('heading', { name: 'Jane Doe' });
    fireEvent.change(screen.getByLabelText('Skills'), { target: { value: 'Python' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save profile' })); });
    const saved = sb.calls.find((c) => c[0] === 'from' && c[1] === 'profiles' && c[2].some(([op]) => op === 'update'));
    expect(saved[2].find(([op]) => op === 'update')[1]).toMatchObject({ skills: ['SQL', 'Python'], job_types: ['fulltime'], years_experience: 4 });
    expect(saved[2]).toContainEqual(['eq', 'id', 'u1']);
  });

  it('rejects out-of-range experience without saving', async () => {
    const { sb } = mount();
    await screen.findByRole('heading', { name: 'Jane Doe' });
    fireEvent.change(screen.getByLabelText('Years of experience'), { target: { value: '99' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save profile' })); });
    expect(screen.getAllByRole('alert').some((a) => a.textContent === 'Years of experience must be between 0 and 60.')).toBe(true);
    expect(sb.calls.some((c) => c[0] === 'from' && c[2].some(([op]) => op === 'update'))).toBe(false);
  });

  it('deletion needs the phrase, matching email and confirmation before any request', async () => {
    const requests = [];
    mount({ fetch: async (url, init) => { requests.push([url, init]); return { status: 200, json: async () => ({ status: 'deleted' }) }; } });
    await screen.findByRole('heading', { name: 'Delete your account' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    expect(screen.getByText(/Type DELETE MY ACCOUNT exactly/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Type DELETE MY ACCOUNT'), { target: { value: 'DELETE MY ACCOUNT' } });
    fireEvent.change(screen.getByLabelText('Your account email'), { target: { value: 'JANE@example.com' } });
    fireEvent.click(screen.getByLabelText(/I understand this is permanent/));
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    expect(requests).toEqual([]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' })); });
    expect(requests).toHaveLength(1);
    expect(requests[0][0]).toBe('https://project.supabase.co/functions/v1/delete-account');
    expect(requests[0][1].headers.authorization).toBe('Bearer token-fixture');
    expect(JSON.parse(requests[0][1].body)).toEqual({ confirm: 'DELETE MY ACCOUNT', email: 'JANE@example.com' });
    expect(await screen.findByRole('heading', { name: 'Your account has been deleted' })).toBeTruthy();
  });

  it('a reauth answer offers sign-in again and returns to the deletion section', async () => {
    const { navigated, sb, loc } = mount({ fetch: async () => ({ status: 401, json: async () => ({ reason: 'reauth_required' }) }) });
    await screen.findByRole('heading', { name: 'Delete your account' });
    fireEvent.change(screen.getByLabelText('Type DELETE MY ACCOUNT'), { target: { value: 'DELETE MY ACCOUNT' } });
    fireEvent.change(screen.getByLabelText('Your account email'), { target: { value: 'jane@example.com' } });
    fireEvent.click(screen.getByLabelText(/I understand this is permanent/));
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' })); });
    expect(screen.getByText(/sign in again, then come back here/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in again' })); sb.emit('SIGNED_OUT'); });
    expect(navigated).toEqual(['login.html?next=' + encodeURIComponent('profile.html#delete-account')]);
    expect(loc.replaced).toEqual([]);
  });

  it('signing out elsewhere sends the page to sign in', async () => {
    const { sb, loc } = mount();
    await screen.findByRole('heading', { name: 'Jane Doe' });
    await act(async () => { sb.emit('SIGNED_OUT'); });
    expect(loc.replaced).toEqual(['login.html']);
  });
});

describe('profile helpers', () => {
  it('match the legacy wording', () => {
    expect(filterText({ location: 'Raleigh', country_name: 'United States', company: 'Acme', work_mode: 'hybrid', date_posted: 7 })).toBe('📍 Raleigh, United States · 🏢 Acme · Hybrid · Past week');
    expect(searchUrl('a b', 'live', { country: 'us', foo: 'x' })).toBe('index.html?q=a+b&mode=live&country=us');
    expect(completeness({})).toEqual({ pct: 0, hint: 'Next: add your name' });
  });
});
