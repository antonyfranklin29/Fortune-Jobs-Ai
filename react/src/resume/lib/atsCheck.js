// ATS readiness check for the résumé builder. Applicant tracking systems (ATS) differ by
// employer and none publish a score, so this is NOT a prediction of any employer's result.
// It checks what ATS parsers and recruiters commonly rely on: contact details, standard
// sections, dated experience, measurable results, skills, length and (when the person
// pastes a job description) the job's keywords. Every point comes from the person's own
// text; nothing is invented or sent anywhere.
import { contains } from './resumeMatching.js';

// Common hard skills and tools named in U.S. job listings. Used only to find which of a
// pasted job's keywords the résumé already mentions.
export const KEYWORDS = [
  // data and analytics
  'SQL', 'Python', 'Excel', 'Power BI', 'Tableau', 'Looker', 'Qlik', 'DAX', 'Power Query', 'SAS', 'SPSS', 'Statistics',
  'Data Analysis', 'Data Visualization', 'Data Modeling', 'Data Warehouse', 'ETL', 'Snowflake', 'Databricks', 'BigQuery',
  'Redshift', 'Spark', 'Hadoop', 'Airflow', 'dbt', 'Pandas', 'NumPy', 'Machine Learning', 'Deep Learning', 'NLP',
  'TensorFlow', 'PyTorch', 'scikit-learn', 'A/B Testing', 'Forecasting', 'Anaplan', 'Alteryx', 'SSIS', 'SSRS', 'Microsoft Fabric',
  // software and cloud
  'JavaScript', 'TypeScript', 'Java', 'C++', 'C#', '.NET', 'Golang', 'Ruby', 'PHP', 'Kotlin', 'Swift', 'React', 'Angular', 'Vue',
  'Node.js', 'Django', 'Flask', 'Spring', 'HTML', 'CSS', 'REST', 'GraphQL', 'Microservices', 'AWS', 'Azure', 'Google Cloud',
  'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins', 'CI/CD', 'Git', 'Linux', 'PostgreSQL', 'MySQL', 'Oracle',
  'SQL Server', 'MongoDB', 'Redis', 'Kafka', 'Agile', 'Scrum', 'Jira', 'Unit Testing', 'Selenium', 'API',
  // security and IT
  'Cybersecurity', 'SIEM', 'Splunk', 'Incident Response', 'Vulnerability Management', 'NIST', 'Firewalls', 'Active Directory',
  'Networking', 'TCP/IP', 'ITIL', 'ServiceNow', 'Help Desk', 'Security+', 'CISSP', 'Identity and Access Management',
  // business and enterprise
  'Salesforce', 'SAP', 'Workday', 'Oracle EBS', 'Dynamics 365', 'SharePoint', 'Business Analysis', 'Requirements Gathering',
  'Process Improvement', 'Stakeholder Management', 'Project Management', 'Product Management', 'Roadmap', 'Budgeting',
  'Financial Analysis', 'Financial Modeling', 'Accounting', 'GAAP', 'Reconciliation', 'Accounts Payable', 'Accounts Receivable',
  'QuickBooks', 'Payroll', 'Auditing', 'Compliance', 'Risk Management', 'Supply Chain', 'Inventory', 'Logistics', 'Procurement',
  'Six Sigma', 'Lean', 'PMP', 'Change Management', 'Vendor Management', 'Contract Management',
  // marketing, sales and service
  'SEO', 'SEM', 'Google Analytics', 'Google Ads', 'Content Marketing', 'Social Media', 'Email Marketing', 'HubSpot', 'CRM',
  'Lead Generation', 'Account Management', 'B2B', 'B2C', 'Customer Service', 'Customer Success', 'Negotiation', 'Cold Calling',
  // design
  'Figma', 'Adobe Photoshop', 'Adobe Illustrator', 'UX Research', 'Wireframing', 'Prototyping', 'Accessibility',
  // healthcare and people
  'Nursing', 'Patient Care', 'EHR', 'Epic', 'HIPAA', 'BLS', 'ACLS', 'Medication Administration', 'Recruiting', 'Onboarding',
  'Employee Relations', 'HRIS', 'Training',
  // general
  'Communication', 'Leadership', 'Problem Solving', 'Microsoft Office', 'Bilingual', 'Spanish',
];

