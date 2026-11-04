import React, { useEffect, useState } from 'react';
import { Footer, Header, MobileTabs } from '../shared/Shell.jsx';
import { SearchForm } from './SearchForm.jsx';
import { JobDetail, JobList } from './JobViews.jsx';
import { guestMatchProfile, recentJobs } from './catalogue.js';

export function LandingPage() {
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const [profile] = useState(guestMatchProfile);
  useEffect(() => {
    const controller = new AbortController();
    recentJobs(controller.signal).then(setJobs).catch(() => { if (!controller.signal.aborted) setError('Recent job previews are unavailable. You can still search the catalogue.'); });
    return () => controller.abort();
  }, []);
  return <><Header />
    <section className="hero"><div className="landing-shell">
      <div className="landing-intro"><div className="intro-main"><div className="hero-badge">✦ SEARCH · RÉSUMÉ · HIRING</div><h1>Find your role.<br/><span>Shape your future.</span></h1><p className="hero-sub-text">Search real jobs, understand why they fit, and build a stronger résumé in one place.</p></div><div className="start-choices" aria-label="Choose how to start"><span>Make it yours, or just browse</span><a href="../resume-search.html">Upload résumé</a><a href="../resume-search.html?manual=1">Enter experience</a><a href="#jobSearchInput">Search directly</a></div></div>
      <div className="landing-grid"><div className="search-column"><section className="search-panel"><div className="panel-kicker">FIND JOBS</div><h2>Start with a role and location</h2><SearchForm /></section></div>
        <section className="featured-jobs" aria-labelledby="featured-title"><div className="panel-kicker">EXPLORE OPENINGS</div><div className="featured-head"><div><h2 id="featured-title">Jobs that fit your next move</h2><p>{jobs.length ? `${jobs.length} recent job listings · Select one to preview its details` : error || 'Loading real listings from our saved catalogue…'}</p></div><a href="./results.html?mode=quick">Search all jobs →</a></div><div className="featured-browser">{jobs.length ? <><JobList jobs={jobs} selected={selected} onSelect={setSelected} profile={profile} /><JobDetail job={jobs[selected]} profile={profile} /></> : <div className="featured-status">{error || 'Loading recent jobs…'}</div>}</div></section>
        <aside className="toolkit-panel" aria-labelledby="toolkit-title"><div className="panel-kicker">YOUR RÉSUMÉ TOOLKIT</div><h2 id="toolkit-title">More than a job search</h2><p>Use your own experience to improve your résumé and understand your fit for a role.</p><div className="react-tool-links"><a href="../resume-search.html"><span className="tool-icon">⇧</span><span><strong>Upload your résumé</strong><small>Find matching jobs and see fit estimates when available.</small></span><span aria-hidden="true">→</span></a><a href="../resume-search.html?manual=1"><span className="tool-icon">✎</span><span><strong>Enter experience and skills</strong><small>Get job fit scores without uploading a file.</small></span><span aria-hidden="true">→</span></a><a href="../resume-builder.html"><span className="tool-icon">✦</span><span><strong>Build a résumé</strong><small>Draft and format it from facts you review.</small></span><span aria-hidden="true">→</span></a><a href="../profile.html#saved"><span className="tool-icon">♧</span><span><strong>Saved jobs & profile</strong><small>Keep opportunities and update your details.</small></span><span aria-hidden="true">→</span></a></div><p className="toolkit-note">Search jobs without a résumé. No account needed to search or try experience matching.</p></aside>
      </div></div></section>
    <section className="employer-banner" aria-label="Employer tools"><div><span className="panel-kicker">FOR EMPLOYERS</span><h2>Build your next great team.</h2><p>Create an employer workspace, prepare job posts, and connect an approved career feed.</p></div><a href="../employers.html">Explore employer tools →</a></section>
    <MobileTabs /><Footer />
  </>;
}
