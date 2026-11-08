// Account (transactional) emails: they confirm something the person just did, so they go to everyone
// with an account and carry no marketing. Pure functions, no network, so tests can render them.
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SITE = 'https://fortunejobsai.com';
const day = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''; };
const first = (name) => esc(String(name || '').trim().split(/\s+/)[0] || 'there');

function layout({ kicker, title, body, cta, address }) {
  const button = cta ? `<p style="margin:24px 0"><a href="${esc(cta.href)}" style="display:inline-block;background:#D4A843;color:#10243B;padding:13px 22px;text-decoration:none;font-weight:bold;border-radius:6px">${esc(cta.label)}</a></p>` : '';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#EDF0F5;font:15px/1.6 Arial,sans-serif;color:#10243B"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:auto;background:#fff"><tr><td style="background:#10243B;border-bottom:4px solid #D4A843;padding:22px 24px;color:#fff"><img src="${SITE}/newsletter-logo.png" width="36" height="36" alt="" style="vertical-align:middle;margin-right:10px"><strong>FORTUNE JOBS AI</strong></td></tr><tr><td style="padding:28px"><div style="font-size:11px;letter-spacing:2px;color:#806018">${esc(kicker)}</div><h1 style="font-size:26px;line-height:1.25;margin:8px 0 16px">${esc(title)}</h1>${body}${button}<p style="color:#54657A">Questions? Just reply to this email.</p></td></tr><tr><td style="background:#F4F6F9;padding:20px 28px;font-size:12px;color:#54657A"><strong>Fortune Jobs AI</strong> is operated by YOU DO LMS INC.${address ? `<br>${esc(address)}` : ''}<br><a href="mailto:info@fortunejobsai.com">info@fortunejobsai.com</a> · <a href="${SITE}/privacy.html">Privacy</a> · <a href="${SITE}/terms.html">Terms</a><p style="margin:10px 0 0">This is an account email about your Fortune Jobs AI account. It is not a newsletter.</p></td></tr></table></td></tr></table></body></html>`;
}
const p = (t) => `<p>${t}</p>`;
const list = (items) => `<ul style="padding-left:20px">${items.map((i) => `<li style="margin:4px 0">${i}</li>`).join('')}</ul>`;

/**
 * @param {string} kind
 * @param {{ name?: string, data?: Record<string, any>, address?: string }} [opts]
 * @returns {{subject:string, html:string, text:string}}
 */
