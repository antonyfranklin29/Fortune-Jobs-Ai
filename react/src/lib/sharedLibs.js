// The site's shared helper libraries, bundled into the React app as modules instead of
// separate <script> tags. The files themselves stay at the repo root because the Node
// tests and scripts (tests/*.cjs, scripts/*.mjs) load the same code.
// Each file is a small UMD wrapper: the bundler may hand back its exports, or the file may
// register itself on window; either way we take the same API object.
import '../../../company-brand-map.js';
import * as logos from '../../../company-logos.js';
import * as safety from '../../../data-safety.js';
import * as accuracy from '../../../search-accuracy.js';
import * as matching from '../../../resume-matching.js';
import '../../../job-titles.js';

const api = (ns, globalName) => {
  const value = ns?.default && typeof ns.default === 'object' ? ns.default : globalThis[globalName];
  if (!value) throw new Error(`Shared library ${globalName} did not load`);
  return value;
};

export const FJCompanyLogos = api(logos, 'FJCompanyLogos');
export const FJDataSafety = api(safety, 'FJDataSafety');
export const FJAccuracy = api(accuracy, 'FJAccuracy');
export const FJResume = api(matching, 'FJResume');
export const JOB_SUGGESTIONS = globalThis.JOB_SUGGESTIONS;

/** mammoth (reads .docx résumés) is ~600 KB, so it is only loaded when someone picks a Word file. */
let mammothLoad = null;
export function loadMammoth() {
  if (globalThis.mammoth) return Promise.resolve(globalThis.mammoth);
  mammothLoad ||= import('../../../vendor/mammoth.browser.js').then((m) => {
    const lib = m?.default?.extractRawText ? m.default : globalThis.mammoth;
    if (!lib) throw new Error('Word reader did not load');
    return lib;
  });
  return mammothLoad;
}
