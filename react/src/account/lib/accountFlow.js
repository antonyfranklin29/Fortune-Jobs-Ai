// ESM port of /account-flow.js. Keep both in step: tests/accountFlow.parity.test.js
// runs the same inputs through the original file and this one.

// Only these pages may be used as a post-sign-in destination (blocks open redirects).
export const ALLOWED_NEXT_PAGES = new Set([
  'index.html', 'find-jobs.html', 'results.html', 'profile.html', 'resume-search.html', 'resume-builder.html',
  'about.html', 'contact.html', 'privacy.html', 'email-preferences.html', 'employers.html',
]);

export function next(value, fallback = 'profile.html') {
  if (typeof value !== 'string' || value.length > 1800 || /[\\\s\u0000-\u001f\u007f]/.test(value)) return fallback;
  const pathname = value.split(/[?#]/)[0];
  return ALLOWED_NEXT_PAGES.has(pathname) ? value : fallback;
}

export function callbackError(search, hash) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const code = query.get('error_code') || fragment.get('error_code') || query.get('error') || fragment.get('error');
  if (!code) return '';
  if (/expired|otp_expired/i.test(code)) return 'This email link has expired or was already used. Request a new link.';
  if (/access_denied/i.test(code)) return 'Sign-in was cancelled or the link could not be verified. Please try again.';
  return 'Sign-in could not be completed. Please try again or use email.';
}

export function providers(settings) {
  return { google: settings?.external?.google === true };
}

export function isEmployerNext(value) {
  return next(value, '').split(/[?#]/)[0] === 'employers.html';
}

export function employerNext(value) {
  return isEmployerNext(value) ? value : 'employers.html';
}
