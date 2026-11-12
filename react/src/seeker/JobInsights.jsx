// Extra help under a job and in the Résumé Match panel: the job at a glance, résumé keywords,
// interview questions and a short checklist. Nothing here is presented as coming from the listing
// unless it does: role-typical keywords and questions are labelled as typical for the role.
import React from 'react';
import { cleanDescription, jobAge } from './catalogue.js';
import { contains } from '../resume/lib/resumeMatching.js';

// Typical keywords and interview questions by role family, matched on the job title.
const KITS = [
  { re: /\b(power\s*bi|tableau|bi|business intelligence)\b/i, role: 'BI developer', keywords: ['Power BI', 'DAX', 'Tableau', 'SQL', 'Data Modeling', 'Star Schema', 'ETL', 'Dashboards', 'KPIs', 'Stakeholder Management'],
    questions: ['Walk me through a dashboard you built and the decision it supported.', 'How do you design a star schema for reporting?', 'How do you make a slow report faster?', 'How do you handle conflicting requests from stakeholders?'] },
  { re: /\bdata\s+(?:\w+\s+)?analyst|analytics|reporting analyst|financial data/i, role: 'data analyst', keywords: ['SQL', 'Excel', 'Python', 'Power BI', 'Tableau', 'Data Visualization', 'Data Cleaning', 'A/B Testing', 'Statistics', 'Stakeholder Communication'],
    questions: ['Tell me about an analysis that changed a business decision.', 'How do you check that your data is accurate before you share it?', 'Write a SQL query to find the top 3 customers by revenue each month.', 'How would you explain a technical finding to a non-technical manager?'] },
  { re: /\bdata\s+engineer|etl|data platform/i, role: 'data engineer', keywords: ['SQL', 'Python', 'Spark', 'Airflow', 'dbt', 'Snowflake', 'AWS', 'Data Pipelines', 'Data Warehousing', 'Kafka'],
    questions: ['Describe a data pipeline you built end to end.', 'How do you handle late or duplicate data?', 'Batch or streaming: how do you choose?', 'How do you test and monitor a pipeline?'] },
  { re: /\bdata\s+scien|machine learning|\bml\b|\bai\b|applied scientist/i, role: 'machine learning / data science', keywords: ['Python', 'Machine Learning', 'PyTorch', 'TensorFlow', 'scikit-learn', 'SQL', 'Statistics', 'Model Deployment', 'LLMs', 'Experimentation'],
    questions: ['Walk me through a model you took to production.', 'How do you choose an evaluation metric?', 'How do you detect and handle overfitting?', 'How would you explain a model’s prediction to a stakeholder?'] },
  { re: /\bcloud|devops|site reliability|\bsre\b|platform|infrastructure/i, role: 'cloud / DevOps', keywords: ['AWS', 'Azure', 'Google Cloud', 'Terraform', 'Kubernetes', 'Docker', 'CI/CD', 'Linux', 'Python', 'Monitoring'],
    questions: ['Describe how you would design a highly available service in the cloud.', 'Walk me through a CI/CD pipeline you set up.', 'Tell me about an outage you handled and what changed afterwards.', 'How do you manage infrastructure as code safely?'] },
  { re: /\b(cyber|security|infosec|soc)\b/i, role: 'cybersecurity', keywords: ['SIEM', 'Incident Response', 'Vulnerability Management', 'NIST', 'Firewalls', 'Threat Detection', 'Splunk', 'Cloud Security', 'IAM', 'Risk Assessment'],
    questions: ['Walk me through how you would respond to a phishing incident.', 'How do you prioritise vulnerabilities?', 'Which security frameworks have you worked with?', 'How do you explain a security risk to leadership?'] },
  { re: /\b(qa|quality|test|sdet)\b/i, role: 'QA / test', keywords: ['Test Automation', 'Selenium', 'Cypress', 'API Testing', 'Test Plans', 'Regression Testing', 'CI/CD', 'Python', 'Java', 'Jira'],
    questions: ['How do you decide what to automate?', 'Describe a bug you found that others missed.', 'How do you test an API?', 'How do you keep automated tests reliable?'] },
  { re: /\bservicenow\b/i, role: 'ServiceNow', keywords: ['ServiceNow', 'ITSM', 'JavaScript', 'Glide API', 'Flow Designer', 'Service Portal', 'Integrations', 'CMDB', 'ITIL', 'Scripting'],
    questions: ['Describe a ServiceNow workflow you built.', 'Client scripts or business rules: when do you use each?', 'How have you integrated ServiceNow with another system?', 'How do you handle upgrades without breaking customisations?'] },
  { re: /\bsalesforce\b/i, role: 'Salesforce', keywords: ['Salesforce', 'Apex', 'Lightning Web Components', 'SOQL', 'Flows', 'Integrations', 'Sales Cloud', 'Service Cloud', 'Data Migration', 'Admin'],
    questions: ['Flow or Apex: how do you decide?', 'How do you handle governor limits?', 'Describe a Salesforce integration you built.', 'How do you deploy changes safely?'] },
  { re: /\banaplan\b/i, role: 'Anaplan', keywords: ['Anaplan', 'Model Building', 'Connected Planning', 'FP&A', 'Data Integration', 'Lists and Modules', 'Dashboards', 'Excel', 'Forecasting', 'Stakeholder Management'],
    questions: ['Walk me through an Anaplan model you designed.', 'How do you keep a model fast as it grows?', 'How do you load and reconcile data in Anaplan?', 'How do you gather planning requirements from finance teams?'] },
  { re: /\bbusiness\s+(?:systems\s+)?analyst|product owner/i, role: 'business analyst', keywords: ['Requirements Gathering', 'User Stories', 'Process Mapping', 'SQL', 'Jira', 'Agile', 'Stakeholder Management', 'UAT', 'Documentation', 'Excel'],
    questions: ['How do you gather requirements from people who disagree?', 'Walk me through a process you improved.', 'How do you write a good user story?', 'How do you run user acceptance testing?'] },
  { re: /\b(product|project|program)\s+manager/i, role: 'product / project management', keywords: ['Roadmaps', 'Agile', 'Scrum', 'Stakeholder Management', 'Prioritization', 'Jira', 'Metrics', 'Budgeting', 'Risk Management', 'Communication'],
    questions: ['How do you decide what to build or deliver first?', 'Tell me about a project that went off track and what you did.', 'How do you measure success?', 'How do you handle a stakeholder who disagrees with the plan?'] },
  { re: /\b(software|developer|engineer|ios|android|full[\s-]*stack|front[\s-]*end|back[\s-]*end|web)\b/i, role: 'software engineering', keywords: ['Python', 'Java', 'JavaScript', 'TypeScript', 'React', 'Node.js', 'SQL', 'APIs', 'Git', 'Cloud', 'Testing', 'System Design'],
    questions: ['Tell me about a system you designed and the trade-offs you made.', 'Describe a hard bug and how you found it.', 'How do you make sure your code is reliable and tested?', 'Design a simple URL shortener: what are the main parts?'] },
];
const GENERIC = { role: 'this kind of', keywords: ['Communication', 'Problem Solving', 'Teamwork', 'Excel', 'Project Management', 'Attention to Detail'],
  questions: ['Tell me about yourself and why this role.', 'Describe a challenge at work and how you handled it.', 'What is an achievement you are proud of?', 'Why do you want to work here?'] };

