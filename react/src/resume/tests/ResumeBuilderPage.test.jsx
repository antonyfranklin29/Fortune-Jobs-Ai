import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResumeBuilderPage } from '../ResumeBuilderPage.jsx';
import { ResumeServicesProvider, createResumeServices } from '../services.jsx';

afterEach(cleanup);
const $ = (id) => document.getElementById(id);
const type = (id, value) => fireEvent.change($(id), { target: { value } });
function fakeAccount({ user = { id: 'u1', email: 'ana@x.io' }, row = null, error = null } = {}) {
  const calls = [];
  const sb = { from: (t) => { calls.push(['from', t]); const q = { select: (c) => { calls.push(['select', c]); return q; }, eq: (k, v) => { calls.push(['eq', k, v]); return q; }, maybeSingle: async () => ({ data: row, error }) }; return q; } };
  return { sb, user: vi.fn(async () => user), calls };
}
function setup(opts = {}) {
  const print = vi.fn(); const confirm = vi.fn(() => true);
  const services = createResumeServices({ print, confirm, storage: {}, search: () => '', ...opts });
  render(<ResumeServicesProvider services={services}><ResumeBuilderPage /></ResumeServicesProvider>);
  return { print, confirm };
}

describe('ResumeBuilderPage', () => {
  it('renders a live preview and keeps export gated on confirmation, name and a contact method', () => {
    const { print } = setup();
    expect($('preview').textContent).toMatch(/Your name.*Target role.*Add a contact method/);
    expect(screen.getByText('Before you export')).toBeTruthy();
    expect($('export').disabled).toBe(true);
    type('name', 'Ana Silva'); type('email', 'ana@x.io'); type('target', 'Data Analyst');
    expect($('export').disabled).toBe(true);
    fireEvent.click($('confirmed'));
    expect($('export').disabled).toBe(false);
    fireEvent.click($('export'));
    expect(print).toHaveBeenCalledTimes(1);
    type('email', '');
    expect($('export').disabled).toBe(true);
  });

  it('shows only http(s) links and the person’s own lines; advice clears when complete', () => {
    setup();
    type('name', 'Ana'); type('phone', '555'); type('target', 'Dev'); type('link', 'javascript:alert(1)');
    expect($('preview').querySelector('.contact').textContent).toBe('555');
    type('link', 'https://ana.dev');
    expect($('preview').querySelector('.contact').textContent).toBe('555  ·  https://ana.dev/');
    type('experience', 'Built reports\nLed migration'); type('skills', 'SQL');
    expect([...$('preview').querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Experience', 'Skills']);
    expect(screen.getByText('Ready to review')).toBeTruthy();
    type('experience', 'Responsible for reports');
    expect(screen.getByText(/describing what you did and the outcome/)).toBeTruthy();
  });

  it('clear asks first, then resets everything', () => {
    const confirm = vi.fn(() => false);
    setup({ confirm });
    type('name', 'Ana');
    fireEvent.click($('clear'));
    expect($('name').value).toBe('Ana');
    cleanup();
    setup();
    type('name', 'Ana'); fireEvent.click($('confirmed'));
    fireEvent.click($('clear'));
    expect($('name').value).toBe(''); expect($('confirmed').checked).toBe(false);
  });

  it('profile import: signed out shows the sign-in link; signed in previews and fills only empty fields', async () => {
    setup({ account: fakeAccount({ user: null }) });
    fireEvent.click(screen.getByText('Review saved profile'));
    await waitFor(() => expect($('profileSignIn')).toBeTruthy());
    expect($('profileSignIn').getAttribute('href')).toBe('login.html?next=resume-builder.html');
    cleanup();

    const account = fakeAccount({ row: { full_name: 'Ana Silva', current_title: 'Analyst', skills: ['SQL', 'Git'], preferred_locations: ['Austin, TX'] } });
    setup({ account });
    type('name', 'Typed Name'); fireEvent.click($('confirmed'));
    fireEvent.click(screen.getByText('Review saved profile'));
    await waitFor(() => expect($('profilePreview')).toBeTruthy());
    expect(account.calls).toContainEqual(['select', 'full_name,email,current_title,skills,preferred_locations']);
    expect(account.calls).toContainEqual(['eq', 'id', 'u1']);
    expect($('profilePreview').textContent).toMatch(/Confirmed skills: SQL, Git/);
    expect($('name').value).toBe('Typed Name');
    fireEvent.click(screen.getByText('Add reviewed profile details'));
    expect($('name').value).toBe('Typed Name');
    expect($('email').value).toBe('ana@x.io');
    expect($('skills').value).toBe('SQL\nGit');
    expect($('location').value).toBe('Austin, TX');
    expect($('confirmed').checked).toBe(false);
    expect($('profileStatus').textContent).toMatch(/saved profile has not changed/);
  });

  it('profile import handles no account service, errors and an empty profile', async () => {
    setup();
    fireEvent.click(screen.getByText('Review saved profile'));
    await waitFor(() => expect($('profileStatus').textContent).toMatch(/Accounts are unavailable/));
    cleanup();
    setup({ account: fakeAccount({ error: { message: 'denied' } }) });
    fireEvent.click(screen.getByText('Review saved profile'));
    await waitFor(() => expect($('profileStatus').textContent).toBe('Could not read your profile. Try again later.'));
    cleanup();
    setup({ account: fakeAccount({ user: { id: 'u', email: '' }, row: {} }) });
    fireEvent.click(screen.getByText('Review saved profile'));
    await waitFor(() => expect($('profileStatus').textContent).toMatch(/no details to add yet/));
  });

  it('file import reads locally, shows the source text and fills blank title and skills only', async () => {
    const text = 'Job title: Data Analyst\nSQL, Python and Tableau reporting for finance teams.';
    setup({ docxToText: vi.fn(async () => text) });
    type('skills', 'Excel'); fireEvent.click($('confirmed'));
    fireEvent.change($('importFile'), { target: { files: [new File(['x'], 'cv.docx')] } });
    await waitFor(() => expect($('sourceText')).toBeTruthy());
    expect($('sourceText').textContent).toBe(text);
    expect($('target').value).toBe('');
    fireEvent.click(screen.getByText('Use reviewed title and skills'));
    expect($('target').value).toBe('Data Analyst');
    expect($('skills').value).toBe('Excel');
    expect($('confirmed').checked).toBe(false);
  });

  it('file import rejects bad files and ignores a stale read after clear', async () => {
    setup({ pdfToText: vi.fn(async () => 'tiny') });
    fireEvent.change($('importFile'), { target: { files: [new File(['x'], 'cv.txt')] } });
    await waitFor(() => expect($('importStatus').textContent).toBe('Choose a text-based PDF or DOCX under 5 MB.'));
    fireEvent.change($('importFile'), { target: { files: [new File(['x'], 'cv.pdf')] } });
    await waitFor(() => expect($('importStatus').textContent).toMatch(/Scanned PDFs need OCR/));
    cleanup();
    let release;
    setup({ pdfToText: vi.fn(() => new Promise((r) => { release = r; })) });
    fireEvent.change($('importFile'), { target: { files: [new File(['x'], 'cv.pdf')] } });
    fireEvent.click($('clear'));
    release('Job title: Data Analyst\nSQL and Python with enough readable text here.');
    await new Promise((r) => setTimeout(r, 10));
    expect($('sourceText')).toBeNull();
    expect($('importStatus').textContent).toBe('');
  });
});
