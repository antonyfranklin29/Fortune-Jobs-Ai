import React, { useState } from 'react';
import { cleanDescription, fitFor, jobAge, logoFor, safeApplyUrl } from './catalogue.js';
import { AiJobTools } from './AiTools.jsx';

export function CompanyMark({ job }) {
  const url = logoFor(job);
  const [failed, setFailed] = useState(false);
  return <span className="featured-logo" aria-hidden="true">{job.company?.charAt(0)?.toUpperCase() || '?'}{url && !failed && <img className="react-logo-image" src={url} alt="" loading="lazy" onError={() => setFailed(true)} referrerPolicy={url.startsWith('https://img.logo.dev/') ? 'origin' : undefined} />}</span>;
}

function SourceCredit({ job }) {
  if (job.source === 'adzuna') return <span className="react-source">Job source: Adzuna</span>;
  if (job.source === 'employer_direct' || job.source === 'employer_feed') return <span className="react-source">Direct employer listing</span>;
  const label = String(job.source || 'Employer').trim();
  return <span className="react-source">Job source: {label.charAt(0).toUpperCase() + label.slice(1)}</span>;
}

export function JobDetail({ job, profile, compact = false, saved = false, onSave, dashboard = false }) {
  if (!job) return <div className="featured-detail" aria-live="polite">Select a job to see its details.</div>;
  const url = safeApplyUrl(job.apply_url);
  const fit = dashboard ? null : fitFor(job, profile);
  const description = cleanDescription(job.job_description);
  return <article className={`featured-detail ${compact ? 'react-detail-compact' : ''}`}>
    <div className="react-detail-head"><CompanyMark job={job} /><div><p className="react-company">{job.company}</p><h3>{job.job_title}</h3><p>{job.location || 'Location not specified'}</p></div></div>
    <div className="react-badges">{job.salary && <span>{job.salary}</span>}{job.employment_type && <span>{job.employment_type}</span>}{job.work_mode && <span>{job.work_mode}</span>}{jobAge(job) && <span>{jobAge(job)}</span>}</div>
    {dashboard ? null : fit ? <section className="react-fit"><h4>Estimated job fit: {fit.score}/100</h4><p>Based on the skills named in this listing and details you confirmed. This is an estimate, not an ATS score or a hiring prediction.</p>{fit.matched?.length > 0 && <p><strong>Skills you have:</strong> {fit.matched.join(', ')}</p>}{fit.missing?.length > 0 && <p><strong>Skills to review:</strong> {fit.missing.join(', ')}</p>}</section> : profile?.skills?.length ? <section className="react-fit"><h4>Fit estimate unavailable</h4><p>This listing does not name enough specific skills to make a useful comparison with your confirmed details. Read the full job description before applying.</p></section> : <section className="react-fit"><h4>See how well it fits you</h4><p>Add a résumé or your experience to see an estimate with reasons.</p><a href="./resume-search.html?manual=1">Add experience and skills →</a></section>}
    {job.search_reason && <section><h4>Why it’s in your results</h4><p>{job.search_reason}</p></section>}
    {!compact && <AiJobTools job={job} />}
    <section><h4>About this role</h4><p>{description ? `${description.slice(0, 900)}${description.length > 900 ? '…' : ''}` : 'Read the full job description on the employer’s listing.'}</p></section>
    <SourceCredit job={job} />
    <div className="react-detail-actions">{url && <a className="react-apply dashboard-gold" href={url} target="_blank" rel="noopener noreferrer">{dashboard ? 'Apply Now' : `Apply on ${job.source === 'adzuna' ? 'Adzuna' : 'the employer site'}`} ↗</a>}{onSave && <button type="button" className="react-save" aria-pressed={saved} onClick={() => onSave(job)}>{saved ? 'Saved' : 'Save job'}</button>}</div>
  </article>;
}

export function JobList({ jobs, selected, onSelect, profile }) {
  return <div className="featured-list" role="list" aria-label="Recent job listings">{jobs.map((job, index) => {
    const fit = fitFor(job, profile);
    return <article className="featured-card" role="listitem" key={`${job.apply_url}-${index}`}><button type="button" className="featured-card-select" aria-pressed={selected === index} onClick={() => onSelect(index)}><CompanyMark job={job} /><span className="featured-card-content"><h3>{job.job_title}</h3><p className="featured-company">{job.company}</p><p className="featured-location">{job.location || 'Location not specified'}</p><p className="featured-snippet">{cleanDescription(job.job_description).slice(0, 115) || 'Read the full description on the original listing.'}</p>{fit ? <strong className="featured-fit">Estimated fit {fit.score}/100</strong> : profile?.skills?.length ? <span className="featured-fit unavailable">Fit unavailable</span> : null}</span><span className="featured-source">{jobAge(job)?.replace(/^Posted /, '')}</span></button><SourceCredit job={job} /></article>;
  })}</div>;
}
