import React, { useState } from 'react';
import { SuggestInput } from './SuggestInput.jsx';
import { SmartSearch } from './AiTools.jsx';
import { MIN_CHARS, SEARCH_COUNTRIES, exactCountry, fetchCities, localPlaces, matchTitles, mergePlaces, placeLabel } from './suggest.js';

const KIND_LABEL = { title: 'Job title', skill: 'Skill', company: 'Company' };
const flagOf = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65)) : '');

const countries = [['','🌍 Any country'],['us','🇺🇸 United States'],['ca','🇨🇦 Canada'],['gb','🇬🇧 United Kingdom'],['in','🇮🇳 India']];
export function SearchForm({ initial = {}, sort, onSort }) {
  const resume = initial.resume || '';
  const resumeId = initial.resume_id || '';
  const [mode, setMode] = useState(initial.mode === 'live' ? 'live' : 'quick');
  const [query, setQuery] = useState(initial.q || '');
  // A country-only search shows the country name in the location box again.
  const [location, setLocation] = useState(initial.location || (SEARCH_COUNTRIES.find((c) => c.code === initial.country)?.name ?? ''));
  const [country, setCountry] = useState(initial.country || '');
  const [date, setDate] = useState(initial.date_posted || '');
  const [experience, setExperience] = useState(initial.experience || '');
  const [type, setType] = useState(initial.job_type || '');
  const [workMode, setWorkMode] = useState(initial.work_mode || '');
  const [company, setCompany] = useState(initial.company || '');
  const [salary, setSalary] = useState(initial.salary || '');
  const [category, setCategory] = useState(initial.category || '');
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    if (mode === 'live') { setError('Live Search is temporarily unavailable. Choose Quick Match to browse saved jobs.'); return; }
    const clean = query.trim();
    // A country typed or picked in the location box searches with the Country filter.
    const typedCountry = exactCountry(location);
    const params = new URLSearchParams({ mode: 'quick', q: clean });
    if (resume === '0' || resume === '1') params.set('resume', resume);
    if (resume === '1' && resumeId) params.set('resume_id', resumeId);
    for (const [key, value] of Object.entries({ location: typedCountry ? '' : location.trim(), country: typedCountry || country, date_posted: date, experience, job_type: type, work_mode: workMode, company: company.trim(), salary, category })) if (value) params.set(key, value);
    window.location.href = `./results.html?${params}`;
  }
  return <form className="dashboard-search" onSubmit={submit}>
    <div className="dashboard-hero">
      <div className="dashboard-intro"><h1>Make your next move.</h1><p>Find promising roles, see how your skills match, and build a résumé for what comes next.</p></div>
      <div className="dashboard-search-card">
    <div className="mode-toggle" role="group" aria-label="Search mode">
      <button type="button" className={`mode-btn ${mode === 'quick' ? 'active' : ''}`} aria-pressed={mode === 'quick'} onClick={() => { setMode('quick'); setError(''); }}>✧ Quick Match</button>
      <button type="button" className={`mode-btn ${mode === 'live' ? 'active' : ''}`} aria-pressed={mode === 'live'} onClick={() => { setMode('live'); setError(''); }}>⌕ Live Search</button>
    </div>
    <div className="search-wrapper"><div className="search-bar">
      <label className="sb-field"><span aria-hidden="true">⌕</span><SuggestInput id="jobSearchInput" aria-label="Job title or keyword" placeholder="Job title, skill or company" maxLength={120} listLabel="Job title suggestions" minChars={MIN_CHARS}
        value={query} onChange={setQuery} getItems={(q) => matchTitles(q)}
        describe={(it) => ({ label: it.text, at: it.at, len: it.len, detail: KIND_LABEL[it.kind] })}
        onPick={(it) => { setQuery(it.text); if (!location.trim()) setTimeout(() => document.getElementById('locationInput')?.focus(), 0); }} /></label>
      <label className="sb-field loc"><span aria-hidden="true">⌖</span><SuggestInput id="locationInput" aria-label="Location" placeholder="City, state or region" maxLength={120} listLabel="Location suggestions" minChars={MIN_CHARS}
        value={location} onChange={setLocation} getItems={(q) => localPlaces(q, country)}
        fetchMore={(q, signal) => fetchCities(q, country, { signal })} merge={mergePlaces}
        describe={(p) => ({ label: p.name, at: 0, len: Math.min(location.split(',')[0].trim().length, p.name.length), detail: p.scope === 'country' ? 'Country' : [p.admin1 !== p.name ? p.admin1 : '', p.country, p.kind].filter(Boolean).join(' · '), aside: flagOf(p.country_code) })}
        onPick={(p) => { setLocation(placeLabel(p)); if (countries.some(([code]) => code && code === p.country_code)) setCountry(p.country_code); }} /></label>
      <button type="submit">⌕ Search Jobs</button>
    </div></div>
    {error && <p className="react-search-error" role="alert">{error}</p>}
    <SmartSearch />
    <div className="dashboard-resume-links"><a className="dashboard-upload" href="./resume-search.html">⇧ Upload Résumé <small>PDF, DOCX · up to 10MB</small></a><a href={`./results.html?${new URLSearchParams({ mode: 'quick', resume: '0', q: query.trim(), location: location.trim() })}`}>Search without résumé</a></div>
    </div></div>
    <div className="dashboard-filterbar">
    <details className="dashboard-more"><summary>☷ Filters</summary><div className="dashboard-extra">
      <label className="filter-pill wide"><select aria-label="Country" value={country} onChange={event => setCountry(event.target.value)}>{countries.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
      <label className="filter-pill"><select aria-label="Date posted" value={date} onChange={event => setDate(event.target.value)}><option value="">Date posted</option><option value="1">Past 24 hours</option><option value="3">Past 3 days</option><option value="7">Past week</option><option value="30">Past month</option></select></label>
      <label className="filter-pill"><input aria-label="Company" placeholder="Company" value={company} onChange={event => setCompany(event.target.value)} /></label>
    </div></details>
      <label className="filter-pill"><select aria-label="Experience level" value={experience} onChange={event => setExperience(event.target.value)}><option value="">Experience</option><option value="Entry level">Entry level</option><option value="Associate">Associate</option><option value="Mid-Senior level">Mid-Senior level</option></select></label>
      <label className="filter-pill"><select aria-label="Job type" value={type} onChange={event => setType(event.target.value)}><option value="">Job Type</option><option value="Full-time">Full-time</option><option value="Part-time">Part-time</option><option value="Contract">Contract</option></select></label>
      <label className="filter-pill"><select aria-label="On-site or remote" value={workMode} onChange={event => setWorkMode(event.target.value)}><option value="">Work Mode</option><option value="On-site">On-site</option><option value="Remote">Remote</option><option value="Hybrid">Hybrid</option></select></label>
    <label className="filter-pill"><select aria-label="Salary" value={salary} onChange={e => setSalary(e.target.value)}><option value="">Salary</option><option value="listed">Salary listed</option></select></label>
    <label className="filter-pill"><select aria-label="Job category" value={category} onChange={event => setCategory(event.target.value)}>
      <option value="">Job Category</option>
      {['Data Analyst', 'Software Engineer', 'Data Engineer', 'Business Analyst'].map(role => <option key={role}>{role}</option>)}
    </select></label>
    <label className="filter-pill dashboard-sort"><select aria-label="Sort jobs" value={sort} onChange={e => onSort(e.target.value)}><option value="relevance">Sort: Relevance</option><option value="newest">Sort: Newest</option></select></label>
    </div>
  </form>;
}
