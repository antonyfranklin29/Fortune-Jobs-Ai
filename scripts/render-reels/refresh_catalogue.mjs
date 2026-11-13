import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { areaListings, readOpenCatalogue, newestFirst } from '../../jobs/catalogue.mjs';

const output = process.argv[2];
if (!output) throw new Error('Supply the destination catalogue.json path');
const window = {};
runInNewContext(readFileSync(new URL('../../config.js', import.meta.url), 'utf8'), { window });
const rows = (await readOpenCatalogue(window.FJ_CONFIG)).sort(newestFirst);
const date = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', dateStyle: 'medium',
}).format(new Date());
const topics = [
  ['data-analyst', 'VA', 'Virginia', 'Data Analyst'],
  ['software-engineer', 'TX', 'Texas', 'Software Engineer'],
  ['software-engineer', 'CA', 'California', 'Software Engineer'],
  ['data-engineer', 'VA', 'Virginia', 'Data Engineer'],
  ['software-engineer', 'NY', 'New York', 'Software Engineer'],
  ['data-scientist', 'CA', 'California', 'Data Scientist'],
  ['machine-learning-engineer', 'CA', 'California', 'Machine Learning Engineer'],
  ['business-analyst', 'IL', 'Illinois', 'Business Analyst'],
  ['qa-engineer', 'CA', 'California', 'QA Engineer'],
  ['devops-engineer', 'VA', 'Virginia', 'DevOps Engineer'],
  ['software-engineer', 'NC', 'North Carolina', 'Software Engineer'],
  ['software-engineer', 'WA', 'Washington', 'Software Engineer'],
  ['software-engineer', 'NJ', 'New Jersey', 'Software Engineer'],
];
const stats = [];
const picks = [];
for (const [role, state, place, title] of topics) {
  const jobs = areaListings(rows, { role, state }).filter(job => job.posted_at);
  const pick = jobs.find(job => job.job_title.length < 80 && job.company.length < 45 &&
    job.location.includes(',') && /^(greenhouse|lever|ashby|breezy|smartrecruiters|workable|adzuna)$/.test(job.source) &&
    !picks.some(previous => previous.company === job.company));
  if (!pick) throw new Error('No eligible new employer for ' + role + ' in ' + place);
  stats.push({ count: jobs.length, title, place, role, state });
  picks.push({ job_title: pick.job_title, company: pick.company, location: pick.location,
    source: pick.source, apply_url: pick.apply_url });
}
writeFileSync(output, JSON.stringify({ date, stats, picks }, null, 2) + '\n');
