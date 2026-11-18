// Text composition is shared by Copy and Word export. Only user-supplied profile
// fields and the generated sections enter the document. Review notes stay outside it.
const text = value => typeof value === 'string' ? value.trim() : '';
const heading = /^(?:experience|work experience|professional experience|skills|technical skills|projects|certifications|summary|professional summary|awards|publications|volunteering|interests|languages)\s*:?$/i;

export function documentIdentity(profile = {}, user = {}) {
  const resume = text(profile.resume_text);
  const lines = resume.split(/\r?\n/).map(line => line.trim());
  const start = lines.findIndex(line => /^education\s*:?$/i.test(line));
  let education = text(profile.education);
  if (!education && start >= 0) {
    const rest = lines.slice(start + 1);
    const stop = rest.findIndex(line => heading.test(line));
    education = rest.slice(0, stop < 0 ? rest.length : stop).join('\n').trim();
  }
  return {
    name: text(profile.full_name) || '[Add your full name]',
    email: text(profile.email) || text(user.email) || resume.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || '[Add your email]',
    phone: text(profile.phone) || '[Add your phone, if you want to include it]',
    education: education || '[Add your education, or remove this section]',
  };
}

export function documentSections(kind, result, identity = {}) {
  const who = { ...documentIdentity(), ...identity };
  const sections = [
    { style: 'name', text: who.name },
    { text: [who.email, who.phone].filter(Boolean).join(' | ') },
  ];
  if (kind === 'cover_letter') {
    sections.push({ text: result.greeting }, ...(result.paragraphs || []).map(text => ({ text })),
      { text: result.closing }, { text: who.name });
    return sections;
  }
  sections.push({ style: 'heading', text: 'Professional Summary' }, { text: result.summary },
    { style: 'heading', text: 'Experience' });
  for (const role of result.experience || []) {
    sections.push({ style: 'role', text: role.role }, ...(role.bullets || []).map(text => ({ style: 'bullet', text })));
  }
  if (!result.experience?.length) sections.push({ text: '[Add your experience, or remove this section]' });
  sections.push({ style: 'heading', text: 'Skills' },
    { text: result.skills?.join(', ') || '[Add your skills]' },
    { style: 'heading', text: 'Education' }, { text: who.education });
  return sections;
}

export const applicationText = (kind, result, identity) => documentSections(kind, result, identity)
  .map(section => (section.style === 'bullet' ? '• ' : '') + (section.text || '')).join('\n\n');

export async function downloadApplication(kind, result, identity, job) {
  const { buildApplicationDocx } = await import('./applicationDocx.js');
  const blob = await buildApplicationDocx(kind, result, identity);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const role = String(job?.job_title || 'application').replace(/[^a-z0-9 -]/gi, '').trim().slice(0, 70);
  link.download = `${role || 'application'}-${kind === 'cover_letter' ? 'cover-letter' : 'resume'}.docx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
