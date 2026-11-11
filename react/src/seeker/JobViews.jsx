import React, { useState } from 'react';
import { cleanDescription, fitFor, jobAge, logoFor, safeApplyUrl } from './catalogue.js';
import { AiJobTools } from './AiTools.jsx';
import { BeforeYouApply, InterviewReady, JobFacts, ResumeKeywords, WhyReal } from './JobInsights.jsx';
import { markStep } from './AiTools.jsx';
import { workAuthorizationLabel } from './workAuthorization.js';

function WorkAuthorizationBadge({ job }) {
  const label = workAuthorizationLabel(job.sponsorship);
  return label ? <span className="featured-fit">{label}</span> : null;
}

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

// Everything we have, behind "Show full description" when long. Job sites only share a preview of most
// listings, so the complete original is always one click away.
export function JobDescription({ job, description, url }) {
  const [open, setOpen] = useState(false);
  const [forJob, setForJob] = useState(job);
  if (forJob !== job) { setForJob(job); setOpen(false); }
  const long = description.length > 900;
  const preview = !description || /(…|\.\.\.)$/.test(description) || description.length < 700 || job.source === 'adzuna';
  const site = job.source === 'usajobs' ? 'USAJOBS' : job.source === 'adzuna' ? 'the original listing' : `${job.company || 'the employer'}’s site`;
  return <section className="react-description"><h4>About this role</h4>
    {description ? <p>{long && !open ? `${description.slice(0, 900).replace(/\s\S*$/, '')}…` : description}</p> : <p>This listing’s full description is on the employer’s page.</p>}
    {long && <button type="button" className="react-more" aria-expanded={open} onClick={() => { setOpen(!open); markStep(job, 'read'); }}>{open ? 'Show less' : 'Show full description'}</button>}
    {url && <p className="react-full-link">{preview && description ? 'This is a preview. ' : ''}<a href={url} target="_blank" rel="noopener noreferrer" onClick={() => markStep(job, 'read')}>Read the complete job description on {site} ↗</a></p>}
  </section>;
}

export function JobDetail({ job, profile, compact = false, saved = false, onSave, dashboard = false }) {
  if (!job) return <div className="featured-detail" aria-live="polite">Select a job to see its details.</div>;
  const url = safeApplyUrl(job.apply_url);
  const fit = dashboard ? null : fitFor(job, profile);
  const description = cleanDescription(job.job_description);
  const actions = (where) => <div className={`react-detail-actions react-actions-${where}`}>{url && <a className="react-apply dashboard-gold" href={url} target="_blank" rel="noopener noreferrer">{dashboard ? 'Apply Now' : `Apply on ${job.source === 'adzuna' ? 'Adzuna' : 'the employer site'}`} ↗</a>}{onSave && <button type="button" className="react-save" aria-pressed={saved} onClick={() => onSave(job)}>{saved ? 'Saved' : 'Save job'}</button>}</div>;
  return <article className={`featured-detail ${compact ? 'react-detail-compact' : ''}`}>
    <div className="react-detail-head"><CompanyMark job={job} /><div><p className="react-company">{job.company}</p><h3>{job.job_title}</h3><p>{job.location || 'Location not specified'}</p></div></div>
    <div className="react-badges">{job.salary && <span>{job.salary}</span>}{job.employment_type && <span>{job.employment_type}</span>}{job.work_mode && <span>{job.work_mode}</span>}{jobAge(job) && <span>{jobAge(job)}</span>}<WorkAuthorizationBadge job={job} /></div>
    {dashboard && actions('top')}
    {dashboard && <WhyReal job={job} />}
    {dashboard ? null : fit ? <section className="react-fit"><h4>Estimated job fit: {fit.score}/100</h4><p>Based on the skills named in this listing and details you confirmed. This is an estimate, not an ATS score or a hiring prediction.</p>{fit.matched?.length > 0 && <p><strong>Skills you have:</strong> {fit.matched.join(', ')}</p>}{fit.missing?.length > 0 && <p><strong>Skills to review:</strong> {fit.missing.join(', ')}</p>}</section> : profile?.skills?.length ? <section className="react-fit"><h4>Fit estimate unavailable</h4><p>This listing does not name enough specific skills to make a useful comparison with your confirmed details. Read the full job description before applying.</p></section> : <section className="react-fit"><h4>See how well it fits you</h4><p>Add a résumé or your experience to see an estimate with reasons.</p><a href="./resume-search.html?manual=1">Add experience and skills →</a></section>}
    {job.search_reason && <section><h4>Why it’s in your results</h4><p>{job.search_reason}</p></section>}
    {!compact && <AiJobTools job={job} />}
    <JobDescription job={job} description={description} url={url} />
    {dashboard && <><JobFacts job={job} /><ResumeKeywords job={job} profile={profile} /><InterviewReady job={job} /><BeforeYouApply job={job} /></>}
    <SourceCredit job={job} />
    {actions('bottom')}
  </article>;
}

export function JobList({ jobs, selected, onSelect, profile }) {
  return <div className="featured-list" role="list" aria-label="Recent job listings">{jobs.map((job, index) => {
    const fit = fitFor(job, profile);
    return <article className="featured-card" role="listitem" key={`${job.apply_url}-${index}`}><button type="button" className="featured-card-select" aria-pressed={selected === index} onClick={() => onSelect(index)}><CompanyMark job={job} /><span className="featured-card-content"><h3>{job.job_title}</h3><p className="featured-company">{job.company}</p><p className="featured-location">{job.location || 'Location not specified'}</p><p className="featured-snippet">{cleanDescription(job.job_description).slice(0, 115) || 'Read the full description on the original listing.'}</p><WorkAuthorizationBadge job={job} />{fit ? <strong className="featured-fit">Estimated fit {fit.score}/100</strong> : profile?.skills?.length ? <span className="featured-fit unavailable">Fit unavailable</span> : null}</span><span className="featured-source">{jobAge(job)?.replace(/^Posted /, '')}</span></button><SourceCredit job={job} /></article>;
  })}</div>;
}
