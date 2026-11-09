// Wording for the employer workspace (from /employer-submissions.js).
export const WORDING_VERSION = 'employer-feed-permission-v1';
export const FREE_LIMIT_FALLBACK = 15;

export const MESSAGES = {
  sign_in_required: 'Please sign in first.',
  email_not_confirmed: 'Please confirm your email address, then reload this page.',
  account_banned: 'Employer access is unavailable for this account. Contact info@fortunejobsai.com for help.',
  account_unavailable: 'This account is no longer available. Please sign out.',
  domain_already_registered: 'Your company is already registered on Fortune Jobs AI. Ask the colleague who registered it, or contact info@fortunejobsai.com to be added.',
  company_email_required: 'Sign in with your work email address, such as name@yourcompany.com, to register a company. Personal email addresses cannot register one.',
  email_domain_mismatch: 'Your work email address must be at the company domain you enter, or at a subdomain of it. Check the domain, or sign in with an address at that company.',
  free_email_domain_not_allowed: "Personal email providers cannot be used as a company domain. Enter your company's own domain.",
  too_many_organizations: 'You can belong to at most three organizations.',
  not_a_member: 'You are not a member of that organization.',
  organization_inactive: 'This organization is not active.',
  post_not_found: 'That post was not found.',
  post_closed: 'Closed posts cannot be edited.',
  nothing_to_submit: 'There are no changes waiting to be submitted.',
  review_required: 'This post has changes that need review before it can go live.',
  revision_not_approved: 'This version has not been approved yet.',
  too_many_open_drafts: 'You have too many drafts open. Submit or close some first.',
  display_and_refresh_permission_required: 'Both display and refresh permission are required to list a career feed.',
  invalid_host: 'One of the application hosts is not a valid public domain.',
  too_many_hosts: 'List at most eight application hosts.',
  board_already_registered: 'That career board is already registered.',
  try_again_in_a_minute: 'Please wait a minute before checking again.',
  upgrade_required: 'You already have 15 active posts. Close one to free a slot. Employer Plus is not available yet.',
  apply_email_domain_mismatch: 'The application email must be at your verified company domain, for example recruiting@yourcompany.com.',
  apply_link_required: 'Add an application link, or choose By email and enter an address at your company domain.',
  apply_url_already_listed: 'This application link is already listed on Fortune Jobs AI. Our team will check it.',
  org_not_verified: 'Approved. It will go live once your organization is verified.',
  expired: 'The closing date has passed. Edit the dates and resubmit.',
  temporarily_unavailable: 'The verification service is temporarily unavailable. Try again shortly.',
  candidate_list_changed: 'Your career feed changed while you were choosing jobs. Open Choose postings again and review the latest list.',
  source_not_publishable: 'This feed is awaiting approval or its permission has expired. Contact info@fortunejobsai.com for help.',
};

export function errorText(err) {
  const raw = String((err && (err.message || err.error_description || err.error)) || err || '');
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k));
  if (key) return MESSAGES[key];
  if (/check constraint|violates/i.test(raw)) return 'Some details are not valid. Check the dates (closing within 90 days of posting), the https application link and the required fields.';
  return 'Something went wrong. Please try again.';
}

export function setupErrorText(e) {
  return /PGRST202|could not find.*function|does not exist/i.test(String(e?.code || '') + ' ' + String(e?.message || ''))
    ? 'Employer setup is being prepared. Please try again shortly or contact info@fortunejobsai.com. Your job seeker account is still available.'
    : errorText(e);
}

export const POST_STATUS = {
  draft: ['Draft', ''], pending_review: ['In review', 'warn'], approved: ['Approved', 'ok'], rejected: ['Not approved', 'bad'],
  published: ['Live', 'ok'], paused: ['Paused', 'warn'], closed: ['Closed', ''],
};
export const ORG_STATUS = { pending: ['Pending review', 'warn'], verified: ['Verified', 'ok'], rejected: ['Not approved', 'bad'], suspended: ['Suspended', 'bad'] };

export function submitResultText(result) {
  if (result && result.published) return 'Your job is live.';
  if (result && result.review === 'automatic') return 'Automatic checks passed, but this job could not go live. Check its status below.';
  return 'Submitted. This job needs a team review before it appears in search.';
}

// Notes shown under a post row. review_note holds only a rejection reason (approval
// clears it). A rejected edit to a live post leaves it published, so the reason
// must not depend on status alone.
export function postNotes(p) {
  const notes = [];
  if (p.publish_state) notes.push(MESSAGES[p.publish_state] || p.publish_state);
  if (p.has_unreviewed_changes) notes.push('Edits are waiting for review; the live version is unchanged.');
  if (p.review_note && !p.has_unreviewed_changes) {
    if (p.status === 'published' || p.status === 'paused') notes.push('Your latest edits were not approved; the live version is unchanged. Reviewer note: ' + p.review_note);
    else notes.push('Reviewer note: ' + p.review_note);
  }
  if (p.status === 'closed' && p.can_activate !== true) notes.push('Reopening is unavailable. Contact info@fortunejobsai.com for help.');
  return notes;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const plusDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

/** acme.com from "https://www.acme.com/careers". */
export const normalizeDomain = (value) => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
