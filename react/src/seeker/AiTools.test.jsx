import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AiJobTools, SkillGap, SmartSearch, smartSearchParams, tailoredText } from './AiTools.jsx';
import { AiPostWriter, postText } from '../employer/EmployerAi.jsx';
import { salaryTop } from './catalogue.js';

const job = { job_title: 'Power BI Developer', company: 'Fixture Co', apply_url: 'https://x.test/1', job_description: '<p>Build dashboards</p>' };

describe('AI tools', () => {
  afterEach(cleanup);
  it('smart search keeps only allowed filter values', () => {
    const p = smartSearchParams({ q: 'Power BI', location: 'New Jersey', work_mode: 'Remote', job_type: 'Gig', date_posted: '7', country: 'zz', salary_min: 120000 });
    expect(Object.fromEntries(p)).toEqual({ mode: 'quick', q: 'Power BI', location: 'New Jersey', work_mode: 'Remote', date_posted: '7', salary_min: '120000' });
  });

  it('smart search sends the sentence and opens results', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, result: { q: 'Data Analyst', location: 'Chicago' } });
    const go = vi.fn();
    render(<SmartSearch call={call} go={go} />);
    fireEvent.change(screen.getByLabelText(/describe the job/i), { target: { value: 'data analyst jobs in chicago' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith('./results.html?mode=quick&q=Data+Analyst&location=Chicago'));
    expect(call).toHaveBeenCalledWith('smart_search', { query: 'data analyst jobs in chicago' });
  });

  it('job tools show the fit answer and reuse it', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, result: { fit: 'strong', headline: 'You match the core work.', strengths: ['Power BI'], gaps: [], advice: 'Apply.' } });
    render(<AiJobTools job={job} call={call} />);
    fireEvent.click(screen.getByRole('button', { name: /Why this fits me/ }));
    expect(await screen.findByText('You match the core work.', { exact: false })).toBeTruthy();
    expect(call.mock.calls[0][1].job).toEqual({ title: 'Power BI Developer', company: 'Fixture Co', location: '', description: 'Build dashboards' });
    fireEvent.click(screen.getByRole('button', { name: /Why this fits me/ }));
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('signed-out and missing résumé errors link to the fix', async () => {
    const call = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, error: 'Sign in to use AI features.' }).mockResolvedValueOnce({ ok: false, status: 400, error: 'Add your résumé to your profile first.', need: 'resume' });
    render(<AiJobTools job={job} call={call} />);
    fireEvent.click(screen.getByRole('button', { name: /Tailor my résumé/ }));
    expect((await screen.findByRole('link', { name: 'Sign in' })).getAttribute('href')).toMatch(/^\.\/login\.html\?next=/);
    fireEvent.click(screen.getByRole('button', { name: /Interview prep/ }));
    expect((await screen.findByRole('link', { name: 'Add your résumé' })).getAttribute('href')).toBe('./profile.html#resume');
  });

  it('skill gap plan renders gaps', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, result: { ready_now: 'almost', have: ['SQL'], gaps: [{ skill: 'Spark', why: 'Big data', how_to_learn: 'Databricks Academy', weeks: 4 }], related_roles: ['BI Developer'] } });
    render(<SkillGap call={call} />);
    fireEvent.change(screen.getByLabelText('Target role'), { target: { value: 'Data Engineer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build my plan' }));
    expect(await screen.findByText('Spark')).toBeTruthy();
    expect(call).toHaveBeenCalledWith('skill_gap', { target_role: 'Data Engineer' });
  });

  it('post writer fills the description', async () => {
    const onUse = vi.fn();
    const call = vi.fn().mockResolvedValue({ ok: true, result: { summary: 'Join us.', responsibilities: ['Build pipelines'], requirements: ['SQL'], nice_to_have: [], missing_info: ['Salary range'] } });
    render(<AiPostWriter title="Data Engineer" company="Co" onUse={onUse} call={call} />);
    fireEvent.click(screen.getByRole('button', { name: /Write the description with AI/ }));
    fireEvent.change(screen.getByLabelText(/key points/), { target: { value: 'Azure, Spark, hybrid NJ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Write description' }));
    await vi.waitFor(() => expect(onUse).toHaveBeenCalledWith('Join us.\n\nWhat you will do\n• Build pipelines\n\nWhat you need\n• SQL'));
    expect(await screen.findByText('Salary range')).toBeTruthy();
  });

  it('post writer never overwrites a description edited while it waited', async () => {
    const onUse = vi.fn(); let resolve;
    const call = vi.fn(() => new Promise((r) => { resolve = r; }));
    const { rerender } = render(<AiPostWriter title="Data Engineer" current="" onUse={onUse} call={call} />);
    fireEvent.click(screen.getByRole('button', { name: /Write the description with AI/ }));
    fireEvent.change(screen.getByLabelText(/key points/), { target: { value: 'Azure, Spark, hybrid NJ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Write description' }));
    rerender(<AiPostWriter title="Data Engineer" current="My own words" onUse={onUse} call={call} />);
    resolve({ ok: true, result: { summary: 'AI text', missing_info: [] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Replace description with the AI draft' }));
    expect(onUse).toHaveBeenCalledTimes(1); expect(onUse).toHaveBeenCalledWith('AI text');
  });

  it('salary floor parsing', () => {
    expect(salaryTop('$80,000 - $95,000')).toBe(95000);
    expect(salaryTop('$55/hr')).toBe(114400);
    expect(salaryTop('120k')).toBe(120000);
    expect(salaryTop('')).toBe(0);
  });

  it('text helpers', () => {
    expect(tailoredText({ summary: 'S', experience: [{ role: 'Analyst', bullets: ['A'] }], skills: ['SQL'] })).toBe('S\n\nAnalyst\n• A\n\nSkills: SQL');
    expect(postText({ summary: 'S' })).toBe('S');
  });
});
