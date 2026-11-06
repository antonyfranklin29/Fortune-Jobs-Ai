import React, { useEffect, useState } from 'react';
import { Footer, Header, MobileTabs } from '../shared/Shell.jsx';
import { SearchForm } from './SearchForm.jsx';
import { JobDetail, JobList } from './JobViews.jsx';
import { guestMatchProfile, quickMatches, recentJobs } from './catalogue.js';
import { jobKey, supabase } from '../shared/supabase.js';

import { MatchPanel } from './MatchPanel.jsx';
import '../styles/dashboard.css';

const params = new URLSearchParams(window.location.search);
const initial = Object.fromEntries(params);

export function ResultsPage() {
  const [jobs, setJobs] = useState([]);
  const [sort, setSort] = useState('relevance');
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
    if (!account) { window.location.href = '../login.html?mode=signup&next=results.html'; return; }
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
      experience: initial.experience || '', job_type: initial.job_type || '', work_mode: initial.work_mode || '', company: initial.company || '', salary: initial.salary || '', industry: initial.industry || ''
    };
    const request = initial.q || initial.mode === 'quick' || Object.values(filters).some(Boolean) ? quickMatches(initial.q || '', filters, controller.signal) : recentJobs(controller.signal);
    request
      .then(rows => { if (!controller.signal.aborted) { setJobs(rows); setLoading(false); } })
      .catch(() => { if (!controller.signal.aborted) { setError('We could not load jobs right now. Please try your search again.'); setLoading(false); } });
    return () => controller.abort();
  }, []);
  const visible = sort === 'newest'
    ? [...jobs].sort((a, b) => (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0))
    : jobs;
  const job = visible[selected];
  return <div className="dashboard"><Header />
    <main>
      <SearchForm initial={{
        ...initial,
        q: initial.q || (initial.resume === '1' ? profile?.current_title : ''),
        location: initial.location || (initial.resume === '1' ? [profile?.city, profile?.region].filter(Boolean).join(', ') : ''),
        country: initial.country || (initial.resume === '1' ? profile?.country : ''),
      }} sort={sort} onSort={value => { setSort(value); setSelected(0); }} />
      <div className="dashboard-body">
        {error && <p className="dashboard-status" role="alert">{error}</p>}
        {loading && <p className="dashboard-status" role="status">Loading jobs…</p>}
        {!loading && !error && !jobs.length && <p className="dashboard-status">No recent listings match these filters. Try a broader role or location.</p>}
        {saveMessage && <p className="dashboard-status" role="status">{saveMessage}</p>}
        {!!job && <div className="dashboard-grid">
          <section className="dashboard-card dashboard-list" aria-label="Job results">
            <h2>{visible.length} jobs found</h2>
            <JobList jobs={visible} selected={selected} onSelect={setSelected} profile={profile} />
            <section className="dashboard-upgrade" aria-labelledby="dashboard-upgrade-title">
              <div className="dashboard-upgrade-top"><span>Fortune Jobs AI Pro</span><span>Coming soon</span></div>
              <h3 id="dashboard-upgrade-title">Subscribe for more jobs</h3>
              <p>Free searches show up to 10 jobs. Pro will let you see more results.</p>
              <p className="dashboard-upgrade-price"><strong>$7.99</strong><span>/ month</span></p>
            </section>
          </section>
          <JobDetail job={job} profile={profile} saved={savedKeys.has(jobKey(job))} onSave={toggleSave} dashboard />
          <MatchPanel job={job} profile={profile} />
        </div>}
      </div>
    </main>
    <MobileTabs /><Footer />
  </div>;
}
