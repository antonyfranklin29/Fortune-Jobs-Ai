// Employer submission page. Every action is a database function that checks the
// caller itself (migrations/pending/20261016_employer_submissions.sql); this page
// only displays state and sends requests. Nothing here can approve, verify,
// publish unreviewed content or unlock a paid plan, and the page never reads
// plan or payment state from the URL.
(function () {
  'use strict';
  const FJ = window.FJ;
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const WORDING_VERSION = 'employer-feed-permission-v1';
  const FREE_LIMIT_FALLBACK = 15;

  const MESSAGES = {
    sign_in_required: 'Please sign in first.',
    email_not_confirmed: 'Please confirm your email address, then reload this page.',
    account_banned: 'Employer access is unavailable for this account. Contact info@fortunejobsai.com for help.',
    account_unavailable: 'This account is no longer available. Please sign out.',
    domain_already_registered: 'That domain is already registered. If it belongs to your company, contact info@fortunejobsai.com.',
    company_email_required: 'Sign in with your work email address, such as name@yourcompany.com, to register a company. Personal email addresses cannot register one.',
    email_domain_mismatch: 'Your work email address must be at the company domain you enter, or at a subdomain of it. Check the domain, or sign in with an address at that company.',
    free_email_domain_not_allowed: 'Personal email providers cannot be used as a company domain. Enter your company\'s own domain.',
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
    apply_url_already_listed: 'This application link is already listed on Fortune Jobs AI. Our team will check it.',
    org_not_verified: 'Approved. It will go live once your organization is verified.',
    expired: 'The closing date has passed. Edit the dates and resubmit.',
    temporarily_unavailable: 'The verification service is temporarily unavailable. Try again shortly.',
    candidate_list_changed: 'Your career feed changed while you were choosing jobs. Open Choose postings again and review the latest list.',
    source_not_publishable: 'This feed is awaiting approval or its permission has expired. Contact info@fortunejobsai.com for help.',
  };
  function say(text, kind) {
    statusEl.textContent = text;
    statusEl.className = 'msg show ' + (kind || 'info');
  }
  function errorText(err) {
    const raw = String((err && (err.message || err.error_description || err.error)) || err || '');
    const key = Object.keys(MESSAGES).find((k) => raw.includes(k));
    if (key) return MESSAGES[key];
    if (/check constraint|violates/i.test(raw)) return 'Some details are not valid. Check the dates (closing within 90 days of posting), the https application link and the required fields.';
    return 'Something went wrong. Please try again.';
  }

  // DOM builder: text is always set as text, never parsed as HTML.
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }

  async function rpc(fn, args) {
    const { data, error } = await FJ.sb.rpc(fn, args || {});
    if (error) throw error;
    return data;
  }

  let roles = [], regions = [];
  async function loadTaxonomy() {
    const [r, g] = await Promise.all([fetch('config/job-roles.json').then((x) => x.json()), fetch('config/us-regions.json').then((x) => x.json())]);
    roles = r.roles.map((x) => ({ id: x.id, name: x.name }));
    regions = g.regions.map((x) => ({ code: x.code, name: x.name }));
  }

  const POST_STATUS = {
    draft: ['Draft', ''], pending_review: ['In review', 'warn'], approved: ['Approved', 'ok'], rejected: ['Not approved', 'bad'],
    published: ['Live', 'ok'], paused: ['Paused', 'warn'], closed: ['Closed', ''],
  };
  const ORG_STATUS = { pending: ['Pending review', 'warn'], verified: ['Verified', 'ok'], rejected: ['Not approved', 'bad'], suspended: ['Suspended', 'bad'] };
  const chip = ([label, cls]) => h('span', { class: 'status ' + cls, text: label });

  // ── page ───────────────────────────────────────────────────────────────────
  let renderVersion = 0;
  async function render() {
    const version = ++renderVersion;
    // Clear private content immediately on account changes and failed reloads.
    $('orgs').replaceChildren(); $('queue').replaceChildren();
    for (const id of ['signed-out', 'register', 'operator', 'workspace-summary', 'employer-signout', 'add-company']) $(id).hidden = true;
    $('workspace-account').textContent = '';
    const user = await FJ.user();
    if (version !== renderVersion) return;
    if (!user) {
      $('signin').href = FJ.loginUrl('employers.html');
      $('signed-out').hidden = false;
      say('Sign in to post jobs.', 'info');
      return;
    }
    $('employer-signout').hidden = false;
    $('workspace-account').textContent = 'Signed in as ' + (user.email || 'your account');
    let state;
    try { state = await rpc('employer_my_state'); }
    catch (e) {
      if (version !== renderVersion) return;
      say(/PGRST202|could not find.*function|does not exist/i.test(String(e.code || '') + ' ' + String(e.message || ''))
        ? 'Employer setup is being prepared. Please try again shortly or contact info@fortunejobsai.com. Your job seeker account is still available.' : errorText(e), 'error'); return;
    }
    if (version !== renderVersion) return;
    if (!state || !Array.isArray(state.orgs) || !state.plan) { say('Company details could not be loaded. Please reload.', 'error'); return; }
    statusEl.className = 'msg';
    $('register').hidden = state.orgs.length > 0;
    const host = $('orgs');
    host.replaceChildren(...state.orgs.map((o) => orgCard(o, state.plan)));
    $('summary-companies').textContent = String(state.orgs.length);
    $('summary-active').textContent = String(state.orgs.reduce((n, o) => n + (Number(o.active_posts) || 0), 0));
    $('summary-review').textContent = String(state.orgs.reduce((n, o) => n + o.posts.filter(p => p.status === 'pending_review').length, 0));
    $('workspace-summary').hidden = state.orgs.length === 0;
    $('add-company').hidden = state.orgs.length === 0 || state.orgs.length >= 3;
    renderOperator(version);
  }

  function orgCard(o, plan) {
    const limit = Number(o.active_limit) || FREE_LIMIT_FALLBACK;
    const used = Number(o.active_posts) || 0;
    const card = h('section', { class: 'card' },
      h('h2', {}, o.name, ' ', chip(ORG_STATUS[o.status] || [o.status, ''])),
      h('p', { class: 'sub', text: o.primary_domain }));

    if (o.status === 'pending') {
      card.append(h('p', { class: 'msg info show', text: 'Your company is awaiting review. You can prepare job drafts now; nothing goes public until the company is verified and the posting passes its checks. No DNS changes are needed.' }));
    }

    // Plan and quota — read from the server only.
    card.append(h('div', { style: 'margin-top:20px' },
      h('h3', { text: 'Active posts' }),
      h('div', { class: 'meter', role: 'img', 'aria-label': `${used} of ${limit} active posts used` },
        h('span', { style: `width:${Math.min(100, Math.round((used / Math.max(1, limit)) * 100))}%` })),
      h('p', { class: 'sub', text: `${used} of ${limit} active posts. Closing or expiring a post frees a slot; drafts and posts in review don't count.` }),
      h('div', { class: 'plans' },
        h('div', { class: 'plan' },
          h('strong', { text: 'Free' }), h('div', { class: 'price', text: '$0' }),
          h('p', { class: 'note', text: `Up to ${plan.free_active_posts} active posts at a time, across your whole organization.` })),
        h('div', { class: 'plan' },
          h('strong', { text: 'Employer Plus' }),
          h('div', { class: 'price', text: `$${(plan.monthly_price_cents / 100).toFixed(2)}/month` }),
          h('p', { class: 'note', text: 'Post more than 15 active jobs. Verification and review still apply.' }),
          h('span', { class: 'unavailable', text: 'Not available yet' })))));

    // Posts
    const list = h('div', {});
    for (const p of o.posts) list.append(postRow(o, p));
    const formHost = h('div', {});
    card.append(h('div', { style: 'margin-top:24px' },
      h('h3', { text: 'Job posts' }),
      o.posts.length ? list : h('p', { class: 'sub', text: 'No posts yet.' }),
      h('button', { class: 'btn btn-primary', type: 'button', style: 'margin-top:12px', disabled: o.status === 'rejected' || o.status === 'suspended',
        on: { click: () => formHost.replaceChildren(postForm(o, null)) } }, 'New job post'),
      formHost));

    // Career feeds
    const srcHost = h('div', {});
    card.append(h('div', { style: 'margin-top:24px' },
      h('h3', { text: 'Career feed (Greenhouse or Lever)' }),
      ...o.sources.map((s) => h('p', {}, chip(s.status === 'approved' ? ['Approved', 'ok'] : s.status === 'pending' ? ['In review', 'warn'] : [s.status, 'bad']),
        ' ', `${s.adapter} · ${s.board_token}`, s.status === 'approved' ? ` · ${s.selected} of ${s.candidates} postings chosen` : '',
        s.status === 'approved' && s.candidates ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', on: { click: () => chooseCandidates(s, srcHost) } }, 'Choose postings') : null)),
      h('button', { class: 'btn btn-outline', type: 'button', on: { click: () => srcHost.replaceChildren(sourceForm(o)) } }, 'Connect a career feed'),
      srcHost));
    return card;
  }

  function postRow(o, p) {
    const st = POST_STATUS[p.status] || [p.status, ''];
    const notes = [];
    if (p.publish_state) notes.push(MESSAGES[p.publish_state] || p.publish_state);
    if (p.has_unreviewed_changes) notes.push('Edits are waiting for review; the live version is unchanged.');
    if (p.status === 'rejected' && p.review_note) notes.push('Reviewer note: ' + p.review_note);
    const actions = [];
    const act = (label, fn, cls) => actions.push(h('button', { class: 'btn btn-sm ' + (cls || 'btn-outline'), type: 'button', on: { click: fn } }, label));
    if (['draft', 'rejected', 'approved', 'published', 'paused', 'pending_review'].includes(p.status)) act('Edit', () => row.after(postForm(o, p)), 'btn-ghost');
    if (p.status === 'draft') act('Submit job', () => run(() => rpc('employer_submit_post', { p_post: p.id }),
      (result) => result && result.published ? 'Your job is live.' : result && result.review === 'automatic'
        ? 'Automatic checks passed, but this job could not go live. Check its status below.'
        : 'Submitted. This job needs a team review before it appears in search.'));
    if (p.status === 'closed' && p.can_activate !== true) notes.push('Reopening is unavailable. Contact info@fortunejobsai.com for help.');
    if (p.can_activate === true)
      act('Make live', () => run(async () => {
        const r = await rpc('employer_activate_post', { p_post: p.id });
        if (!r.published) throw new Error(r.state);
      }, 'Your post is live.'));
    if (['published', 'paused', 'approved'].includes(p.status)) act('Close', () => run(() => rpc('employer_close_post', { p_post: p.id }), 'Post closed. Its slot is free.'), 'btn-danger');
    const row = h('div', { class: 'post' },
      h('div', {},
        h('div', {}, h('strong', { text: p.job_title }), ' ', chip(st)),
        h('div', { class: 'meta', text: `${p.city}, ${p.state_code} · ${p.employment_type} · ${p.work_mode} · closes ${p.closing_date}` }),
        ...notes.map((n) => h('div', { class: 'meta', text: n }))),
      h('div', { class: 'actions' }, actions));
    return row;
  }

  function field(label, input, hint) {
    const id = 'f' + Math.random().toString(36).slice(2);
    input.id = id;
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hint ? h('span', { class: 'hint', text: hint }) : null);
  }
  const select = (opts, value) => h('select', { class: 'input' }, opts.map(([v, t]) => h('option', { value: v, selected: v === value, text: t })));
  const today = () => new Date().toISOString().slice(0, 10);
  const plusDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

  function postForm(o, p) {
    const v = p || {};
    const f = {
      job_title: h('input', { class: 'input', maxlength: 200, required: true, value: v.job_title || '' }),
      canonical_role: select(roles.map((r) => [r.id, r.name]), v.canonical_role),
      state_code: select(regions.map((r) => [r.code, r.name]), v.state_code),
      city: h('input', { class: 'input', maxlength: 100, required: true, value: v.city || '' }),
      work_mode: select([['onsite', 'On-site'], ['hybrid', 'Hybrid'], ['remote', 'Remote']], v.work_mode),
      employment_type: select(['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'].map((x) => [x, x]), v.employment_type),
      description: h('textarea', { class: 'input', maxlength: 8000, required: true }),
      apply_url: h('input', { class: 'input', type: 'url', maxlength: 2000, required: true, placeholder: 'https://', value: v.apply_url || '' }),
      posting_date: h('input', { class: 'input', type: 'date', required: true, value: v.posting_date || today() }),
      closing_date: h('input', { class: 'input', type: 'date', required: true, value: v.closing_date || plusDays(today(), 30) }),
    };
    f.description.value = v.description || '';
    const msg = h('p', { class: 'msg', role: 'status' });
    const form = h('form', { class: 'card stack', novalidate: true, style: 'margin-top:14px' },
      h('h3', { text: p ? 'Edit post' : 'New job post' }),
      p && p.status === 'published' ? h('p', { class: 'msg info show', text: 'Your live post stays as it is until our team reviews these changes.' }) : null,
      field('Job title', f.job_title),
      h('div', { class: 'grid2' }, field('Role', f.canonical_role), field('Employment type', f.employment_type)),
      h('div', { class: 'grid2' }, field('City', f.city), field('State', f.state_code), field('Work mode', f.work_mode)),
      field('Description', f.description, 'Plain text, at least 50 characters. Do not ask candidates to pay or to send sensitive personal data.'),
      field('Application link', f.apply_url, 'An https page where candidates apply. We review every link before it goes live.'),
      h('div', { class: 'grid2' }, field('Posting date', f.posting_date), field('Closing date', f.closing_date, 'Up to 90 days after posting.')),
      h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save draft'), ' ',
        h('button', { class: 'btn btn-ghost', type: 'button', on: { click: () => form.remove() } }, 'Cancel')),
      msg);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // Content fields only. Status, plan and approval are never sent.
      const fields = {};
      for (const [k, el] of Object.entries(f)) fields[k] = el.value.trim();
      if (!/^https:\/\//i.test(fields.apply_url)) { msg.textContent = 'The application link must start with https://'; msg.className = 'msg error show'; return; }
      try {
        await rpc('employer_save_post', { p_org: o.id, p_post: p ? p.id : null, p_fields: fields });
        say('Saved. Submit it for review when you are ready.', 'ok');
        await render();
      } catch (err) { msg.textContent = errorText(err); msg.className = 'msg error show'; }
    });
    return form;
  }

  function sourceForm(o) {
    const adapter = select([['greenhouse', 'Greenhouse'], ['lever', 'Lever']]);
    const region = select([['global', 'Global (US)'], ['eu', 'EU (Lever only)']]);
    const token = h('input', { class: 'input', maxlength: 100, required: true, placeholder: 'yourcompany', autocapitalize: 'off', spellcheck: 'false' });
    const hosts = h('input', { class: 'input', placeholder: 'boards.greenhouse.io, careers.yourcompany.com', autocapitalize: 'off', spellcheck: 'false' });
    const display = h('input', { type: 'checkbox' }), refresh = h('input', { type: 'checkbox' }), desc = h('input', { type: 'checkbox' });
    const msg = h('p', { class: 'msg', role: 'status' });
    const form = h('form', { class: 'card stack', novalidate: true, style: 'margin-top:14px' },
      h('h3', { text: 'Connect a career feed' }),
      h('p', { class: 'sub', text: 'We read only the public job board you name, and only after our team approves it. You choose which postings appear, and they count toward your active-post limit.' }),
      h('div', { class: 'grid2' }, field('Provider', adapter), field('Region', region)),
      field('Board name', token, 'The name in your board link, e.g. "acme" in boards.greenhouse.io/acme.'),
      field('Where candidates apply', hosts, 'Up to 8 domains, comma-separated. Our team confirms these.'),
      h('fieldset', {}, h('legend', { text: 'Permission' }),
        h('label', { class: 'check' }, display, h('span', { text: 'I am authorized by this organization to let Fortune Jobs AI display its job postings from this board.' })),
        h('label', { class: 'check' }, refresh, h('span', { text: 'Fortune Jobs AI may check this board regularly to keep the postings current and remove closed ones.' })),
        h('label', { class: 'check' }, desc, h('span', { text: 'Optional: Fortune Jobs AI may also show the job descriptions.' }))),
      h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Submit for review'), ' ',
        h('button', { class: 'btn btn-ghost', type: 'button', on: { click: () => form.remove() } }, 'Cancel')),
      msg);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await rpc('employer_submit_source', {
          p_org: o.id, p_adapter: adapter.value, p_region: region.value, p_board_token: token.value.trim().toLowerCase(),
          p_requested_hosts: hosts.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
          p_grants: { display: display.checked, refresh: refresh.checked, description: desc.checked },
          p_wording_version: WORDING_VERSION,
        });
        say('Career feed submitted for review.', 'ok');
        await render();
      } catch (err) { msg.textContent = errorText(err); msg.className = 'msg error show'; }
    });
    return form;
  }

  async function chooseCandidates(s, hostEl) {
    let items;
    try { items = await rpc('employer_list_feed_candidates', { p_source: s.id }); } catch (e) { say(errorText(e), 'error'); return; }
    const boxes = items.map((c) => {
      const box = h('input', { type: 'checkbox', checked: c.selected });
      box.dataset.id = c.provider_post_id;
      return h('label', { class: 'check' }, box, h('span', { text: `${c.job_title || 'Untitled'} · ${c.location || c.state_code || 'location unknown'}` }));
    });
    const form = h('form', { class: 'card stack', style: 'margin-top:14px' },
      h('h3', { text: 'Choose postings to show' }),
      h('p', { class: 'sub', text: 'Each chosen posting that goes live uses one of your active-post slots. Choices are applied during the next enabled feed refresh; saving does not publish immediately.' }),
      boxes,
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save choices'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const all = boxes.map((b) => b.querySelector('input'));
      run(async () => {
        await rpc('employer_replace_feed_selection', { p_source: s.id, p_ids: all.filter((b) => b.checked).map((b) => b.dataset.id) });
      }, 'Choices saved for the next enabled feed refresh.');
    });
    hostEl.replaceChildren(form);
  }

  let actionBusy = false;
  async function run(fn, okText) {
    if (actionBusy) return;
    actionBusy = true;
    try { const result = await fn(); await render(); say(typeof okText === 'function' ? okText(result) : okText, 'ok'); }
    catch (e) { await render(); say(errorText(e), 'error'); }
    finally { actionBusy = false; }
  }

  // ── reviewer panel (shown only if the server says the caller is a reviewer) ─
  async function renderOperator(version) {
    let q;
    try { q = await rpc('operator_queue'); } catch { if (version === renderVersion) $('operator').hidden = true; return; }
    if (version !== renderVersion) return;
    $('operator').hidden = false;
    const box = $('queue');
    const items = [];
    for (const o of q.orgs) items.push(h('div', { class: 'post' },
      h('div', {}, h('strong', { text: o.name }), ' ', h('span', { class: 'meta', text: `${o.domain} · ${o.domain_verified ? 'proof recorded' : 'proof needed'}` })),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-sm btn-primary', type: 'button',
          on: { click: () => { const note = prompt('Record independent evidence that this account is authorized to represent the company (for example, a confirmed company contact or documented company record). A matching email address alone is not enough:'); if (note && note.trim()) run(async () => {
            if (!o.domain_verified) await rpc('operator_verify_domain', { p_org: o.id, p_note: note.trim() });
            await rpc('operator_set_org_status', { p_org: o.id, p_status: 'verified', p_note: note.trim() });
          }, 'Organization verified.'); } } }, 'Verify'),
        h('button', { class: 'btn btn-sm btn-danger', type: 'button',
          on: { click: () => { const n = prompt('Reason for rejecting this organization?'); if (n) run(() => rpc('operator_set_org_status', { p_org: o.id, p_status: 'rejected', p_note: n }), 'Organization rejected.'); } } }, 'Reject'))));
    for (const p of q.posts) items.push(h('div', { class: 'post' },
      h('div', {}, h('strong', { text: p.job_title }), ' ', h('span', { class: 'meta', text: `${p.org} · revision ${p.revision}${p.changes ? ' · edit to a live post' : ''}` }),
        h('div', { class: 'meta' }, 'Apply link: ', h('a', { href: p.apply_url, rel: 'noopener noreferrer nofollow', target: '_blank', text: p.apply_url }))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-sm btn-primary', type: 'button',
          on: { click: () => run(async () => { const r = await rpc('operator_review_post', { p_post: p.id, p_revision: p.revision, p_decision: 'approve', p_note: null }); if (r && r.published === false) throw new Error(r.state); }, 'Approved and published.') } }, 'Approve'),
        h('button', { class: 'btn btn-sm btn-danger', type: 'button',
          on: { click: () => { const n = prompt('Reason for the employer?'); if (n) run(() => rpc('operator_review_post', { p_post: p.id, p_revision: p.revision, p_decision: 'reject', p_note: n }), 'Rejected.'); } } }, 'Reject'))));
    for (const s of q.sources) items.push(h('div', { class: 'post' },
      h('div', {}, h('strong', { text: `${s.org} · ${s.adapter}/${s.board_token}` }),
        h('div', { class: 'meta', text: `Requested hosts: ${(s.requested_apply_hosts || []).join(', ') || 'none'}. Approve in SQL with the written-permission reference (operator_review_source).` }))));
    box.replaceChildren(...(items.length ? items : [h('p', { class: 'sub', text: 'Nothing waiting.' })]));
  }

  // ── start ──────────────────────────────────────────────────────────────────
  $('add-company').addEventListener('click', () => { $('register').hidden = !$('register').hidden; if (!$('register').hidden) $('org-name').focus(); });
  $('employer-signout').addEventListener('click', async () => {
    $('employer-signout').disabled = true;
    try { const {error} = await FJ.sb.auth.signOut(); if (error) throw error; location.href = 'employer-login.html'; }
    catch (error) { say('Could not sign out. Please try again.', 'error'); $('employer-signout').disabled = false; }
  });
  $('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('org-name').value.trim();
    const domain = $('org-domain').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (!name || !domain) { say('Enter your company name and website domain.', 'error'); return; }
    await run(() => rpc('employer_register_org', { p_name: name, p_domain: domain }), 'Registered. Your company is awaiting review; you can prepare job drafts now.');
  });

  if (!FJ) { say('Accounts are unavailable right now. Please try again later.', 'error'); return; }
  loadTaxonomy().then(render).catch(() => say('Could not load the page. Please reload.', 'error'));
  FJ.sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') render(); });
})();
