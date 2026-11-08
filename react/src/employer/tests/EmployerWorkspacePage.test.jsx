import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountServicesProvider, createAccountServices } from '../../account/services.jsx';
import { EmployerWorkspacePage } from '../EmployerWorkspacePage.jsx';
import { CONFIG, fakeLocation, fakeSupabase } from '../../account/tests/fakeSupabase.js';

afterEach(cleanup);
const PLAN = { free_active_posts: 15, monthly_price_cents: 1499 };
const company = { id: 'org1', name: 'Private Synthetic Company', primary_domain: 'synthetic.com', status: 'verified', domain_verified: true, active_limit: 15, active_posts: 2, posts: [], sources: [] };

function mount({ user = null, state = { orgs: [], plan: PLAN }, queue = null, rpc = {}, prompt = () => '' } = {}) {
  const sb = fakeSupabase({
    user,
    rpc: {
      employer_my_state: () => ({ data: typeof state === 'function' ? state() : state, error: null }),
      operator_queue: () => (queue ? { data: queue, error: null } : { data: null, error: { message: 'operator_only' } }),
      ...rpc,
    },
  });
  const fetch = async (url) => ({ ok: true, json: async () => (url.includes('job-roles') ? { roles: [{ id: 'data_analyst', name: 'Data Analyst' }] } : { regions: [{ code: 'NC', name: 'North Carolina' }] }) });
  const navigated = [];
  const services = createAccountServices({ sb, config: CONFIG, location: fakeLocation('https://fortunejobsai.com/employers.html'), fetch, navigate: (u) => navigated.push(u) });
  render(<AccountServicesProvider services={services}><EmployerWorkspacePage prompt={prompt} /></AccountServicesProvider>);
  return { sb, navigated, rpcCalls: () => sb.calls.filter((c) => c[0] === 'rpc').map((c) => c.slice(1)) };
}

