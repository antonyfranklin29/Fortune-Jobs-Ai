import React, { useState } from 'react';
import { cleanDescription, fitFor } from './catalogue.js';
import { AiError, FIT_LABEL, rememberFit, useAiFit } from './AiTools.jsx';
import { callAi, jobForAi } from '../shared/ai.js';
import { NextSteps, ProfileSnapshot } from './JobInsights.jsx';

// How much of the ring an AI fit level fills. A level, not a score: the AI answer has no number.
const RING = { strong: 90, good: 70, partial: 45, weak: 20 };
// The panel shows the gist; the full sentence stays in "Why this fits me". "Strong SQL work: 'quote…'" → "Strong SQL work".
export function short(text) {
  const s = String(text || '').trim();
  const head = s.split(/:\s/)[0];
  if (head !== s && head.length >= 12 && head.length <= 140) return head;
  return s.length <= 140 ? s : s.slice(0, 137).replace(/\s\S*$/, '') + '…';
}

/** Résumé match for the open job: the skill estimate when the listing names enough skills, otherwise
 *  the AI's reading of the person's own résumé against the job (asked for, never run automatically). */
export function MatchPanel({ job, profile, call = callAi }) {
  const fit = job && fitFor(job, profile);
  const ai = useAiFit(job);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function askAi() {
    setBusy(true); setError(null);
    const res = await call('fit_explain', { job: jobForAi(job, cleanDescription) });
    setBusy(false);
    if (res.ok) rememberFit(job, res.result); else setError(res);
  }
  return <aside className="dashboard-match dashboard-card" aria-labelledby="match-title">
    <h2 id="match-title"><span aria-hidden="true">▤</span> Your Résumé Match</h2>
    {fit ? <>
      <div className="match-overview">
        <div className="match-ring" style={{ '--score': fit.score + '%' }}>
          <div><strong>{fit.score}</strong>/100<small>Match Score</small></div>
        </div>
        <div><strong className="match-label">Estimated Match</strong><p>Based on skills in the listing and the experience you provided.</p></div>
      </div>
      <h3>Top Strengths</h3>
      {fit.matched.length ? <ul className="match-strengths">{fit.matched.map(skill => <li key={skill}>{skill}</li>)}</ul> : <p>No shared skills were identified.</p>}
      <h3>Opportunities to Improve</h3>
      {fit.missing.length ? <ul className="match-gaps">{fit.missing.map(skill => <li key={skill}>{skill}</li>)}</ul> : <p>No additional skills were identified in this listing.</p>}
    </> : ai ? <>
      <div className="match-overview">
        <div className={`match-ring match-ring-${ai.fit}`} style={{ '--score': (RING[ai.fit] || 0) + '%' }}>
          <div><strong className="match-level">{(FIT_LABEL[ai.fit] || 'Fit').replace(' fit', '')}</strong><small>AI match</small></div>
        </div>
        <div><strong className="match-label">{FIT_LABEL[ai.fit] || 'AI match'}</strong><p>{ai.headline}</p></div>
      </div>
      {ai.strengths?.length > 0 && <><h3>Top Strengths</h3><ul className="match-strengths">{ai.strengths.slice(0, 4).map((x, i) => <li key={i}>{short(x)}</li>)}</ul></>}
      {ai.gaps?.length > 0 && <><h3>Opportunities to Improve</h3><ul className="match-gaps">{ai.gaps.slice(0, 4).map((x, i) => <li key={i}>{short(x)}</li>)}</ul></>}
      {ai.advice && <p className="match-advice"><strong>Next step:</strong> {ai.advice}</p>}
      <p className="match-note">AI reading of your résumé against this job. Full reasons are under “Why this fits me”.</p>
    </> : <>
      <div className="match-overview">
        <div className="match-ring" style={{ '--score': '0%' }}><div><strong>—</strong><small>Match Score</small></div></div>
        <div><strong className="match-label">{profile?.skills?.length ? 'Ask AI for your match' : 'Add your résumé'}</strong>
          <p>{profile?.skills?.length ? 'This listing doesn’t name enough skills for a quick score. AI can read the whole listing against your résumé instead.' : 'See how your experience matches a job and which skills to review.'}</p>
          {!profile?.skills?.length && <a href="./resume-search.html?manual=1">Enter skills instead</a>}
        </div>
      </div>
      {profile?.skills?.length > 0 && <>
        <button type="button" className="match-ai-button" onClick={askAi} disabled={busy}>{busy ? 'Reading the listing… about 10 seconds' : '✨ Get my AI match'}</button>
        <AiError error={error} />
        <h3>What you’ll get</h3>
        <ul className="match-preview"><li>Your fit level: strong, good, partial or weak</li><li>Strengths from your résumé that match</li><li>Gaps to address before applying</li></ul>
      </>}
    </>}
    <ProfileSnapshot profile={profile} />
    <NextSteps />
    <a className="dashboard-gold match-action" href="./resume-builder.html">✧ Improve Résumé</a>
  </aside>;
}
