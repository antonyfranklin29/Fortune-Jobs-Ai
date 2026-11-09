import { describe, expect, it } from 'vitest';
import { atsCheck, atsCheckText, fromText, jobKeywords } from '../lib/atsCheck.js';
import { draft } from '../lib/resumeBuilder.js';

const strong = draft({
  name: 'Ana Silva', email: 'ana@example.com', phone: '555-0100', target: 'Data Analyst',
  summary: 'Data Analyst with 4 years of experience turning sales and operations data into weekly dashboards in SQL and Power BI for leadership teams.',
  experience: [
    'Data Analyst, Example Co. — Jan 2022 – Present',
    'Built 12 Power BI dashboards used by 150 managers each week.',
    'Automated SQL reporting and cut monthly close time by 40%.',
    'Junior Analyst, Sample LLC — 2020–2022',
    'Reconciled $2M in monthly sales data with Excel and Python.',
  ].join('\n'),
  skills: 'SQL\nPower BI\nExcel\nPython\nDAX\nData Visualization\nTableau',
  education: 'B.S. Statistics, State University, 2020',
  projects: 'Created a churn forecasting model in Python with 85% accuracy using scikit-learn and Pandas on public telecom data; documented every step and shared the code and dashboard publicly.\nDesigned a Tableau dashboard comparing housing prices across 50 U.S. states using public census and Zillow data.',
});

describe('atsCheck', () => {
  it('gives an empty draft a low score with a tip for every missing part', () => {
    const r = atsCheck(draft({}));
    expect(r.score).toBeLessThan(20);
    expect(r.grade).toBe('Getting started');
    expect(r.checks.filter((c) => !c.ok && c.id !== 'format').every((c) => c.tip)).toBe(true);
    expect(r.keywords).toBeNull();
  });

  it('scores a complete, dated, measured résumé as strong', () => {
    const r = atsCheck(strong);
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.grade).toBe('Strong');
    expect(r.checks.find((c) => c.id === 'experience').ok).toBe(true);
    expect(r.checks.find((c) => c.id === 'results').ok).toBe(true);
  });

  it('flags weak "Responsible for" lines and undated roles', () => {
    const r = atsCheck(draft({ name: 'A', experience: 'Responsible for reports\nWorked on dashboards' }));
    expect(r.checks.find((c) => c.id === 'action').tip).toMatch(/Responsible for/);
    expect(r.checks.find((c) => c.id === 'experience').tip).toMatch(/dates/);
  });

  it('matches a pasted job description and lists only missing keywords it found in the job', () => {
    const job = 'We are hiring a Data Analyst. Requirements: SQL, Power BI, Snowflake and stakeholder management. Python is a plus.';
    const r = atsCheck(strong, job);
    expect(r.keywords.matched).toEqual(expect.arrayContaining(['SQL', 'Power BI', 'Python', 'Data Analyst']));
    expect(r.keywords.missing).toEqual(expect.arrayContaining(['Snowflake', 'Stakeholder Management']));
    expect(r.keywords.missing).not.toContain('Tableau');
    expect(r.checks.find((c) => c.id === 'keywords').tip).toMatch(/Snowflake/);
  });

  it('ignores very short job text and never matches words inside other words', () => {
    expect(jobKeywords('SQL')).toEqual([]);
    expect(jobKeywords('Our team does research and development on a tight schedule every day of the week.')).not.toContain('R');
  });

  it('reads sections from an uploaded résumé text', () => {
    const text = ['Ana Silva', 'Data Analyst', 'ana@example.com | (555) 010-0100', 'Summary', 'Data Analyst with 4 years of experience building SQL and Power BI reporting for sales and finance teams across three regions.',
      'Experience', 'Data Analyst, Example Co. | Jan 2022 – Present', '• Built 12 Power BI dashboards used by 150 managers', '• Automated SQL reports, cutting close time by 40%',
      'Analyst, Sample LLC | 2019 – 2021', '• Reconciled $2M in monthly sales data', 'Skills', 'SQL, Power BI, Excel, Python, DAX, Tableau', 'Education', 'B.S. Statistics, State University'].join('\n');
    const { data, headings } = fromText(text, { target: 'Data Analyst' });
    expect(data.name).toBe('Ana Silva');
    expect(data.email).toBe('ana@example.com');
    expect(data.phone).toMatch(/555/);
    expect(data.skills).toEqual(['SQL', 'Power BI', 'Excel', 'Python', 'DAX', 'Tableau']);
    expect(headings).toEqual(expect.arrayContaining(['summary', 'experience', 'skills', 'education']));
    const r = atsCheckText(text, '', { target: 'Data Analyst' });
    expect(r.checks.find((c) => c.id === 'format').ok).toBe(true);
    expect(r.checks.find((c) => c.id === 'experience').ok).toBe(true);
    const plain = atsCheckText('Ana Silva\nI did many things at many places over many years for many people.');
    expect(plain.checks.find((c) => c.id === 'format').tip).toMatch(/Experience/);
  });
});
