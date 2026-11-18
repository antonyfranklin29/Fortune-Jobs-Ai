// Loaded only after Download .docx. Files are assembled entirely in this browser.
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { documentSections } from './applicationDocuments.js';

export function buildApplicationDocx(kind, result, identity) {
  const children = documentSections(kind, result, identity).flatMap(section =>
    String(section.text || '').split('\n').map(line => new Paragraph({
      heading: section.style === 'heading' ? HeadingLevel.HEADING_1 : undefined,
      bullet: section.style === 'bullet' ? { level: 0 } : undefined,
      keepNext: ['heading', 'role'].includes(section.style),
      spacing: { after: section.style === 'heading' ? 120 : 160 },
      children: [new TextRun({ text: line, bold: ['name', 'role', 'heading'].includes(section.style),
        size: section.style === 'name' ? 32 : section.style === 'heading' ? 24 : 22 })],
    })));
  const document = new Document({
    creator: 'Fortune Jobs AI', title: kind === 'cover_letter' ? 'Cover Letter' : 'Tailored Resume',
    styles: { default: { document: { run: { font: 'Calibri', size: 22, color: '000000' } },
      heading1: { run: { font: 'Calibri', size: 24, bold: true, color: '000000' } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 },
      margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children }],
  });
  return Packer.toBlob(document);
}
