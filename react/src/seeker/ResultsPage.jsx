import { SearchAlternatives } from './CatalogueDiscovery.jsx';
import { careRole, matchesJobTags } from '../shared/jobTags.js';
import React, { useEffect, useRef, useState } from 'react';
import { Footer, Header, MobileTabs } from '../shared/Shell.jsx';
import { SearchForm } from './SearchForm.jsx';
import { PartnerJobs, partnerQuery } from './PartnerJobs.jsx';
import { liveSearch } from './liveSearch.js';
import { JobDetail, JobList } from './JobViews.jsx';
import { guestMatchProfile, quickMatches, recentJobs, searchState } from './catalogue.js';
import { workAuthorizationFilter } from './workAuthorization.js';
import { jobKey, supabase } from '../shared/supabase.js';

import { MatchPanel } from './MatchPanel.jsx';
import { SignupNudge } from './SignupNudge.jsx';
import { ProCard } from '../shared/ProCard.jsx';
import { PRO, isActive, mySubscription } from '../shared/billing.js';

import '../styles/dashboard.css';

// Pro results come in pages of 15 so long result lists stay easy to scan.
export const PAGE_SIZE = 15;
export function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return <div className="dashboard-pager" role="navigation" aria-label="Result pages">
    <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
    {Array.from({ length: pages }, (_, index) => <button type="button" key={index} aria-current={index === page ? 'page' : undefined} className={index === page ? 'active' : undefined} onClick={() => onPage(index)}>{index + 1}</button>)}
    <button type="button" disabled={page === pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
  </div>;
}

const params = new URLSearchParams(window.location.search);
const initial = Object.fromEntries(params);
// Careerjet requires fixed outbound IPs. Keep disabled on serverless hosting.
const CAREERJET_ENABLED = false;
const livePartnerQuery = partnerQuery(initial);
// Quick Match → the same search in Live Search (paying partners).
export function liveJobsUrl({ q = '', location = '' }) {
  const params = new URLSearchParams({ mode: 'live', q: String(q).trim() });
  if (String(location).trim()) params.set('location', String(location).trim());
  return './results.html?' + params;
}

// Fields kept within the saved_jobs table limits.
const SAVED_LIMITS = { job_title: 300, company: 200, location: 200, salary: 120, apply_url: 2000, match_reason: 2000 };
export function savedJobRow(job, key) {
  const row = { job_key: key };
  if (job.source) row.source = String(job.source).slice(0, 50);
  const source = { job_title: job.job_title, company: job.company, location: job.location, salary: job.salary, apply_url: job.apply_url, match_reason: job.search_reason };
  for (const [field, limit] of Object.entries(SAVED_LIMITS)) if (source[field] != null && source[field] !== '') row[field] = String(source[field]).slice(0, field === 'apply_url' && job.source === 'jobg8' ? 4000 : limit);
  return row;
}

/** Sign-up link that comes back to the same search after the account is ready. */
export function signInToSaveUrl(loc) {
  const back = ('results.html' + (loc.search || '')).slice(0, 1500);
  return './login.html?mode=signup&next=' + encodeURIComponent(back);
}

const HISTORY_FILTERS = ['location', 'country', 'date_posted', 'experience', 'job_type', 'work_mode', 'company', 'salary', 'salary_min', 'industry', 'sponsorship'];
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

