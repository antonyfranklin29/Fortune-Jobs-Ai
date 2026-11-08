// Employer workspace (employers.html). Every action is a database function that
// checks the caller itself (migrations/pending/20261016_employer_submissions.sql);
// this page only displays state and sends requests. Nothing here can approve,
// verify, publish unreviewed content or unlock a paid plan, and the page never
// reads plan or payment state from the URL. The reviewer panel appears only when
// the server answers operator_queue for this account.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AiPostWriter } from './EmployerAi.jsx';
import { useAccountServices } from '../account/services.jsx';
import { useDocumentTitle } from '../account/components.jsx';
import {
  FREE_LIMIT_FALLBACK, ORG_STATUS, POST_STATUS, WORDING_VERSION,
  errorText, normalizeDomain, plusDays, postNotes, setupErrorText, submitResultText, today,
} from './messages.js';
import '../account/account-base.css';
import './employer-workspace.css';

const Chip = ({ status: [label, cls] }) => <span className={'status ' + cls}>{label}</span>;

function Field({ label, hint, children, id }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

let fieldSeq = 0;
const useFieldId = () => useRef('f' + (++fieldSeq).toString(36) + Math.random().toString(36).slice(2, 6)).current;

function Select({ id, value, onChange, options }) {
  return (
    <select className="input" id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  );
}

export function EmployerWorkspacePage({ prompt: askPrompt }) {
  const fj = useAccountServices();
  useDocumentTitle('Employer workspace · Fortune Jobs AI');
  const ask = askPrompt || ((text) => (typeof window === 'object' ? window.prompt(text) : null));

  const [status, setStatus] = useState({ text: 'Loading…', kind: 'info' });
  const [view, setView] = useState({ phase: 'loading', user: null, state: null, queue: null });
  const [registerOpen, setRegisterOpen] = useState(false);
  const [taxonomy, setTaxonomy] = useState({ roles: [], regions: [] });
  const [signingOut, setSigningOut] = useState(false);
  const version = useRef(0);
  const actionBusy = useRef(false);

  const say = useCallback((text, kind = 'info') => setStatus({ text, kind }), []);

  const render = useCallback(async () => {
    const v = ++version.current;
    // Clear private content immediately on account changes and failed reloads.
    setView({ phase: 'loading', user: null, state: null, queue: null });
    const user = await fj.user();
    if (v !== version.current) return;
    if (!user) { setView({ phase: 'signed-out', user: null, state: null, queue: null }); say('Sign in to post jobs.', 'info'); return; }
    setView({ phase: 'loading', user, state: null, queue: null });
    let state;
    try {
      const { data, error } = await fj.sb.rpc('employer_my_state', {});
      if (error) throw error;
      state = data;
    } catch (e) {
      if (v !== version.current) return;
      setView({ phase: 'error', user, state: null, queue: null });
      say(setupErrorText(e), 'error');
      return;
    }
    if (v !== version.current) return;
    if (!state || !Array.isArray(state.orgs) || !state.plan) { setView({ phase: 'error', user, state: null, queue: null }); say('Company details could not be loaded. Please reload.', 'error'); return; }
    setStatus({ text: '', kind: 'info' });
    setRegisterOpen(state.orgs.length === 0);
    setView({ phase: 'ready', user, state, queue: null });
    // Reviewer panel: shown only if the server says the caller is a reviewer.
    try {
      const { data, error } = await fj.sb.rpc('operator_queue', {});
      if (error) throw error;
      if (v === version.current) setView((cur) => (cur.state === state ? { ...cur, queue: data } : cur));
    } catch { /* not a reviewer */ }
  }, [fj, say]);

  const run = useCallback(async (fn, okText) => {
    if (actionBusy.current) return;
    actionBusy.current = true;
    try { const result = await fn(); await render(); say(typeof okText === 'function' ? okText(result) : okText, 'ok'); }
    catch (e) { await render(); say(errorText(e), 'error'); }
    finally { actionBusy.current = false; }
  }, [render, say]);

  const rpc = useCallback(async (name, args) => {
    const { data, error } = await fj.sb.rpc(name, args || {});
    if (error) throw error;
    return data;
  }, [fj]);

  useEffect(() => {
    if (!fj.sb) { say('Accounts are unavailable right now. Please try again later.', 'error'); return undefined; }
    let active = true;
    Promise.all([fj.fetch('config/job-roles.json').then((x) => x.json()), fj.fetch('config/us-regions.json').then((x) => x.json())])
      .then(([r, g]) => {
        if (!active) return;
        setTaxonomy({ roles: r.roles.map((x) => ({ id: x.id, name: x.name })), regions: g.regions.map((x) => ({ code: x.code, name: x.name })) });
        return render();
      })
      .catch(() => { if (active) say('Could not load the page. Please reload.', 'error'); });
    const { data: sub } = fj.sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') render(); });
    return () => { active = false; version.current++; sub?.subscription?.unsubscribe?.(); };
  }, [fj, render, say]);

  async function signOut() {
    setSigningOut(true);
    try { const { error } = await fj.sb.auth.signOut(); if (error) throw error; fj.navigate('employer-login.html'); }
    catch { say('Could not sign out. Please try again.', 'error'); setSigningOut(false); }
  }

  const { phase, user, state, queue } = view;
  const orgs = state ? state.orgs : [];
  return (
    <div className="fja-acct fja-employer">
      <nav className="top-nav">
        <a className="logo-text" href="index.html">Fortune Jobs AI</a>
        <div className="employer-nav-actions">
          <a className="nav-link" href="find-jobs.html">Find jobs</a>
          <a className="nav-link" href="profile.html">Job seeker profile</a>
          {user ? <button className="btn btn-ghost btn-sm" type="button" disabled={signingOut} onClick={signOut}>Sign out</button> : null}
        </div>
      </nav>
      <main>
        <header className="workspace-heading">
          <div>
            <p className="eyebrow">FOR EMPLOYERS</p>
            <h1>Your employer workspace</h1>
            <p className="lead">Manage your company, job posts and career feeds. Verified employers can keep up to 15 active jobs free.</p>
            <p className="workspace-account">{user ? 'Signed in as ' + (user.email || 'your account') : ''}</p>
          </div>
          {phase === 'ready' && orgs.length > 0 && orgs.length < 3
            ? <button className="btn btn-outline" type="button" onClick={() => setRegisterOpen((o) => !o)}>Add a company</button> : null}
        </header>

        <p className={`msg${status.text ? ` show ${status.kind}` : ''}`} role="status" aria-live="polite">{status.text}</p>

        {phase === 'signed-out' && (
          <section className="card">
            <h2>Your company has its own space</h2>
            <p className="sub">Use your work email to manage hiring. We verify your company once; routine posts can then go live after automatic checks. Posts that need extra checks go to our team.</p>
            <p style={{ marginTop: 14 }}><a className="btn btn-primary" href={fj.loginUrl('employers.html')}>Employer sign in</a> <a className="btn btn-outline" href="employer-login.html?mode=signup">Create employer account</a></p>
            <div className="onboarding-steps">
              <div><b>1. Register your company</b>Use your work email and tell us your company website.</div>
              <div><b>2. We verify it once</b>Prepare job drafts while our team checks the company. No DNS changes are needed.</div>
              <div><b>3. Post jobs</b>Routine posts can go live after automatic checks; others receive a team review.</div>
            </div>
          </section>
        )}

        {phase === 'ready' && orgs.length > 0 && (
          <section className="summary-grid" aria-label="Company overview">
            <div className="card"><strong>{String(orgs.length)}</strong>Companies</div>
            <div className="card"><strong>{String(orgs.reduce((n, o) => n + (Number(o.active_posts) || 0), 0))}</strong>Active jobs</div>
            <div className="card"><strong>{String(orgs.reduce((n, o) => n + o.posts.filter((p) => p.status === 'pending_review').length, 0))}</strong>Posts in review</div>
          </section>
        )}

        {phase === 'ready' && registerOpen && <RegisterForm run={run} rpc={rpc} say={say} autoFocus={orgs.length > 0} />}

        {phase === 'ready' && orgs.map((o) => (
          <OrgCard key={o.id} org={o} plan={state.plan} taxonomy={taxonomy} run={run} rpc={rpc} say={say} render={render} />
        ))}

        {phase === 'ready' && queue && <ReviewQueue queue={queue} run={run} rpc={rpc} ask={ask} />}
      </main>
    </div>
  );
}

function RegisterForm({ run, rpc, say, autoFocus }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const nameRef = useRef(null);
  useEffect(() => { if (autoFocus) nameRef.current?.focus(); }, [autoFocus]);
  async function onSubmit(e) {
    e.preventDefault();
    const n = name.trim(), d = normalizeDomain(domain);
    if (!n || !d) { say('Enter your company name and website domain.', 'error'); return; }
    await run(() => rpc('employer_register_org', { p_name: n, p_domain: d }), (r) => r?.status === 'verified' ? 'Registered and verified by your work email. You can publish jobs now.' : 'Registered. Your company is awaiting review; you can prepare job drafts now.');
  }
  return (
    <section className="card">
      <h2>Register your organization</h2>
      <p className="sub">Your company is verified at once by your work email (it must be at the domain you enter). Routine job posts go live after automatic checks; anything unusual waits for our team. New companies can keep up to 3 live jobs in their first week while our team checks them.</p>
      <form className="stack" noValidate onSubmit={onSubmit}>
        <div className="field"><label htmlFor="org-name">Organisation name</label><input ref={nameRef} className="input" id="org-name" maxLength={200} required autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="org-domain">Company website domain</label><input className="input" id="org-domain" maxLength={253} required placeholder="example.com" inputMode="url" autoCapitalize="off" spellCheck="false" value={domain} onChange={(e) => setDomain(e.target.value)} /><span className="hint">Just the domain, like acme.com. Not a URL.</span></div>
        <button className="btn btn-primary" type="submit">Register</button>
      </form>
    </section>
  );
}

function OrgCard({ org: o, plan, taxonomy, run, rpc, say, render }) {
  const limit = Number(o.active_limit) || FREE_LIMIT_FALLBACK;
  const used = Number(o.active_posts) || 0;
  const [newPost, setNewPost] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [chooser, setChooser] = useState(null); // { source, items }

  async function openChooser(s) {
    try { const items = await rpc('employer_list_feed_candidates', { p_source: s.id }); setSourceOpen(false); setChooser({ source: s, items }); }
    catch (e) { say(errorText(e), 'error'); }
  }

  return (
    <section className="card">
      <h2>{o.name} <Chip status={ORG_STATUS[o.status] || [o.status, '']} /></h2>
      <p className="sub">{o.primary_domain}</p>
      {o.status === 'verified' && o.active_limit <= 3 && <p className="msg info show">{`Verified by your work email. During your first week you can keep up to ${o.active_limit} live jobs while our team checks your company; the limit then rises automatically.`}</p>}
      {o.status === 'pending' && <p className="msg info show">Your company is awaiting review. You can prepare job drafts now; nothing goes public until the company is verified and the posting passes its checks. No DNS changes are needed.</p>}

      {/* Plan and quota: read from the server only. */}
      <div style={{ marginTop: 20 }}>
        <h3>Active posts</h3>
        <div className="meter" role="img" aria-label={`${used} of ${limit} active posts used`}><span style={{ width: `${Math.min(100, Math.round((used / Math.max(1, limit)) * 100))}%` }} /></div>
        <p className="sub">{`${used} of ${limit} active posts. Closing or expiring a post frees a slot; drafts and posts in review don't count.`}</p>
        <div className="plans">
          <div className="plan"><strong>Free</strong><div className="price">$0</div><p className="note">{`Up to ${plan.free_active_posts} active posts at a time, across your whole organization.`}</p></div>
          <div className="plan"><strong>Employer Plus</strong><div className="price">{`$${(plan.monthly_price_cents / 100).toFixed(2)}/month`}</div><p className="note">Post more than 15 active jobs. Verification and review still apply.</p><span className="unavailable">Not available yet</span></div>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <h3>Job posts</h3>
        {o.posts.length ? <div>{o.posts.map((p) => <PostRow key={p.id} org={o} post={p} taxonomy={taxonomy} run={run} rpc={rpc} say={say} render={render} />)}</div> : <p className="sub">No posts yet.</p>}
        <button className="btn btn-primary" type="button" style={{ marginTop: 12 }} disabled={o.status === 'rejected' || o.status === 'suspended'} onClick={() => setNewPost(true)}>New job post</button>
        {newPost && <PostForm org={o} post={null} taxonomy={taxonomy} rpc={rpc} say={say} render={render} onCancel={() => setNewPost(false)} />}
      </div>

      <div style={{ marginTop: 24 }}>
        <h3>Career feed (Greenhouse or Lever)</h3>
        {o.sources.map((s) => (
          <p key={s.id}>
            <Chip status={s.status === 'approved' ? ['Approved', 'ok'] : s.status === 'pending' ? ['In review', 'warn'] : [s.status, 'bad']} />
            {' '}{`${s.adapter} · ${s.board_token}`}{s.status === 'approved' ? ` · ${s.selected} of ${s.candidates} postings chosen` : ''}
            {s.status === 'approved' && s.candidates ? <button className="btn btn-sm btn-ghost" type="button" onClick={() => openChooser(s)}>Choose postings</button> : null}
          </p>
        ))}
        <button className="btn btn-outline" type="button" onClick={() => { setChooser(null); setSourceOpen(true); }}>Connect a career feed</button>
        {sourceOpen && <SourceForm org={o} rpc={rpc} say={say} render={render} onCancel={() => setSourceOpen(false)} />}
        {chooser && <CandidatePicker source={chooser.source} items={chooser.items} run={run} rpc={rpc} />}
      </div>
      {/* AI candidate shortlist (EmployerAi.jsx) stays hidden until candidate notice and human review are in place. */}
    </section>
  );
}

function PostRow({ org: o, post: p, taxonomy, run, rpc, say, render }) {
  const [editing, setEditing] = useState(false);
  const notes = postNotes(p);
  const actions = [];
  if (['draft', 'rejected', 'approved', 'published', 'paused', 'pending_review'].includes(p.status)) actions.push(['Edit', () => setEditing(true), 'btn-ghost']);
  if (p.status === 'draft') actions.push(['Submit job', () => run(() => rpc('employer_submit_post', { p_post: p.id }), submitResultText), 'btn-outline']);
  if (p.can_activate === true) actions.push(['Make live', () => run(async () => { const r = await rpc('employer_activate_post', { p_post: p.id }); if (!r.published) throw new Error(r.state); }, 'Your post is live.'), 'btn-outline']);
  if (['published', 'paused', 'approved'].includes(p.status)) actions.push(['Close', () => run(() => rpc('employer_close_post', { p_post: p.id }), 'Post closed. Its slot is free.'), 'btn-danger']);
  return (
    <>
      <div className="post">
        <div>
          <div><strong>{p.job_title}</strong> <Chip status={POST_STATUS[p.status] || [p.status, '']} /></div>
          <div className="meta">{`${p.city}, ${p.state_code} · ${p.employment_type} · ${p.work_mode} · closes ${p.closing_date}`}</div>
          {notes.map((n) => <div className="meta" key={n}>{n}</div>)}
        </div>
        <div className="actions">{actions.map(([label, fn, cls]) => <button key={label} className={'btn btn-sm ' + cls} type="button" onClick={fn}>{label}</button>)}</div>
      </div>
      {editing && <PostForm org={o} post={p} taxonomy={taxonomy} rpc={rpc} say={say} render={render} onCancel={() => setEditing(false)} />}
    </>
  );
}

function PostForm({ org: o, post: p, taxonomy, rpc, say, render, onCancel }) {
  const v = p || {};
  const ids = { title: useFieldId(), role: useFieldId(), type: useFieldId(), city: useFieldId(), state: useFieldId(), mode: useFieldId(), desc: useFieldId(), url: useFieldId(), from: useFieldId(), to: useFieldId() };
  // Like a native <select> with no selected option, an unknown value falls back to the first option.
  const firstOr = (opts, val) => (opts.some(([k]) => k === val) ? val : (opts[0] ? opts[0][0] : ''));
  const roleOpts = taxonomy.roles.map((r) => [r.id, r.name]);
  const regionOpts = taxonomy.regions.map((r) => [r.code, r.name]);
  const modeOpts = [['onsite', 'On-site'], ['hybrid', 'Hybrid'], ['remote', 'Remote']];
  const typeOpts = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'].map((x) => [x, x]);
  const [f, setF] = useState(() => ({
    job_title: v.job_title || '', canonical_role: firstOr(roleOpts, v.canonical_role), state_code: firstOr(regionOpts, v.state_code), city: v.city || '',
    work_mode: firstOr(modeOpts, v.work_mode), employment_type: firstOr(typeOpts, v.employment_type), description: v.description || '',
    apply_url: v.apply_url || '', posting_date: v.posting_date || today(), closing_date: v.closing_date || plusDays(today(), 30),
  }));
  const [msg, setMsg] = useState('');
  const set = (k) => (val) => setF((cur) => ({ ...cur, [k]: typeof val === 'string' ? val : val.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    // Content fields only. Status, plan and approval are never sent.
    const fields = {};
    for (const [k, val] of Object.entries(f)) fields[k] = String(val).trim();
    if (!/^https:\/\//i.test(fields.apply_url)) { setMsg('The application link must start with https://'); return; }
    try {
      await rpc('employer_save_post', { p_org: o.id, p_post: p ? p.id : null, p_fields: fields });
      say('Saved. Submit it for review when you are ready.', 'ok');
      onCancel();
      await render();
    } catch (err) { setMsg(errorText(err)); }
  }

  return (
    <form className="card stack" noValidate style={{ marginTop: 14 }} onSubmit={onSubmit}>
      <h3>{p ? 'Edit post' : 'New job post'}</h3>
      {p && p.status === 'published' ? <p className="msg info show">Your live post stays as it is until our team reviews these changes.</p> : null}
      <Field label="Job title" id={ids.title}><input className="input" id={ids.title} maxLength={200} required value={f.job_title} onChange={set('job_title')} /></Field>
      <div className="grid2">
        <Field label="Role" id={ids.role}><Select id={ids.role} value={f.canonical_role} onChange={set('canonical_role')} options={roleOpts} /></Field>
        <Field label="Employment type" id={ids.type}><Select id={ids.type} value={f.employment_type} onChange={set('employment_type')} options={typeOpts} /></Field>
      </div>
      <div className="grid2">
        <Field label="City" id={ids.city}><input className="input" id={ids.city} maxLength={100} required value={f.city} onChange={set('city')} /></Field>
        <Field label="State" id={ids.state}><Select id={ids.state} value={f.state_code} onChange={set('state_code')} options={regionOpts} /></Field>
        <Field label="Work mode" id={ids.mode}><Select id={ids.mode} value={f.work_mode} onChange={set('work_mode')} options={modeOpts} /></Field>
      </div>
      {o.status === 'verified' && <AiPostWriter title={f.job_title} company={o.name} current={f.description} onUse={(text) => set('description')(text)} />}
      <Field label="Description" id={ids.desc} hint="Plain text, at least 50 characters. Do not ask candidates to pay or to send sensitive personal data."><textarea className="input" id={ids.desc} maxLength={8000} required value={f.description} onChange={set('description')} /></Field>
      <Field label="Application link" id={ids.url} hint="An https page where candidates apply. We review every link before it goes live."><input className="input" id={ids.url} type="url" maxLength={2000} required placeholder="https://" value={f.apply_url} onChange={set('apply_url')} /></Field>
      <div className="grid2">
        <Field label="Posting date" id={ids.from}><input className="input" id={ids.from} type="date" required value={f.posting_date} onChange={set('posting_date')} /></Field>
        <Field label="Closing date" id={ids.to} hint="Up to 90 days after posting."><input className="input" id={ids.to} type="date" required value={f.closing_date} onChange={set('closing_date')} /></Field>
      </div>
      <div><button className="btn btn-primary" type="submit">Save draft</button> <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button></div>
      <p className={`msg${msg ? ' error show' : ''}`} role="status">{msg}</p>
    </form>
  );
}

function SourceForm({ org: o, rpc, say, render, onCancel }) {
  const ids = { adapter: useFieldId(), region: useFieldId(), token: useFieldId(), hosts: useFieldId() };
  const [adapter, setAdapter] = useState('greenhouse');
  const [region, setRegion] = useState('global');
  const [token, setToken] = useState('');
  const [hosts, setHosts] = useState('');
  const [grants, setGrants] = useState({ display: false, refresh: false, description: false });
  const [msg, setMsg] = useState('');
  const toggle = (k) => (e) => setGrants((g) => ({ ...g, [k]: e.target.checked }));
  async function onSubmit(e) {
    e.preventDefault();
    try {
      await rpc('employer_submit_source', {
        p_org: o.id, p_adapter: adapter, p_region: region, p_board_token: token.trim().toLowerCase(),
        p_requested_hosts: hosts.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
        p_grants: { display: grants.display, refresh: grants.refresh, description: grants.description },
        p_wording_version: WORDING_VERSION,
      });
      say('Career feed submitted for review.', 'ok');
      onCancel();
      await render();
    } catch (err) { setMsg(errorText(err)); }
  }
  return (
    <form className="card stack" noValidate style={{ marginTop: 14 }} onSubmit={onSubmit}>
      <h3>Connect a career feed</h3>
      <p className="sub">We read only the public job board you name, and only after our team approves it. You choose which postings appear, and they count toward your active-post limit.</p>
      <div className="grid2">
        <Field label="Provider" id={ids.adapter}><Select id={ids.adapter} value={adapter} onChange={setAdapter} options={[['greenhouse', 'Greenhouse'], ['lever', 'Lever']]} /></Field>
        <Field label="Region" id={ids.region}><Select id={ids.region} value={region} onChange={setRegion} options={[['global', 'Global (US)'], ['eu', 'EU (Lever only)']]} /></Field>
      </div>
      <Field label="Board name" id={ids.token} hint={'The name in your board link, e.g. "acme" in boards.greenhouse.io/acme.'}><input className="input" id={ids.token} maxLength={100} required placeholder="yourcompany" autoCapitalize="off" spellCheck="false" value={token} onChange={(e) => setToken(e.target.value)} /></Field>
      <Field label="Where candidates apply" id={ids.hosts} hint="Up to 8 domains, comma-separated. Our team confirms these."><input className="input" id={ids.hosts} placeholder="boards.greenhouse.io, careers.yourcompany.com" autoCapitalize="off" spellCheck="false" value={hosts} onChange={(e) => setHosts(e.target.value)} /></Field>
      <fieldset>
        <legend>Permission</legend>
        <label className="check"><input type="checkbox" checked={grants.display} onChange={toggle('display')} /><span>I am authorized by this organization to let Fortune Jobs AI display its job postings from this board.</span></label>
        <label className="check"><input type="checkbox" checked={grants.refresh} onChange={toggle('refresh')} /><span>Fortune Jobs AI may check this board regularly to keep the postings current and remove closed ones.</span></label>
        <label className="check"><input type="checkbox" checked={grants.description} onChange={toggle('description')} /><span>Optional: Fortune Jobs AI may also show the job descriptions.</span></label>
      </fieldset>
      <div><button className="btn btn-primary" type="submit">Submit for review</button> <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button></div>
      <p className={`msg${msg ? ' error show' : ''}`} role="status">{msg}</p>
    </form>
  );
}

function CandidatePicker({ source: s, items, run, rpc }) {
  const [chosen, setChosen] = useState(() => new Set(items.filter((c) => c.selected).map((c) => c.provider_post_id)));
  const flip = (id) => setChosen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  function onSubmit(e) {
    e.preventDefault();
    const ids = items.map((c) => c.provider_post_id).filter((id) => chosen.has(id));
    run(async () => { await rpc('employer_replace_feed_selection', { p_source: s.id, p_ids: ids }); }, 'Choices saved for the next enabled feed refresh.');
  }
  return (
    <form className="card stack" style={{ marginTop: 14 }} onSubmit={onSubmit}>
      <h3>Choose postings to show</h3>
      <p className="sub">Each chosen posting that goes live uses one of your active-post slots. Choices are applied during the next enabled feed refresh; saving does not publish immediately.</p>
      {items.map((c) => (
        <label className="check" key={c.provider_post_id}>
          <input type="checkbox" checked={chosen.has(c.provider_post_id)} onChange={() => flip(c.provider_post_id)} />
          <span>{`${c.job_title || 'Untitled'} · ${c.location || c.state_code || 'location unknown'}`}</span>
        </label>
      ))}
      <button className="btn btn-primary" type="submit">Save choices</button>
    </form>
  );
}

function ReviewQueue({ queue: q, run, rpc, ask }) {
  const verify = (o) => {
    const note = ask('Record independent evidence that this account is authorized to represent the company (for example, a confirmed company contact or documented company record). A matching email address alone is not enough:');
    if (note && note.trim()) run(async () => {
      if (!o.domain_verified) await rpc('operator_verify_domain', { p_org: o.id, p_note: note.trim() });
      await rpc('operator_set_org_status', { p_org: o.id, p_status: 'verified', p_note: note.trim() });
    }, 'Organization verified.');
  };
  const confirmOrg = (o) => {
    const note = ask('What did you check? (for example: website, LinkedIn page, the jobs it posted)');
    if (note && note.trim()) run(() => rpc('operator_set_org_status', { p_org: o.id, p_status: 'verified', p_note: note.trim() }), 'Company confirmed. Its first-week limit is lifted.');
  };
  const suspendOrg = (o) => { const n = ask('Reason for suspending this company? The employer sees it, and all its live jobs come down.'); if (n) run(() => rpc('operator_set_org_status', { p_org: o.id, p_status: 'suspended', p_note: n }), 'Company suspended and its jobs taken down.'); };
  const rejectOrg = (o) => { const n = ask('Reason for rejecting this organization?'); if (n) run(() => rpc('operator_set_org_status', { p_org: o.id, p_status: 'rejected', p_note: n }), 'Organization rejected.'); };
  const approvePost = (p) => run(async () => { const r = await rpc('operator_review_post', { p_post: p.id, p_revision: p.revision, p_decision: 'approve', p_note: null }); if (r && r.published === false) throw new Error(r.state); }, 'Approved and published.');
  const rejectPost = (p) => { const n = ask('Reason for the employer?'); if (n) run(() => rpc('operator_review_post', { p_post: p.id, p_revision: p.revision, p_decision: 'reject', p_note: n }), 'Rejected.'); };
  const empty = !q.orgs.length && !q.posts.length && !q.sources.length;
  return (
    <section className="card" id="review">
      <h2>Review queue</h2>
      <p className="sub">Visible to Fortune Jobs AI reviewers only. You cannot review an organization you belong to.</p>
      <div className="stack">
        {empty && <p className="sub">Nothing waiting.</p>}
        {q.orgs.map((o) => (
          <div className="post" key={'o' + o.id}>
            {o.auto_verified ? <>
              <div><strong>{o.name}</strong> <span className="meta">{`${o.domain} · verified by work email · ${o.active_posts ?? 0} live job${o.active_posts === 1 ? '' : 's'}`}</span></div>
              <p className="meta">{`Registered by ${o.registrant_email || 'email unavailable'}. Check the company's website and its jobs, then confirm it, or suspend it to take its jobs down.`}</p>
              <div className="actions">
                <button className="btn btn-sm btn-primary" type="button" onClick={() => confirmOrg(o)}>Confirm</button>
                <button className="btn btn-sm btn-danger" type="button" onClick={() => suspendOrg(o)}>Suspend</button>
              </div>
            </> : <>
              <div><strong>{o.name}</strong> <span className="meta">{`${o.domain} · ${o.domain_verified ? 'proof recorded' : 'proof needed'}`}</span></div>
              <p className="meta">{`Account requesting access: ${o.registrant_email || 'email unavailable'}. Confirm their authority through an independent company contact before verifying.`}</p>
              <div className="actions">
                <button className="btn btn-sm btn-primary" type="button" onClick={() => verify(o)}>Verify</button>
                <button className="btn btn-sm btn-danger" type="button" onClick={() => rejectOrg(o)}>Reject</button>
              </div>
            </>}
          </div>
        ))}
        {q.posts.map((p) => (
          <div className="post" key={'p' + p.id}>
            <div><strong>{p.job_title}</strong> <span className="meta">{`${p.org} · revision ${p.revision}${p.changes ? ' · edit to a live post' : ''}`}</span></div>
            <details>
              <summary>Review full submitted job before deciding</summary>
              <p className="meta">{`${p.org} · ${p.org_domain || 'domain unavailable'} · ${p.org_status || 'status unavailable'}`}</p>
              <p className="meta">{`${p.city || 'City unavailable'}, ${p.state_code || 'state unavailable'} · ${p.work_mode || 'work mode unavailable'} · ${p.employment_type || 'type unavailable'} · ${p.canonical_role || 'role unavailable'}`}</p>
              <p className="meta">{`Posted ${p.posting_date || 'date unavailable'} · Closes ${p.closing_date || 'date unavailable'}`}</p>
              <p>Apply link: <a href={p.apply_url} rel="noopener noreferrer nofollow" target="_blank">{p.apply_url}</a></p>
              <p className="meta">Submitted description</p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{p.description || 'Description unavailable. Do not approve until the submitted revision is visible.'}</p>
              <div className="actions"><button className="btn btn-sm btn-primary" type="button" disabled={!p.description} onClick={() => approvePost(p)}>Approve this revision</button></div>
            </details>
            <div className="actions"><button className="btn btn-sm btn-danger" type="button" onClick={() => rejectPost(p)}>Reject</button></div>
          </div>
        ))}
        {q.sources.map((s) => (
          <div className="post" key={'s' + s.id}>
            <div><strong>{`${s.org} · ${s.adapter}/${s.board_token}`}</strong>
              <div className="meta">{`Requested hosts: ${(s.requested_apply_hosts || []).join(', ') || 'none'}. Approve in SQL with the written-permission reference (operator_review_source).`}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
