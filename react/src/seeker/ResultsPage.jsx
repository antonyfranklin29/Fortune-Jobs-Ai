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

// Fields kept within the saved_jobs table limits.
const SAVED_LIMITS = { job_title: 300, company: 200, location: 200, salary: 120, apply_url: 2000, match_reason: 2000 };
export function savedJobRow(job, key) {
  const row = { job_key: key };
  const source = { job_title: job.job_title, company: job.company, location: job.location, salary: job.salary, apply_url: job.apply_url, match_reason: job.search_reason };
  for (const [field, limit] of Object.entries(SAVED_LIMITS)) if (source[field] != null && source[field] !== '') row[field] = String(source[field]).slice(0, limit);
  return row;
}

/** Sign-up link that comes back to the same search after the account is ready. */
export function signInToSaveUrl(loc) {
  const back = ('results.html' + (loc.search || '')).slice(0, 1500);
  return './login.html?mode=signup&next=' + encodeURIComponent(back);
}

const HISTORY_FILTERS = ['location', 'country', 'date_posted', 'experience', 'job_type', 'work_mode', 'company', 'salary', 'salary_min', 'industry'];
/** The search history row for this page's search, or null when there is nothing to remember. */
export function historyRow(query) {
  const q = String(query.q || '').trim().slice(0, 200);
  if (!q || query.mode === 'live') return null;
  const filters = {};
  for (const key of HISTORY_FILTERS) if (query[key]) filters[key] = String(query[key]).slice(0, 200);
  return { query: q, mode: 'quick', filters: Object.keys(filters).length ? filters : null };
}

let remembered = false;
// Signed-in searches appear in Profile → Search history and update the saved filters, as on the old site.
async function rememberSearch(userId) {
  const row = historyRow(initial);
  if (!row || remembered) return;
  remembered = true;
  // Reloading or sharing the same results page does not add a duplicate entry.
  const last = await supabase.from('search_history').select('query,mode,filters').order('created_at', { ascending: false }).limit(1);
  const previous = !last.error && last.data && last.data[0];
  if (previous && previous.query === row.query && previous.mode === row.mode && JSON.stringify(previous.filters || null) === JSON.stringify(row.filters)) return;
  const history = await supabase.from('search_history').insert(row);
  if (history.error) console.warn('search history', history.error.message);
  const filters = await supabase.from('profiles').update({ saved_filters: row.filters }).eq('id', userId);
  if (filters.error) console.warn('saved filters', filters.error.message);
}

export function ResultsPage({ afterDashboard }) {
  const [jobs, setJobs] = useState([]);
  const [sort, setSort] = useState('relevance');
  const [selected, setSelected] = useState(0);
  // Phones show the list and the details one after the other: tapping a job opens its
  // details, and "Back to results" returns to the same row.
  const phone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width:720px)').matches;
  function selectJob(index) {
    setSelected(index);
    if (phone()) requestAnimationFrame(() => document.getElementById('jobDetailTop')?.scrollIntoView({ block: 'start' }));
  }
  function backToList() {
    const rows = document.querySelectorAll('.featured-list .featured-card');
    (rows[selected] || document.querySelector('.dashboard-list'))?.scrollIntoView({ block: 'center' });
  }
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
      rememberSearch(data.user.id);
      const saved = await supabase.from('saved_jobs').select('job_key');
      if (active && !saved.error) setSavedKeys(new Set((saved.data || []).map(row => row.job_key)));
    });
    return () => { active = false; };
  }, []);
  async function toggleSave(job) {
    if (!account) { window.location.href = signInToSaveUrl(window.location); return; }
    const key = jobKey(job), exists = savedKeys.has(key);
    const operation = exists ? supabase.from('saved_jobs').delete().eq('job_key', key) :
      supabase.from('saved_jobs').insert(savedJobRow(job, key));
    const { error: saveError } = await operation;
    // Already saved (for example in another tab): treat it as saved.
    const duplicate = !exists && saveError && (saveError.code === '23505' || /duplicate/i.test(saveError.message || ''));
    if (saveError && !duplicate) { setSaveMessage('Could not update saved jobs. Please try again.'); return; }
    setSavedKeys(previous => { const next = new Set(previous); exists ? next.delete(key) : next.add(key); return next; });
    setSaveMessage(exists ? 'Removed from saved jobs.' : 'Job saved to your profile.');
  }
  useEffect(() => {
    if (initial.mode === 'live') return;
    const controller = new AbortController();
    const filters = {
      country: initial.country || '', location: initial.location || '', date_posted: initial.date_posted || '',
      experience: initial.experience || '', job_type: initial.job_type || '', work_mode: initial.work_mode || '', company: initial.company || '', salary: initial.salary || '', salary_min: /^\d{4,7}$/.test(initial.salary_min || '') ? initial.salary_min : '', category: initial.category || ''
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
        {!loading && !error && !jobs.length && <p className="dashboard-status">{initial.country && initial.country !== 'us'
          ? 'Quick Match currently has United States listings only. Choose United States or Any country to see jobs.'
          : 'No recent listings match these filters. Try a broader role or location.'}</p>}
        {saveMessage && <p className="dashboard-status" role="status">{saveMessage}</p>}
        {!!job && <div className="dashboard-grid">
          <section className="dashboard-card dashboard-list" aria-label="Job results">
            <h2>{visible.length} jobs found</h2>
            {Number(initial.salary_min) > 0 && <p className="dashboard-salary-note">Only jobs whose listed US-dollar pay reaches ${Number(initial.salary_min).toLocaleString('en-US')} a year. Listings without a clear salary are left out.</p>}
            <JobList jobs={visible} selected={selected} onSelect={selectJob} profile={profile} />
            <section className="dashboard-upgrade" aria-labelledby="dashboard-upgrade-title">
              <div className="dashboard-upgrade-top"><span>Fortune Jobs AI Pro</span><span>Coming soon</span></div>
              <h3 id="dashboard-upgrade-title">Subscribe for more jobs</h3>
              <p>Free searches show up to 10 jobs. Pro will add more results and more AI actions each day.</p>
              <p className="dashboard-upgrade-price"><strong>$9.99</strong><span>/ month</span></p>
            </section>
          </section>
          <button type="button" className="dashboard-back" id="jobDetailTop" onClick={backToList}>← Back to results</button>
          <JobDetail job={job} profile={profile} saved={savedKeys.has(jobKey(job))} onSave={toggleSave} dashboard />
          <MatchPanel job={job} profile={profile} />
        </div>}
      </div>
      {afterDashboard}
    </main>
    <MobileTabs /><Footer />
  </div>;
}
