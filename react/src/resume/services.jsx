// Services for the résumé pages. Self-contained so react/src/resume has no
// imports from other feature folders. Pass the app's account services in as
// `account` (any object with sb, user()), or nothing for signed-out use.
import { createContext, useContext } from 'react';

const ResumeServicesContext = createContext(null);

/**
 * @param {object} opts
 * @param {object} [opts.account]   { sb, user() } from the app's account services; optional (builder profile import only)
 * @param {(file:File)=>Promise<string>} [opts.pdfToText]   e.g. pdfToText from /resume-extraction.mjs
 * @param {(file:File)=>Promise<string>} [opts.docxToText]  e.g. window.mammoth.extractRawText
 * @param {()=>object|null} [opts.catalog]  job title and skill suggestions (window.JOB_SUGGESTIONS)
 * @param {Storage} [opts.storage]  defaults to sessionStorage (guest details, two-hour expiry)
 * @param {(url:string)=>void} [opts.navigate]
 * @param {()=>string} [opts.search]
 * @param {()=>void} [opts.print]
 * @param {(text:string)=>boolean} [opts.confirm]
 */
export function createResumeServices(opts = {}) {
  const win = typeof window === 'object' ? window : null;
  return {
    account: opts.account || null,
    pdfToText: opts.pdfToText || null,
    docxToText: opts.docxToText || null,
    catalog: opts.catalog || (() => (win && win.JOB_SUGGESTIONS) || null),
    storage: opts.storage || (win ? win.sessionStorage : null),
    navigate: opts.navigate || ((url) => { win.location.href = url; }),
    search: opts.search || (() => (win ? win.location.search : '')),
    print: opts.print || (() => win.print()),
    confirm: opts.confirm || ((text) => win.confirm(text)),
  };
}

/** Readers the legacy site already ships: /resume-extraction.mjs (pdf.js) and /vendor/mammoth.browser.js. */
export function createBrowserResumeReaders({ extractionUrl = '/resume-extraction.mjs', win = typeof window === 'object' ? window : globalThis } = {}) {
  return {
    async pdfToText(file) { return (await import(/* @vite-ignore */ extractionUrl)).pdfToText(file); },
    async docxToText(file) {
      if (!win.mammoth) throw new Error('The document reader is still loading. Try again in a moment.');
      return (await win.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value.trim();
    },
  };
}

export function ResumeServicesProvider({ services, children }) {
  return <ResumeServicesContext.Provider value={services}>{children}</ResumeServicesContext.Provider>;
}

export function useResumeServices() {
  const value = useContext(ResumeServicesContext);
  if (!value) throw new Error('Wrap résumé pages in <ResumeServicesProvider>.');
  return value;
}

/** Shared file checks and reading for both pages. Returns the text or throws a person-facing error. */
export async function readResumeFile(services, file, { messages }) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['pdf', 'docx'].includes(ext)) throw new Error(messages.type);
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error(messages.size);
  if (ext === 'pdf') {
    if (!services.pdfToText) throw new Error('Résumé reading is unavailable right now. Please try again later.');
    return services.pdfToText(file);
  }
  if (!services.docxToText) throw new Error(messages.docxLoading);
  return String(await services.docxToText(file)).trim();
}

export function readErrorText(error, fallback) {
  return error && error.name === 'PasswordException' ? 'Remove the PDF password and try again.' : (error && error.message) || fallback;
}
