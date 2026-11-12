import React, { useEffect, useState } from 'react';

export function partnerQuery(initial) {
  const q = initial.q?.trim();
  if (!q || initial.mode === 'live' || initial.resume === '1' ||
      (initial.country && initial.country !== 'us') ||
      ['sponsorship', 'experience', 'job_type', 'work_mode', 'salary', 'salary_min', 'company', 'category', 'date_posted', 'industry']
        .some(key => initial[key])) return null;
  return { q, location: initial.location?.trim() || '', page: 1 };
}

export function PartnerJobs({ query, name, site, endpoint, onDemand = false }) {
  const [requested, setRequested] = useState(!onDemand);
  const [jobs, setJobs] = useState(null);
  useEffect(() => {
    const config = window.FJ_CONFIG;
    if (!requested || !query || !config) return;
    const controller = new AbortController();
    fetch(config.url + '/functions/v1/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.key },
      credentials: 'omit',
      signal: controller.signal,
      body: JSON.stringify(query),
    }).then(response => response.ok ? response.json() : null)
      .then(data => {
        if (!controller.signal.aborted) setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      })
      .catch(() => { if (!controller.signal.aborted) setJobs([]); });
    return () => controller.abort();
  }, [query, endpoint, requested]);

  if (!query || (!onDemand && !jobs?.length)) return null;
  return <section className="dashboard-card partner-jobs" aria-label={`More jobs from ${name}`}>
    <h2>More jobs from {name}</h2>
    <a href={site} target="_blank" rel="nofollow sponsored noopener noreferrer">Jobs by {name}</a>
    {onDemand && (!requested
      ? <p><button className="react-save" type="button" onClick={() => setRequested(true)}>Search {name}</button></p>
      : !jobs?.length && <p role="status">{jobs ? `No ${name} results available for this search.` : `Loading ${name} jobs…`}</p>)}
    {!!jobs?.length && <ul>{jobs.map(job => <li key={job.url}>
      <a href={job.url} target="_blank" rel="nofollow sponsored noopener noreferrer">{job.title}</a>
      <p>{[job.company, job.location, job.salary].filter(Boolean).join(' · ')}</p>
      {job.description && <p>{job.description}</p>}
    </li>)}</ul>}
  </section>;
}
