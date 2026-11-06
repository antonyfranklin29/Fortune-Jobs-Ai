import React from 'react';
import { fitFor } from './catalogue.js';

export function MatchPanel({ job, profile }) {
  const fit = job && fitFor(job, profile);
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
    </> : <div className="match-overview">
      <div className="match-ring" style={{ '--score': '0%' }}><div><strong>—</strong><small>Match Score</small></div></div>
      <div><strong className="match-label">{profile?.skills?.length ? 'Score unavailable' : 'Add your résumé'}</strong>
        <p>{profile?.skills?.length ? 'This listing has too little skill detail to estimate a match.' : 'See how your experience matches a job and which skills to review.'}</p>
        {!profile?.skills?.length && <a href="./resume-search.html?manual=1">Enter skills instead</a>}
      </div>
    </div>}
    <a className="dashboard-gold match-action" href="./resume-builder.html">✧ Improve Résumé</a>
  </aside>;
}
