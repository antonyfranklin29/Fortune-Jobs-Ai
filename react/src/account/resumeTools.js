// Adapter for the résumé readers the legacy site already ships. ProfilePage only
// calls this through services.resumeTools, so the app shell decides how these are
// loaded (the legacy scripts, or ESM ports later).
//   pdfToText  - /resume-extraction.mjs (pdf.js from /vendor)
//   docxToText - window.mammoth from /vendor/mammoth.browser.js
//   suggest    - window.FJResume.suggest from /resume-matching.js
//   catalog    - window.JOB_SUGGESTIONS from /job-titles.js
export function createBrowserResumeTools({ extractionUrl = '/resume-extraction.mjs', win = typeof window === 'object' ? window : globalThis } = {}) {
  return {
    async pdfToText(file) { return (await import(/* @vite-ignore */ extractionUrl)).pdfToText(file); },
    async docxToText(file) {
      if (!win.mammoth) throw new Error('Document reader is still loading. Please try again.');
      return (await win.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value.trim();
    },
    suggest(text, catalog) {
      if (!win.FJResume) throw new Error('Resume reading is unavailable right now. Please try again later.');
      return win.FJResume.suggest(text, catalog || {});
    },
    catalog() { return win.JOB_SUGGESTIONS || null; },
  };
}
