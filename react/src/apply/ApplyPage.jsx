// apply.html?job=<id>: a job whose employer takes applications by email. The address
// comes from employer_apply_info() and is shown only while the job is live (or to the
// company and our reviewers as a preview). "Apply by email" opens the job seeker's own
// email program; nothing about the applicant is sent to or stored by Fortune Jobs AI.
import React, { useEffect, useState } from 'react';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const niceDate = (d) => { const t = Date.parse(d + 'T12:00:00'); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : d; };
const MODES = { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' };

export function mailtoFor(job) {
  const subject = `Application: ${job.job_title} (via Fortune Jobs AI)`;
  const body = `Hello ${job.company} hiring team,\n\nI would like to apply for the ${job.job_title} role in ${job.location}, which I found on Fortune Jobs AI.\n\nMy résumé is attached.\n\nThank you,\n`;
  return `mailto:${job.apply_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function ApplyPage({ client, search = window.location.search }) {
  const [state, setState] = useState({ phase: 'loading', job: null });
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(search).get('job') || '';
    if (!UUID.test(id)) { setState({ phase: 'missing', job: null }); return undefined; }
    let active = true;
    client.info(id).then((job) => { if (active) setState(job && job.apply_email ? { phase: 'ready', job } : { phase: 'missing', job: null }); })
      .catch(() => { if (active) setState({ phase: 'error', job: null }); });
    return () => { active = false; };
  }, [client, search]);
  useEffect(() => { if (state.job) document.title = `${state.job.job_title} · ${state.job.company} · Fortune Jobs AI`; }, [state.job]);

  async function copy() {
    try { await navigator.clipboard.writeText(state.job.apply_email); setCopied(true); } catch { setCopied(false); }
  }
  const job = state.job;
  return (
    <div className="fja-apply">
      <nav className="nav"><a className="brand" href="index.html">Fortune Jobs AI</a><a href="find-jobs.html">Find Jobs</a></nav>
      <main>
        {state.phase === 'loading' && <p role="status">Loading this job…</p>}
        {state.phase === 'error' && <p role="status" className="error">This job could not be loaded. Please try again in a moment.</p>}
        {state.phase === 'missing' && <section className="card"><h1>This job is no longer available</h1><p>It may have been filled or closed by the employer.</p><a className="btn" href="find-jobs.html">Find similar jobs</a></section>}
        {job && (
          <article className="card">
            {job.live === false && <p className="preview" role="note">Preview: this job is not live yet. Only your company and our reviewers can open this page.</p>}
            <p className="company">{job.company}</p>
            <h1>{job.job_title}</h1>
            <p className="meta">{[job.location, MODES[job.work_mode] || job.work_mode, job.employment_type].filter(Boolean).join(' · ')}{job.closing_date ? ` · Apply by ${niceDate(job.closing_date)}` : ''}</p>
            <div className="apply-box">
              <h2>Apply by email</h2>
              <p>This employer takes applications by email. Send your résumé to <strong id="applyEmail">{job.apply_email}</strong>.</p>
              <div className="actions">
                <a className="btn" id="applyByEmail" href={mailtoFor(job)}>✉ Apply by email</a>
                <button className="btn btn-outline" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy email address'}</button>
              </div>
              <p className="small">Your email program opens with the subject filled in. Attach your résumé before sending. Fortune Jobs AI does not see or keep your application.</p>
            </div>
            <h2>About the job</h2>
            <p className="desc">{job.description}</p>
            <p className="safety">Stay safe: real employers never ask you to pay a fee, buy equipment, or share your Social Security or bank details before an interview. <a href="contact.html">Report this job</a>.</p>
          </article>
        )}
      </main>
    </div>
  );
}

export function createApplyClient(sb) {
  return {
    async info(id) {
      const { data, error } = await sb.rpc('employer_apply_info', { p_job: id });
      if (error) throw error;
      return data;
    },
  };
}
