import React, { useEffect, useState } from 'react';
import { Footer, Header, MobileTabs } from '../shared/Shell.jsx';
import { SearchForm } from './SearchForm.jsx';
import { JobDetail, JobList } from './JobViews.jsx';
import { guestMatchProfile, quickMatches } from './catalogue.js';
import { jobKey, supabase } from '../shared/supabase.js';

const params = new URLSearchParams(window.location.search);
const initial = Object.fromEntries(params);

export function ResultsPage() {
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(initial.mode !== 'live');
  const [error, setError] = useState(initial.mode === 'live' ? 'Live Search is temporarily unavailable. Quick Match is available.' : '');
  const [profile, setProfile] = useState(guestMatchProfile);
  const [account, setAccount] = useState(null);
  const [savedKeys, setSavedKeys] = useState(new Set());
  const [saveMessage, setSaveMessage] = useState('');
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!active || !data.user) return;
      setAccount(data.user);
      if (!profile && initial.resume !== '0' && initial.resume !== '1') {
        const personal = await supabase.from('profiles').select('current_title,years_experience,skills,preferred_locations').eq('id', data.user.id).maybeSingle();
        if (active && !personal.error && personal.data) setProfile(personal.data);
      }
      const saved = await supabase.from('saved_jobs').select('job_key');
      if (active && !saved.error) setSavedKeys(new Set((saved.data || []).map(row => row.job_key)));
    });
    return () => { active = false; };
  }, []);
  async function toggleSave(job) {
    if (!account) { window.location.href = './login.html?mode=signup&next=results.html'; return; }
    const key = jobKey(job), exists = savedKeys.has(key);
    const operation = exists ? supabase.from('saved_jobs').delete().eq('job_key', key) :
      supabase.from('saved_jobs').insert({ job_key: key, job_title: job.job_title, company: job.company,
        location: job.location, salary: job.salary, apply_url: job.apply_url, match_reason: job.search_reason });
    const { error: saveError } = await operation;
    if (saveError) { setSaveMessage('Could not update saved jobs. Please try again.'); return; }
    setSavedKeys(previous => { const next = new Set(previous); exists ? next.delete(key) : next.add(key); return next; });
    setSaveMessage(exists ? 'Removed from saved jobs.' : 'Job saved to your profile.');
  }
  useEffect(() => {
    if (initial.mode === 'live') return;
    const controller = new AbortController();
    const filters = {
      country: initial.country || '', location: initial.location || '', date_posted: initial.date_posted || '',
      experience: initial.experience || '', job_type: initial.job_type || '', work_mode: initial.work_mode || '', company: initial.company || ''
    };
    quickMatches(initial.q || '', filters, controller.signal)
      .then(rows => { if (!controller.signal.aborted) { setJobs(rows); setLoading(false); } })
      .catch(() => { if (!controller.signal.aborted) { setError('We could not load jobs right now. Please try your search again.'); setLoading(false); } });
    return () => controller.abort();
  }, []);
  return <><Header />
    <section className="hero react-results-search"><div className="landing-shell"><div className="search-panel"><h2>Find your next role</h2><SearchForm initial={initial} compact /></div></div></section>
    <main className="results-section active react-results"><a className="results-back" href="./find-jobs.html">← Search again</a><div className="results-tabs"><strong>Recommended jobs</strong><a href="./profile.html#saved">Saved jobs</a><a href="./resume-builder.html">Résumé studio</a></div>
      <div className="results-heading"><h1>{initial.q ? `Jobs for “${initial.q}”` : 'Recent jobs'}</h1><p><span className="quick-badge">Quick Match</span> {loading ? 'Searching saved jobs…' : `${jobs.length} jobs from recent listings`}</p></div>
      {!profile?.skills?.length && <div className="fit-invite"><p><strong>See how well each job fits you.</strong> Add a résumé or a few skills you have, and each detailed listing shows an estimate with the reasons behind it.</p><div className="fit-invite-links"><a href="./resume-search.html">Upload a résumé</a><a href="./resume-search.html?manual=1">Enter skills instead</a></div></div>}
      {error && <div className="react-results-status" role="alert">{error}</div>}
      {loading && <div className="react-results-status" role="status">Getting jobs for you…</div>}
      {!loading && !error && !jobs.length && <div className="react-results-status">No recent saved listings match your search and filters. Try a broader role or location.</div>}
      {saveMessage && <p className="react-save-message" role="status">{saveMessage}</p>}
      {!!jobs.length && <div className="react-results-grid"><JobList jobs={jobs} selected={selected} onSelect={setSelected} profile={profile} /><JobDetail job={jobs[selected]} profile={profile} saved={savedKeys.has(jobKey(jobs[selected]))} onSave={toggleSave} /></div>}
      <div className="react-results-note">Free searches show up to 10 matching jobs. Pro subscriptions are coming later.</div>
    </main><MobileTabs /><Footer />
  </>;
}
