import { FJResume, JOB_SUGGESTIONS, loadMammoth } from '../lib/sharedLibs.js';
// Résumé readers for the profile page (through services.resumeTools).
//   pdfToText  - /resume-extraction.mjs (pdf.js from /vendor), loaded on use
//   docxToText - mammoth, loaded on use (lib/sharedLibs.js)
//   suggest    - FJResume.suggest and catalog - JOB_SUGGESTIONS, bundled modules
// `win` lets tests supply their own versions.
export function createBrowserResumeTools({ extractionUrl = '/resume-extraction.mjs', win = typeof window === 'object' ? window : globalThis } = {}) {
  return {
    async pdfToText(file) { return (await import(/* @vite-ignore */ extractionUrl)).pdfToText(file); },
    async docxToText(file) {
      let reader = win.mammoth;
      if (!reader) { try { reader = await loadMammoth(); } catch { throw new Error('Document reader is still loading. Please try again.'); } }
      return (await reader.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value.trim();
    },
    suggest(text, catalog) {
      const lib = win.FJResume || FJResume;
      if (!lib) throw new Error('Resume reading is unavailable right now. Please try again later.');
      return lib.suggest(text, catalog || {});
    },
    catalog() { return win.JOB_SUGGESTIONS || JOB_SUGGESTIONS || null; },
  };
}
