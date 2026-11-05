import React, { useEffect, useState } from 'react';
import { Footer, Header, MobileTabs } from '../shared/Shell.jsx';
import { SearchForm } from './SearchForm.jsx';
import { JobDetail, JobList } from './JobViews.jsx';
import { guestMatchProfile, recentJobs } from './catalogue.js';
import { supabase } from '../shared/supabase.js';

const categories = [['📊','Data Analyst'],['💻','Software Engineer'],['🎯','Product Manager'],['📣','Marketing Manager'],['🎨','UX Designer'],['💰','Financial Analyst']];

function HomeSections() {
  return <>
    <section className="how-it-works"><div className="section-eyebrow">How It Works</div><h2 className="section-title">Find a job in three steps</h2><p className="section-sub">Start with a role, then add your experience if you want a fit estimate.</p><div className="steps-grid"><div className="step-card"><div className="step-num">1</div><h3>Search your way</h3><p>Browse recent jobs with Quick Match. A résumé is optional.</p></div><div className="step-card"><div className="step-num">2</div><h3>Understand the fit</h3><p>Add a résumé or your skills to see a transparent estimate out of 100.</p></div><div className="step-card"><div className="step-num">3</div><h3>Apply at the source</h3><p>Read the details and follow the link to the original listing.</p></div></div></section>
    <section className="categories"><div className="section-eyebrow">Explore by role</div><h2 className="section-title">Find jobs in your field</h2><p className="section-sub">Open current listings for a role that interests you.</p><div className="categories-grid">{categories.map(([icon,role])=><a className="category-card" key={role} href={`./results.html?mode=quick&q=${encodeURIComponent(role)}`}><span className="category-icon">{icon}</span><span><span className="category-name">{role}</span><span className="category-count">Explore current listings</span></span></a>)}</div></section>
    <section className="why-us"><div className="section-eyebrow">Why Fortune Jobs AI</div><h2 className="section-title">A clearer way to search</h2><p className="section-sub">See real listings, useful details and the reason a job fits your search.</p><div className="why-grid"><div className="why-card"><div className="why-icon">⚡</div><h3>Quick Match</h3><p>Find recent saved listings without waiting for a new search.</p></div><div className="why-card"><div className="why-icon">✦</div><h3>Résumé tools</h3><p>Build a résumé and compare your stated skills to job requirements.</p></div><div className="why-card"><div className="why-icon">🔖</div><h3>Save what matters</h3><p>Keep a shortlist in your free profile and return when you are ready.</p></div></div></section>
    <section className="cta-section"><h2>Ready to find your <span>next role?</span></h2><p>Explore jobs for free. You can search before creating an account.</p><a className="react-home-cta" href="./find-jobs.html">Find jobs →</a></section>
  </>;
}

export function LandingPage() {
  const searchParams = new URLSearchParams(window.location.search);
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(guestMatchProfile);
  useEffect(() => {
    const controller = new AbortController();
    recentJobs(controller.signal).then(setJobs).catch(() => { if (!controller.signal.aborted) setError('Recent job previews are unavailable. You can still search the catalogue.'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (profile || searchParams.get('resume') === '0' || searchParams.get('resume') === '1') return;
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!active || !data.user) return;
      const personal = await supabase.from('profiles').select('current_title,years_experience,skills,preferred_locations').eq('id', data.user.id).maybeSingle();
      if (active && !personal.error && personal.data) setProfile(personal.data);
    });
    return () => { active = false; };
  }, []);
  return <><Header />
    <section className="hero"><div className="landing-shell">
      <div className="landing-intro"><div className="intro-main"><div className="hero-badge">✦ SEARCH · RÉSUMÉ · HIRING</div><h1>Find your role.<br/><span>Shape your future.</span></h1><p className="hero-sub-text">Search real jobs, understand why they fit, and build a stronger résumé in one place.</p></div><div className="start-choices" aria-label="Choose how to start"><span>Make it yours, or just browse</span><a href="./resume-search.html">Upload résumé</a><a href="./resume-search.html?manual=1">Enter experience</a><a href="#jobSearchInput">Search directly</a></div></div>
      <div className="landing-grid"><div className="search-column"><section className="search-panel"><div className="panel-kicker">FIND JOBS</div><h2>Start with a role and location</h2>{searchParams.get('resume')==='1' && <div className="react-resume-summary">{profile ? <>Using your confirmed details: {profile.current_title} · {profile.skills.length} skills. <a href="./resume-search.html?edit=1">Edit details</a></> : <>Your temporary details expired. <a href="./resume-search.html?manual=1">Add them again</a> or search directly.</>}</div>}<SearchForm initial={{...Object.fromEntries(searchParams),q:searchParams.get('q') || (profile && searchParams.get('resume')==='1' ? profile.current_title : ''),location:searchParams.get('location') || (profile && searchParams.get('resume')==='1' ? [profile.city,profile.region].filter(Boolean).join(', ') : ''),country:searchParams.get('country') || (profile && searchParams.get('resume')==='1' ? profile.country : '')}} /></section></div>
        <section className="featured-jobs" aria-labelledby="featured-title"><div className="panel-kicker">EXPLORE OPENINGS</div><div className="featured-head"><div><h2 id="featured-title">Jobs that fit your next move</h2><p>{jobs.length ? `${jobs.length} recent job listings · Select one to preview its details` : error || 'Loading real listings from our saved catalogue…'}</p></div><a href="./results.html?mode=quick">Search all jobs →</a></div><div className="featured-browser">{jobs.length ? <><JobList jobs={jobs} selected={selected} onSelect={setSelected} profile={profile} /><JobDetail job={jobs[selected]} profile={profile} /></> : <div className="featured-status">{error || 'Loading recent jobs…'}</div>}</div></section>
        <aside className="toolkit-panel" aria-labelledby="toolkit-title"><div className="panel-kicker">YOUR RÉSUMÉ TOOLKIT</div><h2 id="toolkit-title">More than a job search</h2><p>Use your own experience to improve your résumé and understand your fit for a role.</p><div className="react-tool-links"><a href="./resume-search.html"><span className="tool-icon">⇧</span><span><strong>Upload your résumé</strong><small>Find matching jobs and see fit estimates when available.</small></span><span aria-hidden="true">→</span></a><a href="./resume-search.html?manual=1"><span className="tool-icon">✎</span><span><strong>Enter experience and skills</strong><small>Get job fit scores without uploading a file.</small></span><span aria-hidden="true">→</span></a><a href="./resume-builder.html"><span className="tool-icon">✦</span><span><strong>Build a résumé</strong><small>Draft and format it from facts you review.</small></span><span aria-hidden="true">→</span></a><a href="./profile.html#saved"><span className="tool-icon">♧</span><span><strong>Saved jobs & profile</strong><small>Keep opportunities and update your details.</small></span><span aria-hidden="true">→</span></a></div><p className="toolkit-note">Search jobs without a résumé. No account needed to search or try experience matching.</p></aside>
      </div></div></section>
    <section className="employer-banner" aria-label="Employer tools"><div><span className="panel-kicker">FOR EMPLOYERS</span><h2>Build your next great team.</h2><p>Create an employer workspace, prepare job posts, and connect an approved career feed.</p></div><a href="./employers.html">Explore employer tools →</a></section>
    {document.body.dataset.page === 'home' && <HomeSections />}
    <MobileTabs /><Footer />
  </>;
}
