import React, { useEffect, useState } from 'react';
import logo from '../../../newsletter-logo.png';
import { supabase } from './supabase.js';

export function Header() {
  const [account, setAccount] = useState(null);
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => { if (active) setAccount(data.user || null); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { if (active) setAccount(session?.user || null); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);
  return <nav aria-label="Main navigation">
    <a href="./index.html" className="logo"><img className="brand-mark" src={logo} width="38" height="38" alt="" /><span className="logo-text">Fortune Jobs AI</span></a>
    <ul className="nav-links">
      <li><a href="./find-jobs.html" className="find-jobs-link"><span aria-hidden="true">⌕</span> Find Jobs</a></li>
      <li><a href="./resume-builder.html"><span aria-hidden="true">✧</span> Résumé Studio</a></li>
      <li><a href="./profile.html#saved"><span aria-hidden="true">♧</span> Saved Jobs</a></li>
      <li><a href="./employers.html"><span aria-hidden="true">▣</span> Employers</a></li>
    </ul>
    <div className="nav-account"><a className="dashboard-user" href={account ? './profile.html' : './login.html'} aria-label={account ? 'My profile' : 'Job seeker sign in'}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/></svg></a></div>
  </nav>;
}

export function MobileTabs() {
  return <nav className="mobile-tabs" aria-label="Mobile navigation"><a href="./find-jobs.html"><span aria-hidden="true">⌕</span>Search</a><a href="./profile.html#saved"><span aria-hidden="true">♧</span>Saved</a><a href="./resume-builder.html"><span aria-hidden="true">▤</span>Résumé</a><a href="./profile.html"><span aria-hidden="true">◯</span>Profile</a></nav>;
}

export function Footer() {
  return <footer><div className="footer-grid"><div><a href="./index.html" className="logo"><img className="brand-mark" src={logo} width="34" height="34" alt=""/><span className="logo-text">Fortune Jobs AI</span></a><p>Your AI-powered job search assistant. Discover opportunities for your next career move.</p></div><div><h4>PRODUCT</h4><ul><li><a href="./find-jobs.html">Find Jobs</a></li><li><a href="./resume-search.html">Upload Resume</a></li><li><a href="./resume-builder.html">Build a résumé</a></li></ul></div><div><h4>COMPANY</h4><ul><li><a href="./about.html">About Us</a></li><li><a href="./contact.html">Contact & Feedback</a></li><li><a href="mailto:info@fortunejobsai.com">info@fortunejobsai.com</a></li><li><a href="./privacy.html">Privacy Policy</a></li><li><a href="./terms.html">Terms of Use</a></li></ul></div><div><h4>JOB CATEGORIES</h4><ul>{['Data Analyst','Software Engineer','Product Manager','Marketing'].map(role=><li key={role}><a href={`./results.html?mode=quick&q=${encodeURIComponent(role)}`}>{role}</a></li>)}</ul></div></div><div className="footer-bottom">© 2026 Fortune Jobs AI. All rights reserved. <span>Built for your future</span></div></footer>;
}
