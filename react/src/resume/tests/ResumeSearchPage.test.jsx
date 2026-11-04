import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResumeSearchPage } from '../ResumeSearchPage.jsx';
import { ResumeServicesProvider, createResumeServices } from '../services.jsx';
import * as Guest from '../lib/guestResume.js';

afterEach(cleanup);
function memoryStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; }
// Location detection is deliberately conservative (legacy behaviour): this header yields no region.
const RESUME = 'Priya Raman\nData Analyst\nEdison, New Jersey | priya@example.com\nProfessional Experience\nData Analyst, Example Co.\nJan 2021 - Present\nSQL, Python and Power BI reporting.';
function setup({ search = '', storage = memoryStorage(), pdfToText = vi.fn(async () => RESUME), docxToText } = {}) {
  const navigate = vi.fn();
  const services = createResumeServices({ storage, navigate, search: () => search, pdfToText, docxToText, catalog: () => ({ titles: ['Data Analyst'], skills: [] }) });
  render(<ResumeServicesProvider services={services}><ResumeSearchPage /></ResumeServicesProvider>);
  return { navigate, storage, pdfToText };
}
const file = (name, body = 'x', type = 'application/pdf') => new File([body], name, { type });
const upload = (f) => fireEvent.change(document.getElementById('guestResumeFile'), { target: { files: [f] } });

describe('ResumeSearchPage', () => {
  it('keeps the no-résumé routes and privacy copy', () => {
    setup();
    expect(document.querySelectorAll('a[href="find-jobs.html?resume=0"]').length).toBe(2);
    expect(screen.getByText(/not uploaded to our résumé storage/)).toBeTruthy();
    expect(screen.getByText(/not ATS scores or hiring predictions/)).toBeTruthy();
    expect(document.getElementById('guestReview')).toBeNull();
    expect(document.getElementById('guestCountry')).toBeNull();
  });

  it('manual profile: no file needed, validates, saves and navigates with the match id', () => {
    const { navigate, storage } = setup();
    fireEvent.click(screen.getByText('Enter experience and skills instead'));
    expect(screen.getByRole('status').textContent).toMatch(/No résumé file is needed/);
    fireEvent.change(document.getElementById('guestRole'), { target: { value: 'QA Engineer' } });
    fireEvent.submit(document.getElementById('guestReview'));
    expect(screen.getByRole('status').textContent).toMatch(/Add at least one skill/);
    fireEvent.change(document.getElementById('guestSkills'), { target: { value: Array.from({ length: 31 }, (_, i) => 's' + i).join(',') } });
    fireEvent.submit(document.getElementById('guestReview'));
    expect(screen.getByRole('status').textContent).toBe('Choose up to 30 skills for matching.');
    fireEvent.change(document.getElementById('guestSkills'), { target: { value: 'Selenium, Git' } });
    fireEvent.change(document.getElementById('guestCountry'), { target: { value: 'in' } });
    fireEvent.submit(document.getElementById('guestReview'));
    const saved = Guest.load(storage);
    expect(saved).toMatchObject({ current_title: 'QA Engineer', skills: ['Selenium', 'Git'], country: 'in' });
    expect(navigate).toHaveBeenCalledWith('find-jobs.html?resume=1&resume_id=' + encodeURIComponent(saved.match_id));
  });

  it('?manual=1 opens the manual form; ?edit=1 loads or reports expiry', () => {
    setup({ search: '?manual=1' });
    expect(document.getElementById('guestReview')).toBeTruthy();
    cleanup();
    setup({ search: '?edit=1' });
    expect(screen.getByRole('status').textContent).toMatch(/expired/);
    cleanup();
    const storage = memoryStorage();
    Guest.save(storage, { current_title: 'Nurse', skills: ['Nursing'], city: 'Austin', region: 'Texas', scope: 'city', country: 'us' });
    setup({ search: '?edit=1', storage });
    expect(document.getElementById('guestRole').value).toBe('Nurse');
    expect(document.getElementById('guestScope').value).toBe('city');
    expect(document.getElementById('guestCountry').value).toBe('us');
  });

  it('reads a résumé locally, shows detected details and the estimate note', async () => {
    const { pdfToText } = setup();
    upload(file('cv.pdf'));
    await waitFor(() => expect(document.getElementById('guestReview')).toBeTruthy());
    expect(pdfToText).toHaveBeenCalledTimes(1);
    expect(document.getElementById('guestRole').value).toBe('Data Analyst');
    expect(document.getElementById('guestSkills').value).toMatch(/SQL/);
    expect(document.getElementById('guestYears').value).toBe('5.8');
    expect(document.getElementById('guestScope').value).toBe('city');
    expect(screen.getByText(/Experience is estimated from dated work history/)).toBeTruthy();
  });

  it('rejects wrong types, empty or large files and unreadable text', async () => {
    setup({ pdfToText: vi.fn(async () => 'short') });
    upload(file('cv.doc'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Convert older DOC files/));
    upload(new File([], 'cv.pdf'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/nonempty file under 5 MB/));
    upload(file('cv.pdf'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Scanned PDFs need OCR/));
    expect(screen.getByRole('status').className).toBe('error');
  });

  it('reports a password-protected PDF and the missing DOCX reader', async () => {
    const err = Object.assign(new Error('x'), { name: 'PasswordException' });
    setup({ pdfToText: vi.fn(async () => { throw err; }) });
    upload(file('cv.pdf'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Remove the PDF password and try again.'));
    upload(file('cv.docx'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/document reader is still loading/));
  });

  it('ignores a stale read after the person switches to manual entry', async () => {
    let release;
    setup({ pdfToText: vi.fn(() => new Promise((r) => { release = r; })) });
    upload(file('cv.pdf'));
    fireEvent.click(screen.getByText('Enter experience and skills instead'));
    release(RESUME);
    await new Promise((r) => setTimeout(r, 10));
    expect(document.getElementById('guestRole').value).toBe('');
    expect(screen.getByRole('status').textContent).toMatch(/No résumé file is needed/);
  });

  it('clears temporary details and reports blocked storage', () => {
    const storage = memoryStorage();
    Guest.save(storage, { current_title: 'Nurse', skills: ['Nursing'] });
    setup({ search: '?edit=1', storage });
    fireEvent.click(screen.getByText('Clear these details'));
    expect(storage.m.has(Guest.KEY)).toBe(false);
    expect(document.getElementById('guestReview')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Temporary résumé details cleared.');
    cleanup();
    const blocked = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => {} };
    const { navigate } = setup({ search: '?manual=1', storage: blocked });
    fireEvent.change(document.getElementById('guestRole'), { target: { value: 'Dev' } });
    fireEvent.change(document.getElementById('guestSkills'), { target: { value: 'Git' } });
    fireEvent.submit(document.getElementById('guestReview'));
    expect(screen.getByRole('status').textContent).toMatch(/could not keep the temporary matching details/);
    expect(navigate).not.toHaveBeenCalled();
  });
});
