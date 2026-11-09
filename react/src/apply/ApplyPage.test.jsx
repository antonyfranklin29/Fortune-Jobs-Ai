import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ApplyPage, mailtoFor } from './ApplyPage.jsx';

afterEach(cleanup);
const ID = '0b7a2f7e-3c1d-4e5f-9a8b-1c2d3e4f5a6b';
const JOB = { job_title: 'Java Developer', company: 'VendorCo', location: 'Edison, NJ', work_mode: 'hybrid', employment_type: 'Contract',
  description: 'Build Java services.', apply_email: 'recruiting@vendorco.com', closing_date: '2026-12-09', live: true };

describe('ApplyPage', () => {
  it('shows the job and an Apply by email button for a live job', async () => {
    const client = { info: vi.fn(async () => JOB) };
    render(<ApplyPage client={client} search={`?job=${ID}`} />);
    await screen.findByText('Java Developer');
    expect(client.info).toHaveBeenCalledWith(ID);
    const href = screen.getByText('✉ Apply by email').getAttribute('href');
    expect(href).toMatch(/^mailto:recruiting@vendorco\.com\?subject=/);
    expect(decodeURIComponent(href)).toMatch(/Application: Java Developer \(via Fortune Jobs AI\)/);
    expect(screen.queryByText(/Preview: this job is not live yet/)).toBeNull();
    expect(screen.getByText(/never ask you to pay a fee/)).toBeTruthy();
  });

  it('marks a preview, and shows "no longer available" for closed or invalid jobs', async () => {
    render(<ApplyPage client={{ info: async () => ({ ...JOB, live: false }) }} search={`?job=${ID}`} />);
    await screen.findByText(/Preview: this job is not live yet/);
    cleanup();
    render(<ApplyPage client={{ info: async () => null }} search={`?job=${ID}`} />);
    await screen.findByText('This job is no longer available');
    cleanup();
    const info = vi.fn();
    render(<ApplyPage client={{ info }} search="?job=not-a-uuid" />);
    await screen.findByText('This job is no longer available');
    expect(info).not.toHaveBeenCalled();
  });

  it('encodes the subject and body safely', () => {
    const href = mailtoFor({ ...JOB, job_title: 'C++ & Go Dev?' });
    expect(href).toContain(encodeURIComponent('C++ & Go Dev?'));
  });
});
