// AI features for job seekers: fit explanation, résumé tailoring, interview prep (per job),
// smart plain-English search and the skill gap plan. All answers come from ai-assist.
import React, { useEffect, useRef, useState } from 'react';
import { callAi, jobForAi } from '../shared/ai.js';
import { cleanDescription } from './catalogue.js';
import '../styles/ai.css';
import { MaterialActions } from '../shared/MaterialActions.jsx';
import * as Materials from '../shared/applicationMaterials.js';

const List = ({ items, className }) => (Array.isArray(items) && items.length ? <ul className={className}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : null);
export const FIT_LABEL = { strong: 'Strong fit', good: 'Good fit', partial: 'Partial fit', weak: 'Weak fit' };

// Per job, for this visit: each AI answer (shared by the Coach buttons and the Résumé Match panel,
// so the person waits and pays once) and the Apply-ready steps the person has done.
const done = new Map(), listeners = new Set();
export const aiJobKey = (job) => `${job?.job_title}|${job?.company}|${job?.apply_url}`;
export function markStep(job, step, value = true) {
  const k = aiJobKey(job);
  done.set(k, { ...(done.get(k) || {}), [step]: value });
  listeners.forEach((f) => f());
}
export const rememberFit = (job, result) => markStep(job, 'fit_explain', result);
export function useJobProgress(job) {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return job ? done.get(aiJobKey(job)) || {} : {};
}
export function useAiFit(job) {
  const p = useJobProgress(job);
  return p.fit_explain && typeof p.fit_explain === 'object' ? p.fit_explain : null;
}

