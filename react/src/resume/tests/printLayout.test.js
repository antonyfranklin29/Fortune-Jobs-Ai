// Guards the résumé PDF layout. Chromium's PDF output was checked separately
// (one page for a short résumé, clean page flow for a long one); these checks
// keep the rules that made that work from regressing.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read the file directly: Vitest does not return CSS text for ?raw imports.
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../resume-builder.css'), 'utf8');
const print = css.slice(css.indexOf('@media print'));

describe('résumé builder print rules', () => {
  it('removes the editor, navigation and import panels from the print layout', () => {
    for (const part of ['.builder-nav', 'h1', '.lead', '.import-card', '.editor', '.preview-toolbar']) {
      expect(print).toContain('.fja-resume-builder ' + part);
    }
    expect(print).toMatch(/\.preview-toolbar\{display:none!important\}/);
  });
  it('does not rely on visibility:hidden, which leaves blank trailing pages', () => {
    expect(print).not.toMatch(/visibility\s*:\s*hidden/);
  });
  it('lets the résumé flow across pages instead of pinning it absolutely', () => {
    expect(print).toMatch(/\.paper\{position:static/);
    expect(print).not.toMatch(/position\s*:\s*absolute/);
    expect(print).toMatch(/break-inside:avoid/);
  });
  it('stays scoped so other routes print normally', () => {
    expect(print).toMatch(/body:has\(\.fja-resume-builder\)/);
    expect(print).not.toMatch(/(^|[{}\s])body\s*\*/);
  });
});