export function kitFor(job) { return KITS.find((k) => k.re.test(job?.job_title || '')) || GENERIC; }

/** Keywords for the résumé: those the listing names first, then ones typical for the role. */
export function keywordsFor(job, profile) {
  const kit = kitFor(job);
  const text = `${job?.job_title || ''} ${cleanDescription(job?.job_description)}`;
  const mine = [...(profile?.skills || []), profile?.resume_text || ''].filter((v) => typeof v === 'string').join(' ');
  const seen = new Set();
  return kit.keywords.map((k) => ({ k, inListing: contains(text, k) }))
    .sort((a, b) => Number(b.inListing) - Number(a.inListing))
    .filter(({ k }) => !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()))
    .map(({ k, inListing }) => ({ keyword: k, inListing, have: !!mine && contains(mine, k) }));
}

export const runAi = (task) => {
  window.dispatchEvent(new CustomEvent('fj-ai-run', { detail: task }));
  document.querySelector('.ai-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export function JobFacts({ job }) {
  const source = job.source === 'adzuna' ? 'Adzuna' : job.source === 'usajobs' ? 'USAJOBS (federal)' : ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'breezy'].includes(job.source) ? `${job.company} careers site` : 'Employer';
  const rows = [
    ['Company', job.company], ['Location', job.location || 'Not specified'],
    ['Work mode', job.work_mode ? job.work_mode[0].toUpperCase() + job.work_mode.slice(1) : 'Not stated'],
    ['Job type', job.employment_type || 'Not stated'], ['Pay', job.salary || 'Not listed'],
    ['Posted', jobAge(job).replace(/^Posted /, '') || 'Unknown'], ['Category', job.category || 'General'], ['Apply through', source],
  ];
  return <section className="insight-facts" aria-label="Job at a glance"><h4>Job at a glance</h4>
    <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>;
}

export function ResumeKeywords({ job, profile }) {
  const list = keywordsFor(job, profile);
  const kit = kitFor(job);
  const hasProfile = !!profile?.skills?.length;
  return <section className="insight-keywords"><h4>Résumé keywords for this job</h4>
    <p>{list.some((x) => x.inListing) ? 'Words marked ★ appear in this listing; the rest are common in ' : 'Common in '}{kit.role} job posts. Add one only if you really have that experience.</p>
    <ul>{list.map(({ keyword, inListing, have }) => <li key={keyword} className={hasProfile ? (have ? 'have' : 'add') : ''}>{inListing && <span aria-label="in this listing">★ </span>}{keyword}{hasProfile && <span className="insight-state">{have ? ' ✓ on your résumé' : ' + add if true'}</span>}</li>)}</ul>
    <button type="button" className="insight-ai" onClick={() => runAi('tailor_resume')}>✨ Tailor my résumé with these</button>
  </section>;
}