export function AiError({ error }) {
  if (!error) return null;
  const next = encodeURIComponent(window.location.pathname.replace(/^\//, '') + window.location.search);
  return <p className="ai-error" role="alert">{error.error}{' '}
    {error.status === 401 && <a href={`./login.html?next=${next}`}>Sign in</a>}
    {error.need === 'resume' && <a href="./profile.html#resume">Add your résumé</a>}
  </p>;
}

export const FitView = ({ r }) => <div className="ai-result">
  <p className={`ai-fit ai-fit-${r.fit}`}><strong>{FIT_LABEL[r.fit] || 'Fit'}</strong> · {r.headline}</p>
  {r.strengths?.length > 0 && <><h5>Why you fit</h5><List items={r.strengths} /></>}
  {r.gaps?.length > 0 && <><h5>Gaps to address</h5><List items={r.gaps} /></>}
  {r.advice && <p><strong>Next step:</strong> {r.advice}</p>}
</div>;

export function tailoredText(r) {
  const parts = [r.summary || ''];
  for (const role of r.experience || []) parts.push(`\n${role.role}\n${(role.bullets || []).map((b) => `• ${b}`).join('\n')}`);
  if (r.skills?.length) parts.push(`\nSkills: ${r.skills.join(', ')}`);
  return parts.join('\n').trim();
}

export function TailorView({ r, identity, job }) {
  return <div className="ai-result">
    <p><strong>{identity?.name || '[Add your full name]'}</strong><br />{identity?.email || '[Add your email]'}</p>
    <h5>Summary</h5><p>{r.summary}</p>
    {(r.experience || []).map((role, i) => <div key={i}><h5>{role.role}</h5><List items={role.bullets} /></div>)}
    {r.skills?.length > 0 && <p><strong>Skills, most relevant first:</strong> {r.skills.join(', ')}</p>}
    {r.keywords_added?.length > 0 && <p><strong>Job keywords now included:</strong> {r.keywords_added.join(', ')}</p>}
    {r.not_supported?.length > 0 && <div className="ai-note"><strong>Not on your résumé, so not added:</strong><List items={r.not_supported} /><span>If you do have this experience, add it to your résumé yourself.</span></div>}
    <h5>Education</h5><p style={{ whiteSpace: 'pre-line' }}>{identity?.education || '[Add your education, or remove this section]'}</p>
    <MaterialActions kind="tailor_resume" result={r} identity={identity} job={job} />
    <div className="ai-actions"><a href="./resume-builder.html">Open résumé builder →</a></div>
  </div>;
}

export function CoverLetterView({ r, identity, job }) {
  return <div className="ai-result">
    <p>{r.greeting}</p>{(r.paragraphs || []).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    <p>{r.closing}<br />{identity?.name || '[Add your full name]'}</p>
    {r.not_supported?.length > 0 && <div className="ai-note"><strong>Requirements not claimed:</strong><List items={r.not_supported} /></div>}
    <MaterialActions kind="cover_letter" result={r} identity={identity} job={job} />
  </div>;
}

export const InterviewView = ({ r }) => <div className="ai-result">
  {(r.questions || []).map((q, i) => <details key={i} className="ai-question"><summary><span className="ai-tag">{q.type}</span> {q.question}</summary><p><strong>Why they ask:</strong> {q.why_asked}</p><p><strong>How to answer:</strong> {q.answer_outline}</p></details>)}
  {r.questions_to_ask?.length > 0 && <><h5>Questions to ask them</h5><List items={r.questions_to_ask} /></>}
</div>;

export const SkillGapView = ({ r }) => <div className="ai-result">
  <p className="ai-fit"><strong>Ready now: {r.ready_now}</strong></p>
  {r.have?.length > 0 && <p><strong>You already have:</strong> {r.have.join(', ')}</p>}
  {r.gaps?.length > 0 && <><h5>Skills to learn</h5><ol className="ai-plan">{r.gaps.map((g, i) => <li key={i}><strong>{g.skill}</strong>{g.weeks ? ` · about ${g.weeks} week${g.weeks === 1 ? '' : 's'}` : ''}<p>{g.why}</p><p><em>How:</em> {g.how_to_learn}</p></li>)}</ol></>}
  {r.related_roles?.length > 0 && <p><strong>Roles you could apply for now:</strong> {r.related_roles.join(', ')}</p>}
</div>;

const JOB_TOOLS = [
  ['fit_explain', '✨ Why this fits me', FitView],
  ['tailor_resume', '✨ Tailor my résumé', TailorView],
  ['cover_letter', '✉️ Write a cover letter', CoverLetterView],
  ['interview_prep', '✨ Interview prep', InterviewView],
];

/** The AI buttons under a job. One answer per tool is kept while the job stays open. */
export function AiJobTools({ job, call = callAi, materialServices = Materials }) {
  const [state, setState] = useState({ key: null, active: null, busy: false, error: null, results: {} });
  const [context, setContext] = useState(null);
  const [materials, setMaterials] = useState({});
  const [saveNote, setSaveNote] = useState('');
  const generation = useRef(0);
  const key = aiJobKey(job);
  useEffect(() => {
    let active = true, stop, loadVersion = 0;
    generation.current++;
    const load = async () => {
      const version = ++loadVersion;
      try {
        const next = await materialServices.loadMaterialContext(job);
        if (active && version === loadVersion) { setContext(next); setMaterials(next.materials || {}); }
      } catch { /* Retry with a fresh profile when the person generates a document. */ }
    };
    setContext(null); setMaterials({}); setSaveNote(''); load();
    materialServices.watchMaterialAccount(() => {
      generation.current++; done.clear(); listeners.forEach(f => f());
      if (active) { setState({ key: null, active: null, busy: false, error: null, results: {} }); setContext(null); setMaterials({}); load(); }
    }).then(unsubscribe => { if (active) stop = unsubscribe; else unsubscribe(); }).catch(() => {});
    return () => { active = false; stop?.(); };
  }, [key, materialServices]);
  const progress = useJobProgress(job);
  const base = state.key === key ? state : { key, active: null, busy: false, error: null, results: {} };
  const shared = Object.fromEntries(JOB_TOOLS.map(([t]) => [t, progress[t]]).filter(([, v]) => v && typeof v === 'object'));
  const stored = Object.fromEntries(Object.entries(materials).filter(([, m]) => m?.result).map(([task, m]) => [task, m.result]));
  const s = { ...base, results: { ...stored, ...shared, ...base.results } };
  async function run(task, regenerate = false) {
    if (!regenerate && s.results[task]) { setState({ ...s, active: task, error: null }); return; }
    setState({ ...s, active: task, busy: true, error: null });
    const currentGeneration = generation.current;
    const isDocument = ['tailor_resume', 'cover_letter'].includes(task);
    let nextContext = context;
    try {
      if (isDocument) {
        nextContext = await materialServices.loadMaterialContext(job);
        if (currentGeneration !== generation.current) return;
        setContext(nextContext);
        const existing = nextContext?.materials?.[task];
        if (!regenerate && existing?.result) {
          setMaterials(previous => ({ ...previous, [task]: existing }));
          setState({ ...s, active: task, busy: false, error: null, results: { ...s.results, [task]: existing.result } });
          return;
        }
      }
      const payload = { job: jobForAi(job, cleanDescription) };
      // Bind a document to the session whose identity was read, even if another
      // account signs in between the profile read and the AI request.
      const res = isDocument ? await call(task, payload, { session: nextContext?.session || null }) : await call(task, payload);
      if (currentGeneration !== generation.current) return;
      if (res.ok) {
        markStep(job, task, isDocument ? true : res.result);
        if (isDocument) {
          const material = { result: res.result, identity: nextContext?.identity || {}, generated_at: new Date().toISOString() };
          setMaterials(previous => ({ ...previous, [task]: material }));
          if (nextContext?.userId) {
            try {
              const note = await materialServices.keepMaterial(job, task, material, nextContext.userId);
              if (currentGeneration === generation.current) setSaveNote(note);
            } catch (error) { if (currentGeneration === generation.current) setSaveNote(error.message); }
          }
        }
      }
      if (currentGeneration !== generation.current) return;
      setState(res.ok
        ? { ...s, active: task, busy: false, error: null, results: { ...s.results, [task]: res.result } }
        : { ...s, active: task, busy: false, error: res });
    } catch (error) {
      if (currentGeneration === generation.current) setState({ ...s, active: task, busy: false, error: { error: error.message || 'Could not prepare this draft. Try again.' } });
    }
  }
  // Buttons elsewhere on the page ("Tailor my résumé with these", "Practice interview questions")
  // ask this panel to run a tool, so every answer appears in one place.
  const runRef = useRef(run); runRef.current = run;
  useEffect(() => {
    const onRun = (e) => { if (JOB_TOOLS.some(([t]) => t === e.detail)) runRef.current(e.detail); };
    window.addEventListener('fj-ai-run', onRun);
    return () => window.removeEventListener('fj-ai-run', onRun);
  }, []);
  const Active = JOB_TOOLS.find(([t]) => t === s.active)?.[2];
  return <section className="ai-tools" aria-label="Fortune AI Coach for this job">
    <h4>Fortune AI Coach</h4>
    <p className="ai-disclaimer">Drafts for saved jobs are kept privately in your application tracker.</p>
    <div className="ai-buttons" role="group">{JOB_TOOLS.map(([task, label]) => <button key={task} type="button" aria-pressed={s.active === task} disabled={s.busy} onClick={() => run(task)}>{label}</button>)}</div>
    <div aria-live="polite">
      {s.busy && <p className="ai-busy">Thinking… this takes about 10 seconds.</p>}
      <AiError error={s.error} />
      <div className="ai-actions">{materials[s.active] && <button type="button" disabled={s.busy} onClick={() => run(s.active, true)}>Generate new draft</button>}
      {materials[s.active] && context?.userId && <button className="ai-save-material" type="button" disabled={s.busy} onClick={async () => {
        try { setSaveNote(await materialServices.keepMaterial(job, s.active, materials[s.active], context.userId)); }
        catch (error) { setSaveNote(error.message); }
      }}>Save draft to tracker</button>}</div>
      {saveNote && <p className="ai-disclaimer" role="status">{saveNote}</p>}
      {!s.busy && Active && s.results[s.active] && <Active r={s.results[s.active]} identity={materials[s.active]?.identity || context?.identity} job={job} />}
    </div>
  </section>;
}

/** Plain-English search: turns a sentence into the normal search filters, then searches. */
export function SmartSearch({ call = callAi, go = (url) => { window.location.href = url; } }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // A div, not a form: it sits inside the main search form, and forms cannot nest.
  async function submit(event) {
    event?.preventDefault();
    const query = text.trim();
    if (query.length < 3 || busy) return;
    setBusy(true); setError(null);
    const res = await call('smart_search', { query });
    setBusy(false);
    if (!res.ok) { setError(res); return; }
    go(`./results.html?${smartSearchParams(res.result)}`);
  }
  return <div className="ai-smart-search" role="search">
    <label htmlFor="aiSmartSearch">✨ Or describe the job you want <span className="ai-smart-badge">AI search</span></label>
    <p className="ai-smart-hint">Type it the way you’d say it. AI turns it into the right filters.</p>
    <div><input id="aiSmartSearch" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(e); }} placeholder="e.g. remote Power BI jobs in New Jersey posted this week" />
      <button type="button" onClick={submit} disabled={busy || text.trim().length < 3}>{busy ? 'Searching…' : 'Ask AI'}</button></div>
    <AiError error={error} />
  </div>;
}

const ALLOWED = { country: ['us', 'ca', 'gb', 'in'], work_mode: ['On-site', 'Remote', 'Hybrid'], job_type: ['Full-time', 'Part-time', 'Contract'], experience: ['Entry level', 'Associate', 'Mid-Senior level'], date_posted: ['1', '3', '7', '30'], salary: ['listed'] };
export function smartSearchParams(r = {}) {
  const params = new URLSearchParams({ mode: 'quick', q: String(r.q || '').slice(0, 120).trim() });
  const location = String(r.location || '').slice(0, 120).trim();
  if (location) params.set('location', location);
  for (const [k, allowed] of Object.entries(ALLOWED)) if (allowed.includes(r[k])) params.set(k, r[k]);
  const min = Math.round(Number(r.salary_min));
  if (min >= 1000 && min <= 2000000) params.set('salary_min', String(min));
  return params;
}

/** Skill gap plan for a target role, from the profile résumé. */
export function SkillGap({ call = callAi, initialRole = '' }) {
  const [role, setRole] = useState(initialRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  async function submit(event) {
    event.preventDefault();
    if (!role.trim() || busy) return;
    setBusy(true); setError(null); setResult(null);
    const res = await call('skill_gap', { target_role: role.trim().slice(0, 160) });
    setBusy(false);
    if (res.ok) setResult(res.result); else setError(res);
  }
  return <section className="ai-tools ai-skill-gap" aria-label="Skill gap plan">
    <h3>✨ Skill gap plan</h3>
    <p>Name the role you want next. The AI compares it with your saved résumé and suggests what to learn.</p>
    <form onSubmit={submit}><input aria-label="Target role" maxLength={160} value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Data Engineer" /><button type="submit" disabled={busy || !role.trim()}>{busy ? 'Thinking…' : 'Build my plan'}</button></form>
    <div aria-live="polite"><AiError error={error} />{result && <SkillGapView r={result} />}</div>
  </section>;
}
