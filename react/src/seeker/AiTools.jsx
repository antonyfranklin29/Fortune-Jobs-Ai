// AI features for job seekers: fit explanation, résumé tailoring, interview prep (per job),
// smart plain-English search and the skill gap plan. All answers come from ai-assist.
import React, { useEffect, useState } from 'react';
import { callAi, jobForAi } from '../shared/ai.js';
import { cleanDescription } from './catalogue.js';
import '../styles/ai.css';

const List = ({ items, className }) => (Array.isArray(items) && items.length ? <ul className={className}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : null);
export const FIT_LABEL = { strong: 'Strong fit', good: 'Good fit', partial: 'Partial fit', weak: 'Weak fit' };

// One "Why this fits me" answer per job, shared by the AI buttons and the Résumé Match panel,
// so the person pays for (and waits for) the answer once, wherever they ask for it.
const fits = new Map(), listeners = new Set();
export const aiJobKey = (job) => `${job?.job_title}|${job?.company}|${job?.apply_url}`;
export function rememberFit(job, result) { fits.set(aiJobKey(job), result); listeners.forEach((f) => f()); }
export function useAiFit(job) {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return job ? fits.get(aiJobKey(job)) || null : null;
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

export function TailorView({ r }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(tailoredText(r)); setCopied(true); } catch { setCopied(false); } };
  return <div className="ai-result">
    <h5>Summary</h5><p>{r.summary}</p>
    {(r.experience || []).map((role, i) => <div key={i}><h5>{role.role}</h5><List items={role.bullets} /></div>)}
    {r.skills?.length > 0 && <p><strong>Skills, most relevant first:</strong> {r.skills.join(', ')}</p>}
    {r.keywords_added?.length > 0 && <p><strong>Job keywords now included:</strong> {r.keywords_added.join(', ')}</p>}
    {r.not_supported?.length > 0 && <div className="ai-note"><strong>Not on your résumé, so not added:</strong><List items={r.not_supported} /><span>If you do have this experience, add it to your résumé yourself.</span></div>}
    <div className="ai-actions"><button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy tailored résumé text'}</button><a href="./resume-builder.html">Open résumé builder →</a></div>
    <p className="ai-disclaimer">Review every line before you use it. AI can make mistakes.</p>
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
  ['interview_prep', '✨ Interview prep', InterviewView],
];

/** The AI buttons under a job. One answer per tool is kept while the job stays open. */
export function AiJobTools({ job, call = callAi }) {
  const [state, setState] = useState({ key: null, active: null, busy: false, error: null, results: {} });
  const key = aiJobKey(job);
  const shared = useAiFit(job);
  const base = state.key === key ? state : { key, active: null, busy: false, error: null, results: {} };
  const s = shared && !base.results.fit_explain ? { ...base, results: { ...base.results, fit_explain: shared } } : base;
  async function run(task) {
    if (s.results[task]) { setState({ ...s, active: task, error: null }); return; }
    setState({ ...s, active: task, busy: true, error: null });
    const res = await call(task, { job: jobForAi(job, cleanDescription) });
    if (res.ok && task === 'fit_explain') rememberFit(job, res.result);
    // Stored under this job's key: if another job is open by now, it is simply not shown.
    setState(res.ok
      ? { ...s, active: task, busy: false, error: null, results: { ...s.results, [task]: res.result } }
      : { ...s, active: task, busy: false, error: res });
  }
  const Active = JOB_TOOLS.find(([t]) => t === s.active)?.[2];
  return <section className="ai-tools" aria-label="AI tools for this job">
    <h4>AI assistant</h4>
    <div className="ai-buttons" role="group">{JOB_TOOLS.map(([task, label]) => <button key={task} type="button" aria-pressed={s.active === task} disabled={s.busy} onClick={() => run(task)}>{label}</button>)}</div>
    <div aria-live="polite">
      {s.busy && <p className="ai-busy">Thinking… this takes about 10 seconds.</p>}
      <AiError error={s.error} />
      {!s.busy && Active && s.results[s.active] && <Active r={s.results[s.active]} />}
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
    <label htmlFor="aiSmartSearch">✨ Or describe the job you want</label>
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
