// The H-1B option and badge lookups stay hidden until the DOL aggregates are loaded and config.js sets h1bReady: true.
export const h1bReady = () => typeof window !== 'undefined' && window.FJ_CONFIG?.h1bReady === true;

export const WORK_AUTHORIZATION_OPTIONS = [
  ['', 'Work authorization · Any'],
  ['sponsors', 'Sponsors visa'],
  ['opt_friendly', 'OPT/CPT friendly'],
  ['recent_h1b', 'Employers with recent H-1B filings'],
  ['hide_no_sponsorship', 'Hide “no sponsorship” jobs'],
];

export const visibleWorkAuthorizationOptions = () => WORK_AUTHORIZATION_OPTIONS.filter(([key]) => key !== 'recent_h1b' || h1bReady());

export function workAuthorizationFilter(value) {
  return WORK_AUTHORIZATION_OPTIONS.some(([key]) => key === value) ? value : '';
}

export function workAuthorizationLabel(value) {
  if (value === 'sponsors') return 'Mentions visa sponsorship';
  if (value === 'opt_friendly') return 'Mentions OPT/CPT';
  return '';
}
