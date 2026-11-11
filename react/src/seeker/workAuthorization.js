export const WORK_AUTHORIZATION_OPTIONS = [
  ['', 'Work authorization · Any'],
  ['sponsors', 'Sponsors visa'],
  ['opt_friendly', 'OPT/CPT friendly'],
  ['hide_no_sponsorship', 'Hide “no sponsorship” jobs'],
];

export function workAuthorizationFilter(value) {
  return WORK_AUTHORIZATION_OPTIONS.some(([key]) => key === value) ? value : '';
}

export function workAuthorizationLabel(value) {
  if (value === 'sponsors') return 'Mentions visa sponsorship';
  if (value === 'opt_friendly') return 'Mentions OPT/CPT';
  return '';
}