export function InterviewReady({ job }) {
  const kit = kitFor(job);
  return <section className="insight-interview"><h4>Get ready for the interview</h4>
    <p>Questions often asked in {kit.role} interviews:</p>
    <ol>{kit.questions.map((q) => <li key={q}>{q}</li>)}</ol>
    <button type="button" className="insight-ai" onClick={() => runAi('interview_prep')}>✨ Prepare answers from my résumé</button>
  </section>;
}

export function BeforeYouApply({ job }) {
  return <section className="insight-checklist"><h4>Before you apply</h4><ul>
    <li>Read the complete listing on the employer’s page and note the must-have requirements.</li>
    <li>Match your résumé’s top lines to the {job.category || 'role'}’s main duties.</li>
    <li>Use the employer’s own words for skills you truly have.</li>
    <li>{job.source === 'usajobs' ? 'Federal applications ask for a USAJOBS account and a résumé that lists hours per week for each job.' : 'Save the job so you can track it after applying.'}</li>
  </ul></section>;
}

/** The person's own profile, for the side panel. */
export function ProfileSnapshot({ profile }) {
  if (!profile?.skills?.length) return null;
  return <section className="insight-profile"><h3>Your profile</h3>
    {profile.current_title && <p><strong>{profile.current_title}</strong>{profile.years_experience != null ? ` · ${profile.years_experience} years` : ''}</p>}
    <ul className="insight-chips">{profile.skills.slice(0, 10).map((s) => <li key={s}>{s}</li>)}</ul>
    <a href="./profile.html">Update profile →</a>
  </section>;
}

export function NextSteps() {
  return <section className="insight-next"><h3>Make your application stronger</h3>
    <button type="button" onClick={() => runAi('tailor_resume')}>✨ Tailor my résumé to this job</button>
    <button type="button" onClick={() => runAi('interview_prep')}>✨ Practice interview questions</button>
    <button type="button" onClick={() => runAi('fit_explain')}>✨ Explain my fit in detail</button>
  </section>;
}

/** "Where Apply goes": tells people plainly whether the button opens the employer or another site. */
export function WhyReal({ job }) {
  const ats = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'breezy'].includes(job.source);
  const [icon, head, text, ok] =
    ats ? ['✓', 'Direct from the employer', `Apply opens ${job.company || 'the company'}’s own careers page. No sign-up on another job site.`, true]
    : job.source === 'usajobs' ? ['✓', 'Official federal job', 'Apply opens the posting on USAJOBS.gov, the U.S. government’s job site.', true]
    : job.source === 'employer_direct' || job.source === 'employer_feed' ? ['✓', 'Posted by a verified employer', 'This employer posted the job on Fortune Jobs AI.', true]
    : job.source === 'adzuna' ? ['i', 'Listed via Adzuna', 'Apply opens the job on Adzuna, which links to the employer.', false]
    : ['i', 'From a job listing', 'Apply opens the original listing.', false];
  return <p className={`why-real ${ok ? 'why-real-ok' : ''}`}><span aria-hidden="true">{icon}</span> <strong>{head}.</strong> {text}</p>;
}

/** Apply-ready: steps that make an application stronger, ticked off as the person does them. */
export function applySteps({ profile, progress, saved }) {
  return [
    ['resume', 'Résumé on your profile', !!profile?.skills?.length, null],
    ['fit_explain', 'Checked how you fit', !!progress.fit_explain, 'fit_explain'],
    ['tailor_resume', 'Tailored your résumé to this job', !!progress.tailor_resume, 'tailor_resume'],
    ['interview_prep', 'Practiced the interview questions', !!progress.interview_prep, 'interview_prep'],
    ['read', 'Read the complete listing', !!progress.read, null],
    ['saved', 'Saved the job to track it', !!saved, null],
  ];
}
export function ApplyReady({ job, profile, saved, progress }) {
  const steps = applySteps({ profile, progress, saved });
  const n = steps.filter((s) => s[2]).length, all = n === steps.length;
  return <section className={`apply-ready ${all ? 'apply-ready-done' : ''}`} aria-label="Apply-ready checklist">
    <div className="apply-ready-head"><h3>Apply-ready</h3><span>{n}/{steps.length}</span></div>
    <div className="apply-ready-bar" aria-hidden="true"><i style={{ width: `${Math.round(100 * n / steps.length)}%` }} /></div>
    <p>{all ? 'You’re ready. Go apply!' : 'Tick these off to send a stronger application.'}</p>
    <ul>{steps.map(([id, label, ok, task]) => <li key={id} className={ok ? 'ok' : ''}>
      <span aria-hidden="true">{ok ? '✓' : '○'}</span> {label}
      {!ok && task && <button type="button" onClick={() => runAi(task)}>Do it</button>}
      {!ok && id === 'resume' && <a href="./profile.html#resume">Add</a>}
    </li>)}</ul>
  </section>;
}
