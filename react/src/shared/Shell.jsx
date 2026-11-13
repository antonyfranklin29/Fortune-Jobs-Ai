import React, { useEffect, useState } from 'react';
import logo from '../../../newsletter-logo.png';
import { supabase } from './supabase.js';

export function Header() {
  const [account, setAccount] = useState(null);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setAccount(data.session?.user || null); });
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

// Simple line icons for the phone tab bar (24px, drawn with the text colour).
const TAB_ICONS = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  saved: <path d="M7 3.8h10a1.2 1.2 0 0 1 1.2 1.2v15.2L12 16.4l-6.2 3.8V5A1.2 1.2 0 0 1 7 3.8z" />,
  resume: <><path d="M7 3.5h7l4.5 4.5v12.5H7z" /><path d="M14 3.5V8h4.5M9.5 12.5h6M9.5 16h6" /></>,
  profile: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.8 20.3c1.2-3.6 4-5.3 7.2-5.3s6 1.7 7.2 5.3" /></>,
};
const TabIcon = ({ name }) => <svg className="tab-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{TAB_ICONS[name]}</svg>;

export function MobileTabs() {
  return <nav className="mobile-tabs" aria-label="Mobile navigation"><a href="./find-jobs.html"><TabIcon name="search" />Search</a><a href="./profile.html#saved"><TabIcon name="saved" />Saved</a><a href="./resume-builder.html"><TabIcon name="resume" />Résumé</a><a href="./profile.html"><TabIcon name="profile" />Profile</a></nav>;
}

export function Footer() {
  return <footer><div className="footer-grid"><div><a href="./index.html" className="logo"><img className="brand-mark" src={logo} width="34" height="34" alt=""/><span className="logo-text">Fortune Jobs AI</span></a><p>Your AI-powered job search assistant. Discover opportunities for your next career move.</p></div><div><h4>PRODUCT</h4><ul><li><a href="./find-jobs.html">Find Jobs</a></li><li><a href="./resume-search.html">Upload Resume</a></li><li><a href="./resume-builder.html">Build a résumé</a></li></ul></div><div><h4>COMPANY</h4><ul><li><a href="./about.html">About Us</a></li><li><a href="./contact.html">Contact & Feedback</a></li><li><a href="mailto:info@fortunejobsai.com">info@fortunejobsai.com</a></li><li><a href="./privacy.html">Privacy Policy</a></li><li><a href="./terms.html">Terms of Use</a></li></ul></div><div><h4>JOB CATEGORIES</h4><ul>{['Data Analyst','Software Engineer','Product Manager','Marketing'].map(role=><li key={role}><a href={`./results.html?mode=quick&q=${encodeURIComponent(role)}`}>{role}</a></li>)}</ul></div></div><div className="footer-bottom">© 2026 YOU DO LMS INC. All rights reserved. Fortune Jobs AI is operated by YOU DO LMS INC. <span>Built for your future</span></div></footer>;
}
