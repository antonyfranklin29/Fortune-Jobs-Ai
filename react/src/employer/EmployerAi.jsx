// Employer AI tools (verified companies only; the server checks this too):
// a job-post writer that fills the Description box, and a candidate shortlist.
import React, { useState } from 'react';
import { callAi } from '../shared/ai.js';
import { AiError } from '../seeker/AiTools.jsx';

export function postText(r) {
  const section = (title, items) => (items?.length ? `\n\n${title}\n${items.map((x) => `• ${x}`).join('\n')}` : '');
  return `${r.summary || ''}${section('What you will do', r.responsibilities)}${section('What you need', r.requirements)}${section('Nice to have', r.nice_to_have)}`.trim().slice(0, 8000);
}

export function AiPostWriter({ title, company, current = '', onUse, call = callAi }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [missing, setMissing] = useState([]);
  const [draft, setDraft] = useState('');
  async function write() {
    if (!title.trim()) { setError({ error: 'Add the job title first.' }); return; }
    setBusy(true); setError(null);
    const res = await call('job_post_writer', { title: title.trim().slice(0, 160), company: (company || '').slice(0, 200), notes: notes.trim().slice(0, 4000) });
    setBusy(false);
    if (!res.ok) { setError(res); return; }
    const text = postText(res.result);
    setMissing(Array.isArray(res.result.missing_info) ? res.result.missing_info : []);
    // Never insert automatically: the employer reviews the draft and chooses to use it.
    if (text.trim().length >= 50) setDraft(text); else setError({ error: "The AI couldn't write a usable draft. Please add more detail and try again." });
  }
  if (!open) return <button className="btn btn-sm btn-outline" type="button" onClick={() => setOpen(true)}>✨ Write the description with AI</button>;
  return <div className="ai-tools">
    <label className="sub" htmlFor="aiPostNotes">Jot down the key points: tools, experience level, team, location, pay range, benefits.</label>
    <textarea className="input" id="aiPostNotes" maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 3+ yrs Azure Data Factory, Spark, SQL; hybrid in Newark NJ; $120–140k; health + 401k" />
    <div className="actions"><button className="btn btn-sm btn-primary" type="button" disabled={busy || notes.trim().length < 10} onClick={write}>{busy ? 'Writing…' : 'Write description'}</button> <button className="btn btn-sm btn-ghost" type="button" onClick={() => setOpen(false)}>Close</button></div>
    <AiError error={error} />
    {missing.length > 0 && <div className="ai-note"><strong>Consider adding:</strong><ul>{missing.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
    {draft && <div className="ai-note"><strong>AI draft</strong><p style={{ whiteSpace: 'pre-wrap' }}>{draft}</p><button className="btn btn-sm btn-primary" type="button" onClick={() => { onUse(draft); setDraft(''); }}>{current.trim() ? 'Replace description with this draft' : 'Use this draft'}</button></div>}
    <p className="ai-disclaimer">Review and edit the description before saving.</p>
  </div>;
}

const FIT = { strong: 'Strong', good: 'Good', partial: 'Partial', weak: 'Weak' };

export function AiShortlist({ call = callAi }) {
  const [job, setJob] = useState({ title: '', description: '' });
  const [cands, setCands] = useState([{ label: '', resume_text: '' }, { label: '', resume_text: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const setCand = (i, k) => (e) => setCands((cur) => cur.map((c, j) => (j === i ? { ...c, [k]: e.target.value } : c)));
  const ready = job.title.trim() && job.description.trim().length >= 50 && cands.some((c) => c.resume_text.trim());
  async function rank() {
    setBusy(true); setError(null); setResult(null);
    const candidates = cands.filter((c) => c.resume_text.trim()).map((c, i) => ({ label: c.label.trim().slice(0, 60) || `Candidate ${i + 1}`, resume_text: c.resume_text.trim().slice(0, 15000) }));
    const res = await call('candidate_shortlist', { job: { title: job.title.trim().slice(0, 160), description: job.description.trim().slice(0, 12000) }, candidates });
    setBusy(false);
    if (res.ok) setResult(res.result); else setError(res);
  }
  return <section className="card ai-tools">
    <h2>✨ AI candidate shortlist</h2>
    <p className="sub">Paste a job description and up to 10 résumés. The AI ranks them on job-related skills and experience only; candidate labels are never sent. Fortune Jobs AI doesn't store the résumés, but our AI provider may keep request data for a limited time under its terms. The ranking is a suggestion for your review, not a hiring decision.</p>
    <input className="input" aria-label="Shortlist job title" maxLength={160} placeholder="Job title" value={job.title} onChange={(e) => setJob({ ...job, title: e.target.value })} />
    <textarea className="input" aria-label="Shortlist job description" maxLength={12000} placeholder="Job description (at least 50 characters)" value={job.description} onChange={(e) => setJob({ ...job, description: e.target.value })} />
    {cands.map((c, i) => <div key={i} className="ai-candidate">
      <input className="input" aria-label={`Candidate ${i + 1} label`} maxLength={60} placeholder={`Candidate ${i + 1} (label or initials)`} value={c.label} onChange={setCand(i, 'label')} />
      <textarea className="input" aria-label={`Candidate ${i + 1} résumé`} maxLength={15000} placeholder="Paste résumé text" value={c.resume_text} onChange={setCand(i, 'resume_text')} />
    </div>)}
    <div className="actions">
      {cands.length < 10 && <button className="btn btn-sm btn-ghost" type="button" onClick={() => setCands([...cands, { label: '', resume_text: '' }])}>Add candidate</button>}
      <button className="btn btn-primary" type="button" disabled={busy || !ready} onClick={rank}>{busy ? 'Ranking…' : 'Rank candidates'}</button>
    </div>
    <div aria-live="polite"><AiError error={error} />
      {result && <ol className="ai-plan">{(result.ranking || []).map((r) => <li key={r.id}><strong>{r.label}</strong> · {FIT[r.fit] || r.fit} fit
        {r.strengths?.length > 0 && <p><em>Strengths:</em> {r.strengths.join('; ')}</p>}
        {r.concerns?.length > 0 && <p><em>Ask about:</em> {r.concerns.join('; ')}</p>}</li>)}</ol>}
      {result?.note && <p className="ai-disclaimer">{result.note}</p>}
    </div>
  </section>;
}