const ACTION = /^(?:[-•*]\s*)?(?:led|built|created|designed|developed|delivered|launched|managed|improved|increased|reduced|cut|saved|automated|implemented|analy[sz]ed|owned|drove|grew|streamlined|migrated|optimi[sz]ed|resolved|trained|mentored|coordinated|negotiated|established|produced|wrote|supported|maintained|administered|configured|deployed|partnered|presented|prepared|reconciled|achieved|won|generated|scaled|shipped|modeled|forecast|tested|organi[sz]ed|planned|oversaw|directed|spearheaded)\b/i;
const NUMBER = /(?:\d+(?:[.,]\d+)?\s*(?:%|percent|k\b|m\b|x\b|\+)|\$\s?\d|\b\d{2,}\b)/i;
const DATE = /\b(?:19|20)\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2}\b|\bpresent\b|\bcurrent\b/i;
const WEAK = /^\s*(?:responsible for|worked on|duties included|helped with)\b/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Keywords from KEYWORDS (plus any extra terms) that the job text mentions. */
export function jobKeywords(jobText, extra = []) {
  const text = String(jobText || '');
  if (text.replace(/\s/g, '').length < 40) return [];
  return [...new Set([...KEYWORDS, ...extra])].filter((k) => contains(text, k));
}

const words = (s) => (String(s || '').match(/[A-Za-z0-9][\w'’+#.-]*/g) || []).length;

/**
 * @param data  the builder's draft() output
 * @param jobText optional pasted job description
 * @returns { score, max, grade, checks: [{ id, label, ok, points, max, tip }], keywords: { matched, missing } | null }
 */
export function atsCheck(data, jobText = '', upload = null) {
  const d = data || {};
  const exp = d.experience || [], skills = d.skills || [], edu = d.education || [], proj = d.projects || [];
  const all = upload ? String(upload.fullText || '') : [d.name, d.target, d.summary, ...exp, ...skills, ...edu, ...proj].filter(Boolean).join('\n');
  const total = upload ? upload.words : words(all);
  const evidence = [...exp, ...proj];
  const dated = exp.filter((l) => DATE.test(l)).length;
  const action = evidence.filter((l) => ACTION.test(l)).length;
  const measured = evidence.filter((l) => NUMBER.test(l.replace(DATE, ''))).length;
  const weak = evidence.filter((l) => WEAK.test(l)).length;
  const checks = [];
  const add = (id, label, max, earned, tip) => checks.push({ id, label, max, points: Math.max(0, Math.min(max, Math.round(earned))), ok: earned >= max, tip: earned >= max ? '' : tip });

  const contacts = [!!d.name, EMAIL.test(d.email || ''), !!d.phone].filter(Boolean).length;
  add('contact', 'Name, email and phone at the top', 10, (contacts / 3) * 10, 'Add your name, a valid email and a phone number. ATS systems read these first to create your applicant record.');
  add('title', 'Target job title', 8, d.target ? 8 : 0, 'Add the exact job title you are applying for. Recruiters often search the ATS by title.');
  const sl = (d.summary || '').length;
  add('summary', 'Short professional summary', 8, sl >= 150 && sl <= 700 ? 8 : sl ? 4 : 0, sl > 700 ? 'Keep the summary to 2–4 sentences.' : 'Write a 2–4 sentence summary that names your role, years of experience and main skills.');
  add('experience', 'Experience section with dates', 14, exp.length ? 6 + (dated >= 2 || (dated && exp.length <= 6) ? 8 : dated ? 4 : 0) : 0,
    exp.length ? 'Put the employer and dates (e.g. "2022–2025" or "Jan 2022 – Present") on each role line. Many ATS systems calculate experience from dates.' : 'Add your work experience, one line per role or achievement.');
  add('action', 'Lines start with action verbs', 8, evidence.length ? 8 * Math.min(1, action / Math.max(1, Math.ceil(evidence.length / 2))) - (weak ? 2 : 0) : 0,
    weak ? 'Replace "Responsible for" / "Worked on" with what you did: "Built…", "Reduced…", "Led…".' : 'Start achievement lines with a verb such as Built, Led, Reduced or Automated.');
  add('results', 'Measurable results', 10, evidence.length ? 10 * Math.min(1, measured / 2) : 0, 'Add numbers you can verify, such as "cut report time by 40%" or "supported 120 users".');
  add('skills', 'Skills section (6+ skills)', 12, Math.min(12, skills.length * 2), 'List at least 6 specific skills or tools, one per line, using the same words as the job listing.');
  add('education', 'Education or certifications', 6, edu.length ? 6 : 0, 'Add your degree, school or certifications. Some ATS filters require an education entry.');
  const most = upload ? 1100 : 900;
  add('length', 'Length fits one or two pages', 6, total >= 250 && total <= most ? 6 : total >= 120 ? 3 : 0, total > most ? 'Trim to the most relevant work; one to two pages reads best.' : 'Add more detail about your work; about 400–800 words reads best.');
  if (upload) {
    const found = ['experience', 'skills', 'education'].filter((h) => upload.headings.includes(h)).length;
    add('format', 'Standard section headings', 8, (found / 3) * 8, 'Use plain headings such as "Experience", "Skills" and "Education" so ATS software can find each section. Avoid tables, text boxes and images.');
  } else add('format', 'Plain layout ATS can read', 8, 8, '');

  let keywords = null;
  const wanted = jobKeywords(jobText, d.target ? [d.target] : []);
  if (wanted.length) {
    const matched = wanted.filter((k) => contains(all, k));
    const missing = wanted.filter((k) => !contains(all, k));
    keywords = { matched, missing };
    add('keywords', 'Matches the job’s keywords', 20, 20 * (matched.length / wanted.length),
      `Add the job’s keywords you really have: ${missing.slice(0, 8).join(', ')}. Use them in your skills and experience lines.`);
  }

  const max = checks.reduce((s, c) => s + c.max, 0);
  const score = Math.round((checks.reduce((s, c) => s + c.points, 0) / max) * 100);
  const grade = score >= 85 ? 'Strong' : score >= 70 ? 'Good' : score >= 50 ? 'Needs work' : 'Getting started';
  return { score, max: 100, grade, checks, keywords };
}

// ---- Uploaded résumés: find the sections in plain text, then run the same checks. ----
const HEADINGS = [
  ['summary', /^(?:professional\s+|career\s+|executive\s+)?(?:summary|profile|objective|about(?:\s+me)?)$/i],
  ['experience', /^(?:professional\s+|work\s+|relevant\s+|career\s+)?(?:experience|employment(?:\s+history)?|work\s+history|career\s+history)$/i],
  ['skills', /^(?:(?:technical|core|key|professional)\s+)?(?:skills|competencies|technologies|expertise|tools)(?:\s*(?:&|and)\s*(?:tools|technologies|abilities))?$/i],
  ['education', /^(?:education|academic\s+background|education\s*(?:&|and)\s*(?:certifications?|training)|certifications?|licenses?(?:\s*(?:&|and)\s*certifications?)?|training)$/i],
  ['projects', /^(?:(?:key|personal|selected|academic)\s+)?projects$/i],
];
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const bullet = (l) => l.replace(/^[\s•●▪◦*·–-]+/, '').trim();

/** Split plain résumé text into the builder's draft shape. headings = which standard sections were found. */
export function fromText(text, { target = '' } = {}) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const sections = { summary: [], experience: [], skills: [], education: [], projects: [] };
  const headings = new Set();
  let current = null, firstHeading = -1;
  lines.forEach((line, i) => {
    const key = line.length <= 45 ? HEADINGS.find(([, re]) => re.test(line.replace(/[:\s]+$/, '').replace(/\s+/g, ' ')))?.[0] : null;
    if (key) { current = key; headings.add(key); if (firstHeading < 0) firstHeading = i; return; }
    if (current) sections[current].push(bullet(line));
  });
  const top = lines.slice(0, firstHeading < 0 ? 6 : Math.min(firstHeading, 8));
  const email = (String(text).match(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i) || [''])[0];
  const phone = (String(text).match(PHONE) || [''])[0];
  const name = top.find((l) => /^[A-Za-z][A-Za-z.'’ -]{2,60}$/.test(l) && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 5) || '';
  const body = headings.has('experience') ? sections.experience : lines.slice(top.length).map(bullet);
  const skills = sections.skills.flatMap((l) => l.replace(/^[^:]{1,30}:\s*/, '').split(/\s*[,|;•·]\s*/)).map((s) => s.trim()).filter((s) => s && s.length <= 60);
  return {
    data: {
      name, email, phone, location: '', link: '', target: String(target || '').trim(),
      summary: sections.summary.join(' ').slice(0, 2000), experience: body.slice(0, 80), skills: [...new Set(skills)].slice(0, 60),
      education: sections.education.slice(0, 20), projects: sections.projects.slice(0, 20),
    },
    headings: [...headings],
    words: words(text),
  };
}

/** ATS readiness for an uploaded résumé's text. */
export function atsCheckText(text, jobText = '', opts = {}) {
  const { data, headings, words: total } = fromText(text, opts);
  const r = atsCheck(data, jobText, { fullText: text, headings, words: total });
  return r;
}