describe('EmployerWorkspacePage', () => {
  it('signed-out visitors see employer entry and never request company data', async () => {
    const b = mount();
    await screen.findByText('Your company has its own space');
    expect(screen.getByRole('link', { name: 'Employer sign in' }).getAttribute('href')).toBe('employer-login.html?next=employers.html');
    expect(b.rpcCalls()).toEqual([]);
  });

  it('user metadata cannot create a company membership: only server state is used', async () => {
    const b = mount({ user: { email: 'fixture@synthetic.com', user_metadata: { is_employer: true, role: 'operator' } } });
    await screen.findByText('Register your organization');
    expect(b.rpcCalls().map((c) => c[0])).toEqual(['employer_my_state', 'operator_queue']);
    expect(screen.queryByText('Review queue')).toBeNull();
    expect(screen.queryByLabelText('Company overview')).toBeNull();
  });

  it('shows companies, the overview and the server quota', async () => {
    mount({ user: { email: 'hr@synthetic.com' }, state: { orgs: [company], plan: PLAN } });
    await screen.findByText('Private Synthetic Company');
    const overview = screen.getByLabelText('Company overview');
    expect(overview.textContent).toMatch(/1Companies/);
    expect(overview.textContent).toMatch(/2Active jobs/);
    expect(screen.getByRole('img', { name: '2 of 15 active posts used' })).toBeTruthy();
    expect(screen.getByText('$14.99/month')).toBeTruthy();
    expect(screen.getByText('Not available yet')).toBeTruthy();
  });

  it('pending companies see review guidance without any DNS task', async () => {
    mount({ user: { email: 'hr@synthetic.com' }, state: { orgs: [{ ...company, status: 'pending', dns_record: '_x', dns_value: 'secret-fixture' }], plan: PLAN } });
    await screen.findByText(/awaiting review/);
    expect(document.body.textContent).not.toMatch(/secret-fixture/);
  });

  it('registers with a normalized domain', async () => {
    const b = mount({ user: { email: 'hr@synthetic.com' }, rpc: { employer_register_org: () => ({ data: {}, error: null }) } });
    await screen.findByText('Register your organization');
    fireEvent.change(screen.getByLabelText('Organisation name'), { target: { value: ' Synthetic ' } });
    fireEvent.change(screen.getByLabelText('Company website domain'), { target: { value: 'https://www.Synthetic.com/careers' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Register' })); });
    expect(b.rpcCalls()).toContainEqual(['employer_register_org', { p_name: 'Synthetic', p_domain: 'synthetic.com' }]);
  });

  it('job posts send content fields only and require an https link', async () => {
    const b = mount({ user: { email: 'hr@synthetic.com' }, state: { orgs: [company], plan: PLAN }, rpc: { employer_save_post: () => ({ data: {}, error: null }) } });
    await screen.findByText('Private Synthetic Company');
    fireEvent.click(screen.getByRole('button', { name: 'New job post' }));
    fireEvent.change(screen.getByLabelText('Job title'), { target: { value: 'Analyst' } });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Raleigh' } });
    fireEvent.change(screen.getByLabelText('Application link'), { target: { value: 'http://jobs.synthetic.com/1' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); });
    expect(screen.getByText('The application link must start with https://')).toBeTruthy();
    expect(b.rpcCalls().some((c) => c[0] === 'employer_save_post')).toBe(false);
    fireEvent.change(screen.getByLabelText('Application link'), { target: { value: 'https://jobs.synthetic.com/1' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); });
    const [, args] = b.rpcCalls().find((c) => c[0] === 'employer_save_post');
    expect(args.p_org).toBe('org1');
    expect(args.p_post).toBeNull();
    expect(Object.keys(args.p_fields).sort()).toEqual(['apply_url', 'canonical_role', 'city', 'closing_date', 'description', 'employment_type', 'job_title', 'posting_date', 'state_code', 'work_mode']);
    expect(args.p_fields).toMatchObject({ job_title: 'Analyst', canonical_role: 'data_analyst', state_code: 'NC', work_mode: 'onsite', employment_type: 'Full-time' });
  });

  it('a rejected edit to a live post explains that the live version is unchanged', async () => {
    const post = { id: 'p1', job_title: 'Analyst', status: 'published', city: 'Raleigh', state_code: 'NC', employment_type: 'Full-time', work_mode: 'remote', closing_date: '2026-12-01', review_note: 'Fix the salary', has_unreviewed_changes: false };
    mount({ user: { email: 'hr@synthetic.com' }, state: { orgs: [{ ...company, posts: [post] }], plan: PLAN } });
    await screen.findByText(/latest edits were not approved; the live version is unchanged. Reviewer note: Fix the salary/);
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('reviewers see the queue only when the server returns it, and need recorded evidence', async () => {
    const queue = { orgs: [{ id: 'org9', name: 'Other Co', domain: 'other.com', domain_verified: false, registrant_email: 'a@other.com' }], posts: [], sources: [] };
    const b = mount({ user: { email: 'reviewer@fortunejobsai.com' }, queue, prompt: () => '   ',
      rpc: { operator_verify_domain: () => ({ data: {}, error: null }), operator_set_org_status: () => ({ data: {}, error: null }) } });
    await screen.findByText('Review queue');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await act(async () => {});
    expect(b.rpcCalls().some((c) => c[0].startsWith('operator_verify') || c[0] === 'operator_set_org_status')).toBe(false);
  });

  it('a company verified by work email can be confirmed or suspended from the queue', async () => {
    const queue = { orgs: [{ id: 'org7', name: 'Acme', domain: 'acme.com', status: 'verified', domain_verified: true, auto_verified: true, active_posts: 2, registrant_email: 'jane@acme.com' }], posts: [], sources: [] };
    const b = mount({ user: { email: 'reviews@fortunejobsai.com' }, queue, prompt: () => 'Checked acme.com and LinkedIn',
      rpc: { operator_set_org_status: () => ({ data: {}, error: null }) } });
    await screen.findByText(/verified by work email · 2 live jobs/);
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(b.rpcCalls().find((c) => c[0] === 'operator_set_org_status')?.[1]).toEqual({ p_org: 'org7', p_status: 'verified', p_note: 'Checked acme.com and LinkedIn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(b.rpcCalls().filter((c) => c[0] === 'operator_set_org_status').at(-1)[1].p_status).toBe('suspended'));
    expect(b.rpcCalls().some((c) => c[0] === 'operator_verify_domain')).toBe(false);
  });

  it('a new company sees its first-week limit', async () => {
    mount({ user: { email: 'hr@synthetic.com' }, state: { orgs: [{ ...company, active_limit: 3 }], plan: PLAN } });
    await screen.findByText(/Verified by your work email. During your first week you can keep up to 3 live jobs/);
  });

  it('a post without a visible description cannot be approved', async () => {
    const queue = { orgs: [], posts: [{ id: 'p2', job_title: 'Analyst', org: 'Other Co', revision: 3, description: '' }], sources: [] };
    mount({ user: { email: 'reviewer@fortunejobsai.com' }, queue });
    expect((await screen.findByRole('button', { name: 'Approve this revision' })).disabled).toBe(true);
  });

  it('signing out clears private company content', async () => {
    let user = { email: 'hr@synthetic.com' };
    const b = mount({ user, state: { orgs: [company], plan: PLAN } });
    await screen.findByText('Private Synthetic Company');
    user = null; b.sb.setUser(null);
    await act(async () => { b.sb.emit('SIGNED_OUT'); });
    await waitFor(() => expect(screen.queryByText('Private Synthetic Company')).toBeNull());
    expect(screen.getByText('Your company has its own space')).toBeTruthy();
  });

  it('missing employer functions show a setup message, not an error dump', async () => {
    mount({ user: { email: 'hr@synthetic.com' }, rpc: { employer_my_state: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
    await screen.findByText(/Employer setup is being prepared/);
  });
});
