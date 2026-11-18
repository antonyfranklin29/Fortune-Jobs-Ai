// @vitest-environment node
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { documentIdentity, applicationText } from './applicationDocuments.js';
import { buildApplicationDocx } from './applicationDocx.js';

export const sampleProfile = {
  full_name: 'Taylor Morgan', phone: '202-555-0148',
  resume_text: 'Taylor Morgan\nEducation\nExample University\nB.S. Information Systems, 2026\nSkills\nSQL, Power BI',
};
export const sampleResume = {
  summary: 'Information systems graduate with experience building SQL queries and Power BI reports for coursework.',
  experience: [{ role: 'University reporting project | 2026', bullets: [
    'Used SQL to explore a sample sales dataset and check data quality.',
    'Built a Power BI report to present the results to classmates.',
  ] }], skills: ['SQL', 'Power BI'], keywords_added: ['data quality'], not_supported: ['Professional AWS experience'],
};
const identity = documentIdentity(sampleProfile, { email: 'taylor@example.com' });
const letter = { greeting: 'Dear Hiring Team,', paragraphs: ['I am applying for the analyst role.',
  'My coursework includes SQL queries and Power BI reports.', 'Thank you for considering my application.'], closing: 'Kind regards,', not_supported: ['AWS'] };

async function xml(kind, result, who) {
  const blob = await buildApplicationDocx(kind, result, who);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file('word/document.xml').async('string');
}
describe('application documents', () => {
  it('merges only supplied contact and education into résumé text', () => {
    const copy = applicationText('tailor_resume', sampleResume, identity);
    expect(copy).toContain('taylor@example.com'); expect(copy).toContain('Example University');
    expect(copy).not.toContain('Professional AWS experience');
    expect(copy).not.toContain('Skills\nSQL, Power BI');
  });
  it('missing identity and education stay explicit placeholders', async () => {
    const doc = await xml('tailor_resume', sampleResume, documentIdentity());
    expect(doc).toContain('[Add your full name]'); expect(doc).toContain('[Add your education, or remove this section]');
    expect(doc).not.toContain('Taylor'); expect(doc).not.toContain('University reporting project | 2025');
  });
  it('exports a readable one-column résumé without tables or review notes', async () => {
    const doc = await xml('tailor_resume', sampleResume, identity);
    for (const content of ['Taylor Morgan', 'taylor@example.com', 'Professional Summary', 'Experience', 'SQL', 'Education', 'Example University']) expect(doc).toContain(content);
    expect(doc).not.toMatch(/<w:tbl\b|<w:cols[^>]*w:num="[2-9]"/);
    expect(doc).not.toContain('Professional AWS experience');
  });
  it('exports the letter and signature, leaving unsupported claims outside it', async () => {
    const doc = await xml('cover_letter', letter, identity);
    expect(doc).toContain(letter.greeting); expect(doc).toContain(letter.paragraphs[1]);
    expect(doc).toContain('Taylor Morgan'); expect(doc).not.toContain('AWS');
    expect(doc).not.toContain('Education');
    expect(applicationText('cover_letter', letter, identity)).toContain('Kind regards,');
  });
});
