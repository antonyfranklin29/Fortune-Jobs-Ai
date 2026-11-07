import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobFacts, ResumeKeywords, InterviewReady, keywordsFor, kitFor } from './JobInsights.jsx';

const job = { job_title: 'IT Cloud Engineer, Engineering Platform Automation', company: 'Mayo Clinic', location: 'Rochester, MN', employment_type: 'Full-time', source: 'adzuna', job_description: 'Build automation on AWS with Terraform and Python.', posted_at: new Date().toISOString() };

describe('job insights', () => {
  it('picks the role family from the title', () => {
    expect(kitFor(job).role).toBe('cloud / DevOps');
    expect(kitFor({ job_title: 'Senior Data Analyst' }).role).toBe('data analyst');
    expect(kitFor({ job_title: 'Chef' }).role).toBe('this kind of');
  });
  it('puts keywords the listing names first and marks what the résumé already has', () => {
    const k = keywordsFor(job, { skills: ['Python'] });
    expect(k.slice(0, 3).map((x) => x.keyword)).toEqual(['AWS', 'Terraform', 'Python']);
    expect(k.find((x) => x.keyword === 'Python').have).toBe(true);
    expect(k.find((x) => x.keyword === 'AWS').have).toBe(false);
  });
  it('shows facts honestly, with "Not listed" for missing pay', () => {
    render(<JobFacts job={job} />);
    expect(screen.getByText('Not listed')).toBeTruthy();
    expect(screen.getByText('Full-time')).toBeTruthy();
  });
  it('asks the AI panel to run when a helper button is clicked', () => {
    const seen = vi.fn(); window.addEventListener('fj-ai-run', (e) => seen(e.detail));
    render(<><ResumeKeywords job={job} profile={{ skills: ['Python'] }} /><InterviewReady job={job} /></>);
    fireEvent.click(screen.getByRole('button', { name: /tailor my résumé/i }));
    fireEvent.click(screen.getByRole('button', { name: /prepare answers/i }));
    expect(seen.mock.calls.map((c) => c[0])).toEqual(['tailor_resume', 'interview_prep']);
  });
});

import { ApplyReady, WhyReal, applySteps } from './JobInsights.jsx';
describe('Apply-ready and Where Apply goes', () => {
  it('counts the steps the person has done', () => {
    const steps = applySteps({ profile: { skills: ['SQL'] }, progress: { fit_explain: {}, read: true }, saved: true });
    expect(steps.filter((s) => s[2]).length).toBe(4);
    render(<ApplyReady job={job} profile={{ skills: ['SQL'] }} saved progress={{ fit_explain: {}, read: true }} />);
    expect(screen.getByText('4/6')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Do it' }).length).toBe(2);
  });
  it('says plainly where Apply goes, by source', () => {
    const { rerender } = render(<WhyReal job={{ source: 'greenhouse', company: 'Okta' }} />);
    expect(screen.getByText('Direct from the employer.')).toBeTruthy();
    rerender(<WhyReal job={{ source: 'usajobs' }} />);
    expect(screen.getByText('Official federal job.')).toBeTruthy();
    rerender(<WhyReal job={{ source: 'adzuna' }} />);
    expect(screen.getByText('Listed via Adzuna.')).toBeTruthy();
  });
});
