import React, { useState } from 'react';

const countries = [['','🌍 Any country'],['us','🇺🇸 United States'],['ca','🇨🇦 Canada'],['gb','🇬🇧 United Kingdom'],['in','🇮🇳 India']];
export function SearchForm({ initial = {}, compact = false }) {
  const resume = initial.resume || '';
  const resumeId = initial.resume_id || '';
  const [mode, setMode] = useState(initial.mode === 'live' ? 'live' : 'quick');
  const [query, setQuery] = useState(initial.q || '');
  const [location, setLocation] = useState(initial.location || '');
  const [country, setCountry] = useState(initial.country || '');
  const [date, setDate] = useState(initial.date_posted || '');
  const [experience, setExperience] = useState(initial.experience || '');
  const [type, setType] = useState(initial.job_type || '');
  const [workMode, setWorkMode] = useState(initial.work_mode || '');
  const [company, setCompany] = useState(initial.company || '');
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    if (mode === 'live') { setError('Live Search is temporarily unavailable. Choose Quick Match to browse saved jobs.'); return; }
    const clean = query.trim();
    if (!clean) { setError('Enter a job title or skill to start your search.'); return; }
    const params = new URLSearchParams({ mode: 'quick', q: clean });
    if (resume === '0' || resume === '1') params.set('resume', resume);
    if (resume === '1' && resumeId) params.set('resume_id', resumeId);
    for (const [key, value] of Object.entries({ location: location.trim(), country, date_posted: date, experience, job_type: type, work_mode: workMode, company: company.trim() })) if (value) params.set(key, value);
    window.location.href = `./results.html?${params}`;
  }
  return <form className={`react-search ${compact ? 'react-search-compact' : ''}`} onSubmit={submit}>
    <div className="mode-toggle" role="group" aria-label="Search mode">
      <button type="button" className={`mode-btn ${mode === 'quick' ? 'active' : ''}`} aria-pressed={mode === 'quick'} onClick={() => { setMode('quick'); setError(''); }}>⚡ Quick Match</button>
      <button type="button" className={`mode-btn ${mode === 'live' ? 'active' : ''}`} aria-pressed={mode === 'live'} onClick={() => { setMode('live'); setError(''); }}>🔴 Live Search</button>
    </div>
    <div className="mode-desc"><strong>{mode === 'quick' ? '⚡ Quick Match' : '🔴 Live Search'}</strong> — {mode === 'quick' ? 'fast results from saved job listings' : 'temporarily unavailable while we finish launch checks'}</div>
    <div className="search-wrapper"><div className="search-bar">
      <label className="sb-field"><span aria-hidden="true">⌕</span><input id="jobSearchInput" aria-label="Job title or keyword" placeholder="Job title, skill or company" value={query} onChange={event => setQuery(event.target.value)} maxLength={120} /></label>
      <label className="sb-field loc"><span aria-hidden="true">⌖</span><input aria-label="Location" placeholder="City, state or region" value={location} onChange={event => setLocation(event.target.value)} maxLength={120} /></label>
      <button type="submit">Search jobs →</button>
    </div></div>
    {error && <p className="react-search-error" role="alert">{error}</p>}
    {!compact && <div className="browse-roles" aria-label="Explore jobs by role"><span>Explore roles</span>{['Data Analyst','Software Engineer','Data Engineer'].map(role=>{const p=new URLSearchParams({mode:'quick',q:role});if(resume==='0'||resume==='1')p.set('resume',resume);if(resume==='1'&&resumeId)p.set('resume_id',resumeId);return <a key={role} href={`./results.html?${p}`}>{role}</a>;})}</div>}
    <details className="advanced-filters"><summary>More filters <span>Country, date, experience, job type and company</span></summary><div className="filters">
      <label className="filter-pill wide"><select aria-label="Country" value={country} onChange={event => setCountry(event.target.value)}>{countries.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
      <label className="filter-pill"><select aria-label="Date posted" value={date} onChange={event => setDate(event.target.value)}><option value="">Date posted</option><option value="1">Past 24 hours</option><option value="3">Past 3 days</option><option value="7">Past week</option><option value="30">Past month</option></select></label>
      <label className="filter-pill"><select aria-label="Experience level" value={experience} onChange={event => setExperience(event.target.value)}><option value="">Experience level</option><option value="Entry level">Entry level</option><option value="Associate">Associate</option><option value="Mid-Senior level">Mid-Senior level</option></select></label>
      <label className="filter-pill"><select aria-label="Job type" value={type} onChange={event => setType(event.target.value)}><option value="">Job type</option><option value="Full-time">Full-time</option><option value="Part-time">Part-time</option><option value="Contract">Contract</option></select></label>
      <label className="filter-pill"><select aria-label="On-site or remote" value={workMode} onChange={event => setWorkMode(event.target.value)}><option value="">On-site / Remote</option><option value="On-site">On-site</option><option value="Remote">Remote</option><option value="Hybrid">Hybrid</option></select></label>
      <label className="filter-pill"><input aria-label="Company" placeholder="Company" value={company} onChange={event => setCompany(event.target.value)} /></label>
    </div></details>
  </form>;
}