export function render(kind, { name, data = {}, address = '' } = {}) {
  const hi = `Hi ${first(name)},`;
  switch (kind) {
    case 'welcome': return {
      subject: 'Welcome to Fortune Jobs AI',
      html: layout({ address, kicker: 'WELCOME', title: 'Your account is ready.', cta: { href: `${SITE}/profile.html#resume`, label: 'Add your résumé' }, body: p(hi) + p('Thanks for joining Fortune Jobs AI. Three things to do first:') + list(['<strong>Add your résumé</strong> so we can show how well each job fits you.', '<strong>Try Fortune AI Coach</strong> on any job: why it fits, a tailored résumé and interview prep.', '<strong>Turn on job alerts</strong> to get new matching jobs by email, daily or weekly.']) }),
      text: `${hi}\n\nThanks for joining Fortune Jobs AI.\n1. Add your résumé: ${SITE}/profile.html#resume\n2. Try Fortune AI Coach on any job.\n3. Turn on job alerts: ${SITE}/email-preferences.html\n\nQuestions? Reply to this email.\nFortune Jobs AI is operated by YOU DO LMS INC.${address ? '\n' + address : ''}`,
    };
    case 'pro_started': return {
      subject: "You're on Fortune Jobs AI Pro",
      html: layout({ address, kicker: 'PRO IS ON', title: 'Welcome to Pro.', cta: { href: `${SITE}/find-jobs.html`, label: 'Search with Pro' }, body: p(hi) + p('Your Pro subscription is active. You now get:') + list(['Up to <strong>50 results</strong> per search', '<strong>50 Fortune AI Coach actions</strong> a day']) + p(`<strong>$9.99 a month</strong>, renewing ${day(data.renews) ? `on <strong>${esc(day(data.renews))}</strong>` : 'monthly'} until you cancel. You can cancel any time in your profile under <a href="${SITE}/profile.html#subscription">Subscription</a>; Pro stays on until the end of the month you paid for. Your payment receipt comes separately from Stripe.`) }),
      text: `${hi}\n\nYour Pro subscription is active: up to 50 results per search and 50 Fortune AI Coach actions a day.\n$9.99 a month${day(data.renews) ? `, renewing on ${day(data.renews)}` : ''}, until you cancel. Cancel any time: ${SITE}/profile.html#subscription\n\nFortune Jobs AI is operated by YOU DO LMS INC.${address ? '\n' + address : ''}`,
    };
    case 'pro_payment_failed': return {
      subject: 'Action needed: your Pro payment didn’t go through',
      html: layout({ address, kicker: 'PAYMENT PROBLEM', title: 'We couldn’t take your Pro payment.', cta: { href: `${SITE}/profile.html#subscription`, label: 'Update your card' }, body: p(hi) + p('Your latest $9.99 payment for Fortune Jobs AI Pro didn’t go through. This often happens when a card expires or a bank declines the charge.') + p('Update your card from your profile under Subscription to keep Pro. Stripe will retry the payment automatically.') }),
      text: `${hi}\n\nYour latest $9.99 payment for Fortune Jobs AI Pro didn't go through. Update your card to keep Pro: ${SITE}/profile.html#subscription\n\nFortune Jobs AI is operated by YOU DO LMS INC.${address ? '\n' + address : ''}`,
    };
    case 'pro_cancelled': {
      const ends = day(data.ends);
      return {
        subject: ends ? `Your Pro subscription ends on ${ends}` : 'Your Pro subscription has ended',
        html: layout({ address, kicker: 'PRO CANCELLED', title: ends ? `Pro stays on until ${ends}.` : 'Your Pro subscription has ended.', cta: { href: `${SITE}/profile.html#subscription`, label: ends ? 'Changed your mind? Keep Pro' : 'Get Pro again' }, body: p(hi) + p(ends ? `We’ve cancelled your Pro subscription as you asked. You won’t be charged again, and you keep Pro until <strong>${esc(ends)}</strong>. After that your account moves to the free plan (10 results per search, 25 AI Coach actions a day).` : 'Your Pro subscription has ended and you won’t be charged again. Your account is on the free plan (10 results per search, 25 AI Coach actions a day).') + p('Your saved jobs, résumé and alerts stay as they are.') }),
        text: `${hi}\n\n${ends ? `Your Pro subscription is cancelled. You keep Pro until ${ends} and won't be charged again.` : "Your Pro subscription has ended and you won't be charged again."} Your saved jobs, résumé and alerts stay as they are.\nManage: ${SITE}/profile.html#subscription\n\nFortune Jobs AI is operated by YOU DO LMS INC.${address ? '\n' + address : ''}`,
      };
    }
    case 'account_deleted': return {
      subject: 'Your Fortune Jobs AI account has been deleted',
      html: layout({ address, kicker: 'ACCOUNT DELETED', title: 'Your account has been deleted.', body: p(hi) + p(`As you asked, we’re deleting your Fortune Jobs AI account: your profile, résumé, saved jobs, search history and email preferences.${data.hadPro ? ' Your Pro subscription has been cancelled, so you won’t be charged again.' : ''}`) + p('This is the last email we’ll send to this address. If you didn’t ask for this, reply right away.') + p(`You’re welcome back any time at <a href="${SITE}">fortunejobsai.com</a>.`) }),
      text: `${hi}\n\nAs you asked, we're deleting your Fortune Jobs AI account and its data.${data.hadPro ? " Your Pro subscription has been cancelled, so you won't be charged again." : ''}\nThis is the last email we'll send to this address. If you didn't ask for this, reply right away.\n\nFortune Jobs AI is operated by YOU DO LMS INC.${address ? '\n' + address : ''}`,
    };
    // Reviewer emails (to reviews@): something to check on the Review queue.
    case 'review_company': return {
      subject: `New company to check: ${String(data.company || 'a company').slice(0, 80)}`,
      html: layout({ address, kicker: 'REVIEW', title: 'A new company joined.', cta: { href: `${SITE}/employers.html#review`, label: 'Review now' }, body: p('Hi there,') + p('A company registered as an employer:') + list([`<strong>${esc(data.company)}</strong> · ${esc(data.domain)}`, `Registered by ${esc(data.registrant)}`]) + p(data.auto_verified ? 'It was verified automatically by its work email and can post up to 3 live jobs this week. Check that the company and website look real, then confirm it, or suspend it to take its jobs down.' : 'It is waiting for a reviewer.') }),
      text: `Hi there,\n\nA company registered: ${data.company} (${data.domain}), by ${data.registrant}.\n${data.auto_verified ? 'Verified automatically by work email; up to 3 live jobs this week until confirmed.' : 'Waiting for a reviewer.'}\nReview: ${SITE}/employers.html#review`,
    };
    case 'review_post': return {
      subject: `Job post to review: ${String(data.title || 'a job').slice(0, 80)} (${String(data.company || '').slice(0, 60)})`,
      html: layout({ address, kicker: 'REVIEW', title: data.edit ? 'An edit to a live job needs a check.' : 'A job post needs a check.', cta: { href: `${SITE}/employers.html#review`, label: 'Review now' }, body: p('Hi there,') + p('This post did not pass the automatic checks, so it is waiting for a person:') + list([`<strong>${esc(data.title)}</strong>`, `${esc(data.company)} · ${esc(data.domain)}`, `Apply link: ${esc(data.apply_url)}`]) + p('Common reasons: the Apply link is not on the company’s own website, wording that suggests fees or off-site chat, dates out of range, or more than 3 posts in a day.') }),
      text: `Hi there,\n\nJob post to review: ${data.title} (${data.company}, ${data.domain}).\nApply link: ${data.apply_url}\nReview: ${SITE}/employers.html#review`,
    };
    // Employer emails: the reviewer's decision.
    case 'post_approved': return {
      subject: `Approved: ${String(data.title || 'your job post').slice(0, 80)}`,
      html: layout({ address, kicker: 'JOB POST', title: data.live ? 'Your job is live.' : 'Your job post is approved.', cta: { href: `${SITE}/employers.html`, label: 'Open your workspace' }, body: p(hi) + p(`<strong>${esc(data.title)}</strong> for ${esc(data.company)} was approved by our team.`) + p(data.live ? 'It now appears in Fortune Jobs AI search.' : 'Open your workspace and click “Make live” when you have a free slot.') }),
      text: `${hi}\n\n${data.title} for ${data.company} was approved. ${data.live ? 'It is now live in search.' : 'Click "Make live" in your workspace when you have a free slot.'}\n${SITE}/employers.html`,
    };
    case 'post_rejected': return {
      subject: `Changes needed: ${String(data.title || 'your job post').slice(0, 80)}`,
      html: layout({ address, kicker: 'JOB POST', title: 'Your job post needs changes.', cta: { href: `${SITE}/employers.html`, label: 'Edit the post' }, body: p(hi) + p(`Our team could not approve <strong>${esc(data.title)}</strong> for ${esc(data.company)}${data.live ? '; the version already live stays up' : ''}.`) + (data.note ? p(`Reason: <em>${esc(data.note)}</em>`) : '') + p('Edit the post in your workspace and submit it again.') }),
      text: `${hi}\n\nWe could not approve ${data.title} for ${data.company}.${data.note ? ' Reason: ' + data.note : ''}\nEdit and resubmit: ${SITE}/employers.html`,
    };
    case 'company_suspended': return {
      subject: `${String(data.company || 'Your company')} is ${data.status === 'rejected' ? 'not approved' : 'suspended'} on Fortune Jobs AI`,
      html: layout({ address, kicker: 'EMPLOYER ACCOUNT', title: data.status === 'rejected' ? 'Your company was not approved.' : 'Your company is suspended.', body: p(hi) + p(`<strong>${esc(data.company)}</strong> can no longer publish jobs on Fortune Jobs AI, and its live jobs have been taken down.`) + (data.note ? p(`Reason: <em>${esc(data.note)}</em>`) : '') + p('If you think this is a mistake, reply to this email with details about your company.') }),
      text: `${hi}\n\n${data.company} can no longer publish jobs on Fortune Jobs AI and its live jobs were taken down.${data.note ? ' Reason: ' + data.note : ''}\nReply to this email if you think this is a mistake.`,
    };
    default: throw new Error('unknown email');
  }
}
export const KINDS = ['welcome', 'pro_started', 'pro_payment_failed', 'pro_cancelled', 'account_deleted', 'review_company', 'review_post', 'post_approved', 'post_rejected', 'company_suspended'];