export function ResultsPage({ afterSearch, afterDashboard }) {
  useEffect(()=>{ window.FJSourceTracking?.recordSearch?.(); },[]);
  const [jobs, setJobs] = useState([]);
  const [sort, setSort] = useState('relevance');
  const [selected, setSelected] = useState(0);
  const [page, setPage] = useState(0);
  // Phones show the list and the details one after the other: tapping a job opens its
  // details, and "Back to results" returns to the same row.
  const phone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width:720px)').matches;
  // Desktop/tablet: the detail and match panels stay in view (sticky) while the list scrolls.
  // A newly picked job opens at the top of each panel, and the sticky offset follows the site header.
  const sideRef = useRef(null);
  useEffect(() => {
    const side = sideRef.current;
    if (!side) return;
    side.scrollTop = 0;
    side.querySelectorAll('.featured-detail, .dashboard-match').forEach(panel => { panel.scrollTop = 0; });
  }, [selected]);
  useEffect(() => {
    const setTop = () => {
      const header = document.querySelector('nav[aria-label="Main navigation"]') || document.querySelector('nav');
      const height = header && getComputedStyle(header).position.match(/sticky|fixed/) ? header.offsetHeight : 0;
      document.documentElement.style.setProperty('--dash-top', height + 'px');
    };
    setTop(); window.addEventListener('resize', setTop);
    return () => window.removeEventListener('resize', setTop);
  }, []);
  // Phones: tapping a job opens it as a full-screen card over the list (the list never moves).
  // Back, the phone's back gesture or Esc closes it; ‹ › flips to the previous/next job.
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const onPop = () => setSheet(false);
    const onKey = event => { if (event.key === 'Escape') closeSheet(); };
    window.addEventListener('popstate', onPop); window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey); };
  }, []);
  useEffect(() => {
    document.body.classList.toggle('job-sheet-open', sheet);
    return () => document.body.classList.remove('job-sheet-open');
  }, [sheet]);
  function selectJob(index) {
    setSelected(index);
    if (phone() && !sheet) { setSheet(true); window.history.pushState({ ...(window.history.state || {}), fjSheet: true }, ''); }
  }
  function closeSheet() {
    if (window.history.state?.fjSheet) window.history.back(); else setSheet(false);
  }
  function stepJob(delta) {
    const next = Math.min(Math.max(selected + delta, 0), visible.length - 1);
    setSelected(next); setPage(Math.floor(next / PAGE_SIZE));
  }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(guestMatchProfile);
  const [account, setAccount] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [savedKeys, setSavedKeys] = useState(new Set());
  const [saveMessage, setSaveMessage] = useState('');
  const [subscription, setSubscription] = useState(null);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data?.session?.user;
      if (active) setAuthChecked(true);
      if (!active || !user) return;
      setAccount(user);
      rememberSearch(user.id);
      // Profile and saved jobs don't depend on each other, so load them together.
      const wantProfile = !profile && initial.resume !== '0' && initial.resume !== '1';
      const [personal, saved] = await Promise.all([
        wantProfile ? supabase.from('profiles').select('current_title,years_experience,skills,preferred_locations').eq('id', user.id).maybeSingle() : null,
        supabase.from('saved_jobs').select('job_key'),
      ]);
      if (active && personal && !personal.error && personal.data) setProfile(personal.data);
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
    const controller = new AbortController();
    const filters = {
      country: initial.country || '', location: initial.location || '', date_posted: initial.date_posted || '', sponsorship: workAuthorizationFilter(initial.sponsorship),
      experience: initial.experience || '', job_type: initial.job_type || '', work_mode: initial.work_mode || '', company: initial.company || '', salary: initial.salary || '', salary_min: /^\d{4,7}$/.test(initial.salary_min || '') ? initial.salary_min : '', category: initial.category || '', sector: initial.sector || '', shift: initial.shift || '', license: initial.license || '', specialty: initial.specialty || ''
    };
    // Pro members see more results: check the subscription first (signed-out visitors skip this quickly).
    const searching = initial.q || initial.mode === 'quick' || Object.values(filters).some(Boolean);
    const subscriptionRequest = mySubscription().then((sub) => {
      if (!controller.signal.aborted) setSubscription(sub);
      return sub;
    });
    // Recent jobs are the same for everyone, so fetch them alongside the subscription check instead of after it.
    const request = initial.mode === 'live'
      ? subscriptionRequest.then(sub => liveSearch({ q: initial.q, location: initial.location, sponsorship: initial.sponsorship },
          () => quickMatches(initial.q || '', filters, controller.signal, isActive(sub) ? PRO.results : 10), controller.signal, undefined, isActive(sub) ? PRO.results : 10))
      : searching
      ? subscriptionRequest.then(sub => quickMatches(initial.q || '', filters, controller.signal, isActive(sub) ? PRO.results : 10))
      : recentJobs(controller.signal);
    request
      .then(rows => { if (careRole(initial.q || initial.category)) rows = rows.filter(row => matchesJobTags(row, initial)); if (!controller.signal.aborted) { setJobs(rows); setLoading(false); } })
      .catch(error => { if (!controller.signal.aborted) { setError(error?.code==='H1B_UNAVAILABLE'?error.message:'We could not load jobs right now. Please try your search again.'); setLoading(false); } });
    return () => controller.abort();
  }, []);
  const visible = sort === 'newest'
    ? [...jobs].sort((a, b) => (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0))
    : jobs;
  const job = visible[selected];
  const pages = Math.ceil(visible.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const pageJobs = visible.slice(start, start + PAGE_SIZE);
  function goToPage(next) {
    setPage(next); setSelected(next * PAGE_SIZE);
    requestAnimationFrame(() => document.querySelector('.dashboard-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
  return <div className="dashboard"><Header />
    <main>
      <SearchForm initial={{
        ...initial,
        q: initial.q || (initial.resume === '1' ? profile?.current_title : ''),
        location: initial.location || (initial.resume === '1' ? [profile?.city, profile?.region].filter(Boolean).join(', ') : ''),
        country: initial.country || (initial.resume === '1' ? profile?.country : ''),
      }} sort={sort} onSort={value => { setSort(value); setSelected(0); setPage(0); }} />
      {afterSearch}
      <div className="dashboard-body">
        {error && <p className="dashboard-status" role="alert">{error}</p>}
        {loading && <p className="dashboard-status" role="status">Loading jobs…</p>}
        {!loading && !error && !jobs.length && <p className="dashboard-status">{initial.mode === 'live' ? 'No live partner jobs for this search right now. Try Quick Match to search all our jobs.' : 'No recent listings match these filters. Try a broader role or location.'}</p>}
        {!loading && !error && <SearchAlternatives query={initial.q || initial.category || ''} state={searchState(initial)} count={jobs.length} />}
        {saveMessage && <p className="dashboard-status" role="status">{saveMessage}</p>}
        {!!job && <div className="dashboard-grid">
          <section className="dashboard-card dashboard-list" aria-label="Job results">
            <h2>{visible.length} {visible.length === 1 ? 'job' : 'jobs'} found{pages > 1 && <span className="dashboard-page-note"> · page {page + 1} of {pages}</span>}</h2>
            {Number(initial.salary_min) > 0 && <p className="dashboard-salary-note">Only jobs whose listed US-dollar pay reaches ${Number(initial.salary_min).toLocaleString('en-US')} a year. Listings without a clear salary are left out.</p>}
            {authChecked && !account && <SignupNudge href={signInToSaveUrl(window.location)} />}
            <JobList jobs={pageJobs} selected={selected - start} onSelect={index => selectJob(start + index)} profile={profile} />
            <Pager page={page} pages={pages} onPage={goToPage} />
            {initial.mode !== 'live' && initial.q && <a className="dashboard-live-link" href={liveJobsUrl(initial)}>Also see live jobs from our partners →</a>}
            <ProCard subscription={subscription} />
          </section>
          <div className={'dashboard-side' + (sheet ? ' sheet-open' : '')} ref={sideRef} {...(sheet ? { role: 'dialog', 'aria-modal': 'true', 'aria-label': job.job_title } : {})}>
            <div className="dashboard-sheet-bar">
              <button type="button" className="dashboard-back" onClick={closeSheet}>← Back</button>
              <span className="dashboard-sheet-count">{selected + 1} of {visible.length}</span>
              <button type="button" className="dashboard-sheet-step" aria-label="Previous job" disabled={selected === 0} onClick={() => stepJob(-1)}>‹</button>
              <button type="button" className="dashboard-sheet-step" aria-label="Next job" disabled={selected >= visible.length - 1} onClick={() => stepJob(1)}>›</button>
            </div>
            <JobDetail job={job} profile={profile} saved={savedKeys.has(jobKey(job))} onSave={toggleSave} dashboard />
            <MatchPanel job={job} profile={profile} saved={savedKeys.has(jobKey(job))} />
          </div>
        </div>}
        {CAREERJET_ENABLED && !loading && livePartnerQuery && <PartnerJobs query={livePartnerQuery} name="Careerjet" site="https://www.careerjet.com/" endpoint="careerjet-search" />}
      </div>
      {afterDashboard}
    </main>
    <MobileTabs /><Footer />
  </div>;
}
