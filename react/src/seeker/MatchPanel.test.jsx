import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MatchPanel, short } from './MatchPanel.jsx';
import { JobDescription } from './JobViews.jsx';

const job = { job_title: 'Clinical Data Analyst', company: 'Manatee Memorial', apply_url: 'https://www.adzuna.com/details/1', job_description: 'Abstracts medical records.', source: 'adzuna' };
const profile = { skills: ['SQL'] };

describe('MatchPanel', () => {
  it('offers an AI match when the listing has too little skill detail, then shows it', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, result: { fit: 'partial', headline: 'Partial fit: SQL transfers.', strengths: ["Strong SQL work: 'Wrote advanced SQL'"], gaps: ['No clinical background'], advice: 'Learn the basics.' } });
    render(<MatchPanel job={job} profile={profile} call={call} />);
    fireEvent.click(screen.getByRole('button', { name: /get my ai match/i }));
    await waitFor(() => expect(screen.getByText('Partial fit: SQL transfers.')).toBeTruthy());
    expect(call).toHaveBeenCalledWith('fit_explain', expect.objectContaining({ job: expect.any(Object) }));
    expect(screen.getByText('Strong SQL work')).toBeTruthy();
    expect(screen.getByText('No clinical background')).toBeTruthy();
  });
  it('asks for a résumé when there is none, and never calls AI on its own', () => {
    const call = vi.fn();
    render(<MatchPanel job={{ ...job, apply_url: 'https://x.test/2' }} profile={null} call={call} />);
    expect(screen.getByText('Add your résumé')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ai match/i })).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });
  it('shortens long reasons to their gist', () => {
    expect(short("Strong SQL and data validation experience: 'Execute complex SQL'")).toBe('Strong SQL and data validation experience');
    expect(short('x '.repeat(100)).length).toBeLessThanOrEqual(141);
  });
});

describe('JobDescription', () => {
  it('shows the full text behind a toggle and links to the complete listing', () => {
    const long = 'word '.repeat(300).trim();
    render(<JobDescription job={job} description={long} url={job.apply_url} />);
    expect(screen.getByText(/…$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show full description' }));
    expect(screen.getByText(long)).toBeTruthy();
    expect(screen.getByRole('link', { name: /complete job description/i }).getAttribute('href')).toBe(job.apply_url);
  });
});
