// Job seeker profile (profile.html). Mirrors the legacy page: profile details,
// photo, résumé upload with review, saved jobs, search history, saved filters,
// data export and self-service account deletion. Row-level security limits
// every query to the signed-in person; the page never passes another user's id.
import { useCallback, useEffect, useRef, useState } from 'react';
import { SubscriptionSection } from '../shared/ProCard.jsx';
import { isActive } from '../shared/billing.js';
import { SuggestInput } from '../seeker/SuggestInput.jsx';
import { MIN_CHARS, fetchCities, localPlaces, mergePlaces, placeLabel } from '../seeker/suggest.js';
import { useAccountServices } from './services.jsx';
import { AccountNav, AdzunaCredit, Avatar, StatusMessage, Spinner, useDocumentTitle, useToast } from './components.jsx';
import { avatarPath, exportAccount, httpUrl, isAdzunaJob, removeResume } from './lib/dataSafety.js';
import * as Deletion from './lib/accountDeletion.js';
import { SkillGap } from '../seeker/AiTools.jsx';
import { fixApplyUrl } from '../shared/applyUrl.js';
import './account-base.css';
import './profile-page.css';

const JOB_TYPE_LABEL = { fulltime: 'Full-time', parttime: 'Part-time', contract: 'Contract', temporary: 'Temporary', internship: 'Internship' };
const WORK_LABEL = { onsite: 'On-site', remote: 'Remote', hybrid: 'Hybrid' };
const EXP_LABEL = { internship: 'Internship', entry: 'Entry level', associate: 'Associate', mid_senior: 'Mid-Senior', director: 'Director', executive: 'Executive' };
const DATE_LABEL = { 1: 'Past 24 hours', 3: 'Past 3 days', 7: 'Past week', 14: 'Past 2 weeks', 30: 'Past month' };

export function timeAgo(iso, now = Date.now()) {
  const s = (now - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
export function filterText(f) {
  if (!f) return '';
  const place = [f.location, f.country_name].filter(Boolean).join(', ');
  // Older searches stored codes (mid_senior); newer ones store the label itself (Mid-Senior level).
  const label = (map, v) => (v ? map[v] || String(v) : '');
  return [place && `📍 ${place}`, f.company && `🏢 ${f.company}`, label(WORK_LABEL, f.work_mode), label(JOB_TYPE_LABEL, f.job_type),
    label(EXP_LABEL, f.experience), DATE_LABEL[f.date_posted]].filter(Boolean).join(' · ');
}
export function searchUrl(query, mode, f) {
  const p = new URLSearchParams({ q: query });
  if (mode) p.set('mode', mode);
  ['location', 'country', 'date_posted', 'experience', 'job_type', 'work_mode', 'company', 'salary', 'industry', 'sponsorship'].forEach((k) => { if (f && f[k]) p.set(k, f[k]); });
  return 'index.html?' + p.toString();
}
export function completeness(profile) {
  const checks = [
    [!!profile.full_name, 'add your name'], [!!profile.avatar_url, 'add a photo'], [!!profile.current_title, 'add your title'],
    [profile.years_experience != null, 'add your experience'], [(profile.skills || []).length > 0, 'add skills'],
    [(profile.preferred_locations || []).length > 0, 'add a location'], [(profile.job_types || []).length > 0, 'pick job types'],
    [!!profile.resume_path, 'upload your resume'],
  ];
  const done = checks.filter((c) => c[0]).length;
  const next = checks.find((c) => !c[0]);
  return { pct: Math.round((done / checks.length) * 100), hint: next ? `Next: ${next[1]}` : '🎉 All set' };
}

/** Chip list editor (skills, locations). Adds on Enter, comma or blur.
 *  With `places`, it suggests cities, states and countries as you type (like the search box). */
export function ChipInput({ id, values, onChange, max, placeholder, maxLength, listId, toast, inputRef, places = false }) {
  const [draft, setDraft] = useState('');
  const local = useRef(null);
  const ref = inputRef || local;
  const add = (raw) => {
    const v = raw.replace(/,$/, '').trim().slice(0, 80);
    if (!v) return;
    if (values.length >= max) { toast(`You can add up to ${max}.`); return; }
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange(values.concat(v));
    setDraft('');
  };
  return (
    <div className="chips" onClick={() => ref.current?.focus()}>
      {values.map((v, i) => (
        <span className="chip" key={v + i}>{v}<button type="button" aria-label={`Remove ${v}`} onClick={(e) => { e.stopPropagation(); const l = values.slice(); l.splice(i, 1); onChange(l); }}>×</button></span>
      ))}
      {places
        ? <SuggestInput inputRef={ref} id={id} placeholder={placeholder} maxLength={maxLength} value={draft} listLabel="Location suggestions" minChars={MIN_CHARS}
            onChange={setDraft} getItems={(q) => localPlaces(q)} fetchMore={(q, signal) => fetchCities(q, '', { signal })} merge={mergePlaces}
            describe={(p) => ({ label: p.name, at: 0, len: Math.min(draft.trim().length, p.name.length), detail: [p.admin1 !== p.name ? p.admin1 : '', p.country, p.kind].filter(Boolean).join(' · ') })}
            onPick={(p) => add(placeLabel(p))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
              else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
            }}
            onBlur={() => add(draft)} />
        : <input ref={ref} id={id} list={listId} placeholder={placeholder} maxLength={maxLength} value={draft}
            onChange={(e) => { const val = e.target.value; if (val.includes(',')) add(val); else setDraft(val); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
              else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
            }}
            onBlur={() => add(draft)} />}
    </div>
  );
}

export function ProfilePage() {
  const fj = useAccountServices();
  useDocumentTitle('Your profile · Fortune Jobs AI');
  const [toast, toastNode] = useToast();
  const [phase, setPhase] = useState('loading'); // loading | ready | unavailable | deleted
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const leaving = useRef(false); // deletion or re-auth owns the next SIGNED_OUT

  useEffect(() => {
    if (!fj.sb) { setPhase('unavailable'); return undefined; }
    let active = true;
    (async () => {
      const u = await fj.user();
      if (!active) return;
      if (!u) { fj.replace(fj.loginUrl('profile.html')); return; }
      let p = await fj.profile(u.id);
      if (!p) {
        // Safety net: create the row if the sign-up trigger didn't.
        const { data } = await fj.sb.from('profiles').insert({ id: u.id, email: u.email }).select().single();
        p = data || { id: u.id };
      }
      if (!active) return;
      setUser(u); setProfile(p); setPhase('ready');
      if (new URLSearchParams(fj.search()).get('welcome')) toast('Welcome to Fortune Jobs AI! Complete your profile to get better matches.');
    })();
    const { data: sub } = fj.sb.auth.onAuthStateChange((ev) => {
      if (ev === 'SIGNED_OUT' && !leaving.current) fj.replace('login.html');
    });
    return () => { active = false; sub?.subscription?.unsubscribe?.(); };
  }, [fj, toast]);

  if (phase === 'deleted') {
    return (
      <div className="fja-acct fja-profile">
        <AccountNav><div><a href="employers.html" className="nav-link">Employer workspace</a><a href="find-jobs.html" className="nav-link">Find jobs →</a></div></AccountNav>
        <DeletedNotice />
      </div>
    );
  }
  return (
    <div className="fja-acct fja-profile">
      <AccountNav><div><a href="employers.html" className="nav-link">Employer workspace</a><a href="find-jobs.html" className="nav-link">Find jobs →</a></div></AccountNav>
      {phase === 'loading' && <div className="loading-page"><Spinner /> Loading your profile…</div>}
      {phase === 'unavailable' && <div className="loading-page">Accounts are temporarily unavailable. Please try again later.</div>}
      {phase === 'ready' && (
        <ProfileApp user={user} profile={profile} setProfile={setProfile} toast={toast} leaving={leaving} onDeleted={() => setPhase('deleted')} />
      )}
      {toastNode}
    </div>
  );
}

function DeletedNotice() {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <section className="card" id="delDone" tabIndex={-1} ref={ref} style={{ maxWidth: 620, margin: '80px auto', padding: 28 }}>
      <h2>Your account has been deleted</h2>
      <p style={{ margin: '12px 0' }}>Your profile, files, saved jobs, history and email preferences have been removed, and you have been signed out on this device.</p>
      <a className="btn btn-primary" href="index.html">Go to the home page</a>
    </section>
  );
}

function ProfileApp({ user, profile, setProfile, toast, leaving, onDeleted }) {
  const fj = useAccountServices();
  const { pct, hint } = completeness(profile);
  const avatarInput = useRef(null);
  const [savedCount, setSavedCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);
  const [formVersion, setFormVersion] = useState(0);
  const catalog = fj.resumeTools?.catalog?.() || null;

  // "Saved Jobs" and other links arrive as profile.html#saved; the sections only exist once the profile loads.
  useEffect(() => {
    const id = decodeURIComponent((fj.hash() || '').replace(/^#/, ''));
    if (!/^(profile|resume|saved|history|alerts|subscription)$/.test(id)) return;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView?.({ block: 'start' }));
  }, [fj]);

  async function onAvatar(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { toast('Please choose a PNG, JPG, WEBP or GIF image.'); return; }
    if (f.size > 2 * 1024 * 1024) { toast('Photo must be under 2 MB.'); return; }
    toast('Uploading photo…');
    const ext = f.type.split('/')[1].replace('jpeg', 'jpg');
    const path = `${user.id}/avatar-${crypto.randomUUID()}.${ext}`;
    const previousAvatar = profile.avatar_url;
    const up = await fj.sb.storage.from('avatars').upload(path, f, { contentType: f.type, upsert: false });
    if (up.error) { toast("Couldn't upload the photo. Please try again."); console.error(up.error); return; }
    const url = fj.sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    const { data, error } = await fj.sb.from('profiles').update({ avatar_url: url }).eq('id', user.id).select().single();
    if (error) {
      const cleanup = await fj.sb.storage.from('avatars').remove([path]);
      toast(cleanup.error ? "Couldn't save the photo. Contact support to remove the unused upload." : "Couldn't save the photo. Your previous photo is unchanged.");
      return;
    }
    setProfile(data); toast('Photo updated');
    // Tidy up older photos.
    const oldPath = avatarPath(previousAvatar, fj.config.url, user.id);
    if (oldPath && oldPath !== path) {
      const cleanup = await fj.sb.storage.from('avatars').remove([oldPath]);
      if (cleanup.error) toast('Photo updated. The previous photo could not be removed; contact support for cleanup.');
    }
  }

  return (
    <div id="app">
      <header className="hero-band">
        <div className="hero-inner">
          <button className="avatar-btn" type="button" onClick={() => avatarInput.current?.click()} aria-label="Change profile photo">
            <Avatar profile={profile} user={user} className="avatar-lg" />
            <span className="cam" aria-hidden="true">📷</span>
          </button>
          <input type="file" ref={avatarInput} accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onAvatar} />
          <div className="who">
            <h1>{profile.full_name || 'Your profile'}</h1>
            <div className="t">{profile.current_title || ''}</div>
            <div className="e">{user.email || ''}</div>
          </div>
          <div className="hero-actions">
            <a href="index.html" className="btn btn-primary btn-sm">Find jobs</a>
            <button className="btn btn-outline btn-sm" type="button" onClick={() => fj.signOut()}>Log out</button>
          </div>
        </div>
        <div className="complete"><span>Profile <b>{pct}%</b> complete</span><span className="bar"><i style={{ width: pct + '%' }} /></span><span>{hint}</span></div>
      </header>

      <main className="page">
        <nav className="sec-nav" aria-label="Profile sections">
          <a href="#profile">Profile</a>
          <a href="#resume">Resume</a>
          <a href="#skill-plan">Skill plan</a>
          <a href="#saved">Saved jobs <span className="n">{savedCount}</span></a>
          <a href="#history">Search history <span className="n">{historyCount}</span></a>
          <a href="#alerts">Filters & alerts</a>
          <a href="#subscription">Subscription</a>
        </nav>
        <div className="stack">
          {/* A saved résumé review changes title, experience and skills: remount to refill the form (legacy fillForm()). */}
          <ProfileDetails key={formVersion} user={user} profile={profile} setProfile={setProfile} toast={toast} catalog={catalog} />
          <ResumeSection user={user} profile={profile} setProfile={setProfile} toast={toast} onReviewSaved={() => setFormVersion((n) => n + 1)} />
          <div className="card" id="skill-plan"><SkillGap /></div>
          <SavedJobs toast={toast} onCount={setSavedCount} />
          <SearchHistory user={user} toast={toast} onCount={setHistoryCount} />
          <FiltersAndAlerts user={user} profile={profile} setProfile={setProfile} toast={toast} />
          <ProSubscription fj={fj} user={user} />
        </div>
        <DataExport user={user} />
        <DeleteAccount user={user} leaving={leaving} onDeleted={onDeleted} />
      </main>
    </div>
  );
}

// Pro subscription status; ?pro=welcome after Stripe Checkout re-checks for a minute while Stripe confirms.
function ProSubscription({ fj, user }) {
  const [row, setRow] = useState(undefined);
  const welcome = new URLSearchParams(fj.search()).get('pro') === 'welcome';
  useEffect(() => {
    let active = true, tries = 0, timer;
    const load = async () => {
      const { data } = await fj.sb.from('subscriptions').select('status,current_period_end,cancel_at_period_end').eq('user_id', user.id).maybeSingle();
      if (!active) return;
      setRow(data || null);
      if (welcome && !isActive(data) && ++tries < 12) timer = setTimeout(load, 5000);
    };
    load();
    return () => { active = false; clearTimeout(timer); };
  }, [fj, user.id, welcome]);
  if (row === undefined) return null;
  return <div className="card"><SubscriptionSection subscription={row} welcome={welcome} /></div>;
}

function ProfileDetails({ user, profile, setProfile, toast, catalog }) {
  const fj = useAccountServices();
  const [name, setName] = useState(profile.full_name || '');
  const [title, setTitle] = useState(profile.current_title || '');
  const [years, setYears] = useState(profile.years_experience == null ? '' : String(profile.years_experience));
  const [skills, setSkills] = useState((profile.skills || []).slice());
  const [locations, setLocations] = useState((profile.preferred_locations || []).slice());
  const [jobTypes, setJobTypes] = useState(profile.job_types || []);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const yearsRef = useRef(null), skillsRef = useRef(null), locRef = useRef(null);

  // Pick up anything typed but not yet turned into a chip.
  const pending = (ref, list, max) => {
    const v = (ref.current?.value || '').replace(/,$/, '').trim().slice(0, 80);
    if (!v || list.length >= max || list.some((x) => x.toLowerCase() === v.toLowerCase())) return list;
    return list.concat(v);
  };

  async function onSubmit(e) {
    e.preventDefault();
    setMessage('');
    const allSkills = pending(skillsRef, skills, 30), allLocations = pending(locRef, locations, 10);
    setSkills(allSkills); setLocations(allLocations);
    const yearsRaw = years.trim();
    const y = yearsRaw === '' ? null : Number(yearsRaw);
    if (y != null && (Number.isNaN(y) || y < 0 || y > 60)) { setMessage('Years of experience must be between 0 and 60.'); yearsRef.current?.focus(); return; }
    const update = {
      full_name: name.trim().slice(0, 120) || null,
      current_title: title.trim().slice(0, 120) || null,
      years_experience: y,
      skills: allSkills, preferred_locations: allLocations,
      job_types: Object.keys(JOB_TYPE_LABEL).filter((k) => jobTypes.includes(k)),
    };
    setSaving(true);
    const { data, error } = await fj.sb.from('profiles').update(update).eq('id', user.id).select().single();
    setSaving(false);
    if (error) { setMessage("Couldn't save your profile. Please try again."); console.error(error); return; }
    setProfile(data);
    setSavedNote(true); setTimeout(() => setSavedNote(false), 2200);
  }

  const titles = catalog ? catalog.titles.filter((t) => !/^(Senior|Junior|Lead) /.test(t)) : [];
  return (
    <section className="card" id="profile">
      <div className="card-head"><div><h2>Profile details</h2><p className="sub">The AI uses these to pick jobs that fit you.</p></div></div>
      <StatusMessage text={message} />
      <form noValidate onSubmit={onSubmit}>
        <div className="row-2">
          <div className="field"><label htmlFor="pName">Full name</label><input className="input" id="pName" maxLength={120} autoComplete="name" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label htmlFor="pTitle">Current job title</label><input className="input" id="pTitle" maxLength={120} list="titleOptions" placeholder="e.g. Power BI Developer" value={title} onChange={(e) => setTitle(e.target.value)} />
            <datalist id="titleOptions">{titles.map((t) => <option key={t} value={t} />)}</datalist></div>
        </div>
        <div className="row-2">
          <div className="field"><label htmlFor="pYears">Years of experience</label><input ref={yearsRef} className="input" id="pYears" type="number" min="0" max="60" step="0.1" inputMode="numeric" placeholder="e.g. 5" value={years} onChange={(e) => setYears(e.target.value)} /></div>
          <div className="field">
            <span className="label">Job types you want</span>
            <div className="pills">
              {Object.entries(JOB_TYPE_LABEL).map(([value, label]) => (
                <label className="pill" key={value}><input type="checkbox" value={value} checked={jobTypes.includes(value)}
                  onChange={(e) => setJobTypes((cur) => (e.target.checked ? cur.concat(value) : cur.filter((x) => x !== value)))} /><span>{label}</span></label>
              ))}
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="skillsInput">Skills</label>
          <ChipInput id="skillsInput" inputRef={skillsRef} values={skills} onChange={setSkills} max={30} placeholder="Type a skill and press Enter" maxLength={60} listId="skillOptions" toast={toast} />
          <datalist id="skillOptions">{(catalog ? catalog.skills : []).map((t) => <option key={t} value={t} />)}</datalist>
          <div className="hint">Add up to 30. Press Enter or comma after each one.</div>
        </div>
        <div className="field">
          <label htmlFor="locInput">Preferred locations</label>
          <ChipInput id="locInput" inputRef={locRef} values={locations} onChange={setLocations} max={10} placeholder="e.g. Chicago, Remote, Toronto" maxLength={80} toast={toast} places />
          <div className="hint">Add up to 10. Press Enter or comma after each one.</div>
        </div>
        <div className="form-foot">
          <button className="btn btn-dark" type="submit" disabled={saving}>Save profile</button>
          <span className={`saved-note${savedNote ? ' show' : ''}`}>✓ Saved</span>
        </div>
      </form>
    </section>
  );
}

function ResumeSection({ user, profile, setProfile, toast, onReviewSaved }) {
  const fj = useAccountServices();
  const tools = fj.resumeTools;
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const [draft, setDraft] = useState(null); // { file, ext, title, years, skills, text }
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [over, setOver] = useState(false);
  const generation = useRef(0);
  const fileInput = useRef(null);
  const reviewRef = useRef(null);

  useEffect(() => { if (draft) reviewRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }, [draft]);

  const cancelReview = () => { generation.current++; setDraft(null); setReading(false); };

  async function uploadResume(f) {
    if (saving) { toast('Wait for your reviewed profile to finish saving.'); return; }
    setMessage('');
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'docx'].includes(ext)) { setMessage('Use a text-based PDF or DOCX. Convert older DOC files to DOCX first.'); return; }
    if (!f.size || f.size > 5 * 1024 * 1024) { setMessage('Please upload a nonempty resume under 5 MB.'); return; }
    cancelReview();
    const gen = generation.current;
    setReading(true);
    try {
      if (!tools) throw new Error('Resume reading is unavailable right now. Please try again later.');
      const text = ext === 'pdf' ? await tools.pdfToText(f) : String(await tools.docxToText(f)).trim();
      if (gen !== generation.current) return;
      if (!text || text.replace(/\s/g, '').length < 30) throw new Error('No readable resume text found. Scanned PDFs need OCR first; export a text-based PDF or DOCX.');
      if (text.length > 60000) throw new Error('Please shorten your resume to under 60,000 characters.');
      const s = tools.suggest(text, tools.catalog?.() || {});
      setReading(false);
      setDraft({ file: f, ext, title: s.current_title || profile.current_title || '', years: s.years_experience == null ? '' : String(s.years_experience), skills: s.skills.join(', '), text });
    } catch (error) {
      if (gen !== generation.current) return;
      setReading(false);
      setMessage(error.name === 'PasswordException' ? 'Remove the PDF password and try again.' : error.message || 'Could not read this document. Export a new PDF or DOCX and try again.');
    }
  }

  async function saveReview() {
    if (!draft) return;
    setMessage('');
    const title = draft.title.trim(); const raw = draft.years.trim(); const years = raw === '' ? null : Number(raw);
    const confirmedSkills = [...new Set(draft.skills.split(',').map((s) => s.trim()).filter(Boolean))];
    const text = draft.text.trim();
    if (!title || !text || confirmedSkills.length > 30 || confirmedSkills.some((s) => s.length > 80) || (years !== null && (!Number.isFinite(years) || years < 0 || years > 60))) {
      setMessage('Enter a job title and readable text, up to 30 skills (80 characters each), and experience between 0 and 60 years.'); return;
    }
    setSaving(true);
    const oldPath = profile.resume_path;
    const path = user.id + '/resume-' + crypto.randomUUID() + '.' + draft.ext;
    try {
      const up = await fj.sb.storage.from('resumes').upload(path, draft.file, { contentType: draft.ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: false });
      if (up.error) throw new Error('Could not upload your resume. Your existing profile is unchanged; try again.');
      const { data, error } = await fj.sb.from('profiles').update({ resume_path: path, resume_name: draft.file.name.slice(0, 200), resume_text: text, resume_updated_at: new Date().toISOString(), current_title: title, years_experience: years, skills: confirmedSkills }).eq('id', user.id).select().single();
      if (error) { await fj.sb.storage.from('resumes').remove([path]); throw new Error('Could not save your profile. Your previous resume is unchanged; try again.'); }
      setProfile(data); cancelReview(); onReviewSaved();
      if (oldPath && oldPath !== path) await fj.sb.storage.from('resumes').remove([oldPath]);
      toast('Reviewed profile saved. Matching now uses your confirmed skills and experience.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }

  async function reviewSaved() {
    if (saving) return;
    setMessage('');
    try {
      const { data, error } = await fj.sb.storage.from('resumes').createSignedUrl(profile.resume_path, 120);
      if (error) throw new Error('Could not read the saved resume. Please try again.');
      const response = await fj.fetch(data.signedUrl, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Could not download your resume for review. Please try again.');
      await uploadResume(new File([await response.blob()], profile.resume_name || profile.resume_path.split('/').pop()));
    } catch (error) { setMessage(error.message || 'Could not read the saved resume. Please try again.'); }
  }

  async function view() {
    const { data, error } = await fj.sb.storage.from('resumes').createSignedUrl(profile.resume_path, 120);
    if (error) { toast("Couldn't open the file."); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function remove() {
    if (removing || saving || !profile.resume_path) return;
    if (!window.confirm('Remove your resume file and extracted text from Fortune Jobs AI?')) return;
    setRemoving(true);
    try { const p = await removeResume(fj.sb, user.id, profile); setProfile(p); cancelReview(); toast('Resume removed'); }
    catch (error) { const refreshed = await fj.profile(user.id); if (refreshed) setProfile(refreshed); toast(error.message); }
    finally { setRemoving(false); }
  }

  const words = profile.resume_text ? profile.resume_text.split(/\s+/).filter(Boolean).length : 0;
  const editDraft = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  return (
    <section className="card" id="resume">
      <div className="card-head"><div><h2>Resume</h2><p className="sub">Upload a text-based PDF or DOCX, review the extracted details, then save them for matching. Your document is read in your browser.</p><p><a href="resume-builder.html">Build a clean résumé from your own facts →</a></p></div></div>
      <StatusMessage text={message} />
      <div>
        {reading ? <div className="empty"><Spinner /> Reading your resume…</div>
          : !profile.resume_path ? (
            <label className={`drop${over ? ' over' : ''}`} htmlFor="resumeInput"
              onDragEnter={(e) => { e.preventDefault(); setOver(true); }} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
              onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) uploadResume(f); }}>
              <span className="big">📄</span><b>Upload your resume</b>
              <span>Text-based PDF or DOCX · max 5 MB · review before saving</span>
            </label>
          ) : (
            <div className="resume-row">
              <span className="resume-ic">📄</span>
              <div className="resume-meta"><b>{profile.resume_name || 'Resume'}</b>
                <span>Updated {profile.resume_updated_at ? timeAgo(profile.resume_updated_at) : ''}</span><br />
                {words
                  ? <span className="ai-status ok">✓ Text extracted · {words.toLocaleString()} words</span>
                  : <span className="ai-status warn">Replace with a text-based PDF or DOCX to extract details</span>}
              </div>
              <button className="btn btn-outline btn-sm" type="button" onClick={view}>View</button>
              <button className="btn btn-primary btn-sm" type="button" onClick={reviewSaved}>Review profile</button>
              <button className="btn btn-outline btn-sm" type="button" onClick={() => fileInput.current?.click()}>Replace</button>
              <button className="btn btn-danger btn-sm" type="button" onClick={remove}>Remove</button>
            </div>
          )}
      </div>
      {draft && (
        <div id="resumeReview" ref={reviewRef}>
          <h3>Review your extracted profile</h3>
          <p className="sub">Suggestions can be incomplete. Confirm your job title, experience and skills. Saving replaces these profile fields. Job ranking uses the confirmed details; your resume text is not sent to the live-search service.</p>
          <label htmlFor="reviewTitle">Job title to search for</label><input className="input" id="reviewTitle" maxLength={120} value={draft.title} onChange={editDraft('title')} />
          <label htmlFor="reviewYears">Years of experience (leave blank if unknown)</label><input className="input" id="reviewYears" type="number" min="0" max="60" step="0.1" value={draft.years} onChange={editDraft('years')} />
          <label htmlFor="reviewSkills">Skills, separated by commas</label><textarea className="input" id="reviewSkills" rows={3} maxLength={2000} value={draft.skills} onChange={editDraft('skills')} />
          <label htmlFor="reviewText">Extracted text — check for missing content</label><textarea className="input" id="reviewText" rows={10} maxLength={60000} value={draft.text} onChange={editDraft('text')} />
          <p><button className="btn btn-primary" type="button" disabled={saving} onClick={saveReview}>{saving ? 'Saving…' : 'Save reviewed profile'}</button> <button className="btn btn-outline" type="button" disabled={saving} onClick={cancelReview}>Cancel</button></p>
        </div>
      )}
      <input type="file" id="resumeInput" ref={fileInput} hidden accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) uploadResume(f); }} />
    </section>
  );
}

function SavedJobs({ toast, onCount }) {
  const fj = useAccountServices();
  const [state, setState] = useState({ loading: true, error: false, rows: [] });
  const load = useCallback(async () => {
    const { data, error } = await fj.sb.from('saved_jobs').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) { setState({ loading: false, error: true, rows: [] }); return; }
    setState({ loading: false, error: false, rows: data }); onCount(data.length);
  }, [fj, onCount]);
  useEffect(() => { load(); }, [load]);
  async function unsave(id) {
    const { error } = await fj.sb.from('saved_jobs').delete().eq('id', id);
    if (error) { toast("Couldn't remove it."); return; }
    load(); toast('Removed from saved jobs');
  }
  return (
    <section className="card" id="saved">
      <div className="card-head"><div><h2>Saved jobs</h2><p className="sub">Jobs you bookmarked from your searches.</p></div></div>
      <div>
        {state.error ? <p className="empty">Couldn't load saved jobs.</p>
          : !state.loading && !state.rows.length ? <p className="empty">No saved jobs yet. Tap <b>🔖 Save</b> on any job card to keep it here.</p>
            : (
              <div className="jobs">
                {state.rows.map((j) => {
                  const url = httpUrl(fixApplyUrl(j.apply_url));
                  return (
                    <div className="sjob" key={j.id}>
                      <div className="top"><span className="logo-l">{(j.company || '?')[0].toUpperCase()}</span>
                        <div><div className="ttl">{j.job_title}</div><div className="co">{j.company || ''}</div></div></div>
                      <div className="meta">📍 {j.location || 'Location not listed'}</div>
                      <div className="meta">{j.salary || 'Salary not listed'} · saved {timeAgo(j.created_at)}</div>
                      <div className="acts"><button className="btn btn-danger btn-sm" type="button" onClick={() => unsave(j.id)}>Remove</button>
                        {url ? <a className="btn btn-dark btn-sm" href={url} target="_blank" rel="noopener">Apply →</a> : null}</div>
                      {isAdzunaJob(j) ? <AdzunaCredit /> : null}
                    </div>
                  );
                })}
              </div>
            )}
      </div>
    </section>
  );
}

function SearchHistory({ user, toast, onCount }) {
  const fj = useAccountServices();
  const [state, setState] = useState({ loading: true, error: false, rows: [] });
  const load = useCallback(async () => {
    const { data, error } = await fj.sb.from('search_history').select('*').order('created_at', { ascending: false }).limit(25);
    if (error) { setState({ loading: false, error: true, rows: [] }); return; }
    setState({ loading: false, error: false, rows: data }); onCount(data.length);
  }, [fj, onCount]);
  useEffect(() => { load(); }, [load]);
  async function clear() {
    if (!window.confirm('Clear your whole search history?')) return;
    const { error } = await fj.sb.from('search_history').delete().eq('user_id', user.id);
    if (error) { toast("Couldn't clear history."); return; }
    load(); toast('History cleared');
  }
  return (
    <section className="card" id="history">
      <div className="card-head">
        <div><h2>Search history</h2><p className="sub">Your last 25 searches. Tap one to run it again.</p></div>
        {state.rows.length ? <button className="btn btn-danger btn-sm" type="button" onClick={clear}>Clear history</button> : null}
      </div>
      <div>
        {state.error ? <p className="empty">Couldn't load your history.</p>
          : !state.loading && !state.rows.length ? <p className="empty">No searches yet. Your searches will show up here.</p>
            : (
              <ul className="hist">
                {state.rows.map((h) => (
                  <li key={h.id}>
                    <span className={`mode-tag ${h.mode === 'live' ? 'live' : 'quick'}`}>{h.mode === 'live' ? '🔴 Live' : '⚡ Quick'}</span>
                    <div className="grow"><div className="q">{h.query}</div>{filterText(h.filters) ? <div className="f">{filterText(h.filters)}</div> : null}</div>
                    <span className="when">{timeAgo(h.created_at)}</span>
                    <a className="btn btn-outline btn-sm" href={searchUrl(h.query, h.mode, h.filters)}>Search again</a>
                  </li>
                ))}
              </ul>
            )}
      </div>
    </section>
  );
}

function FiltersAndAlerts({ user, profile, setProfile, toast }) {
  const fj = useAccountServices();
  const t = filterText(profile.saved_filters);
  async function clear() {
    const { data, error } = await fj.sb.from('profiles').update({ saved_filters: null }).eq('id', user.id).select().single();
    if (error) { toast("Couldn't clear filters."); return; }
    setProfile(data); toast('Saved filters cleared');
  }
  return (
    <section className="card" id="alerts">
      <div className="card-head"><div><h2>Saved filters & email preferences</h2><p className="sub">Your last-used search filters load automatically every time you visit.</p></div></div>
      <div className="field">
        <span className="label">Saved search filters</span>
        <div className="filters-saved"><span>{t || "None yet. Run a search with filters and they'll be saved here."}</span>
          {t ? <button className="btn btn-ghost btn-sm" type="button" onClick={clear}>Clear</button> : null}</div>
      </div>
      <p style={{ margin: '20px 0' }}>Get new matching jobs by email, daily or weekly. Signing up or using Google sign-in does not subscribe you.</p>
      <a className="btn btn-primary" href="email-preferences.html">Manage job alert emails</a>
    </section>
  );
}

function DataExport({ user }) {
  const fj = useAccountServices();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  async function run() {
    if (busy) return;
    setBusy(true); setStatus('Preparing your private download…');
    let url;
    try {
      const data = await exportAccount(fj.sb, user.id);
      url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'fortune-jobs-ai-my-data.json'; link.click();
      setStatus('Your download is ready. This copy contains personal information; store it securely.');
    } catch (error) { setStatus(error.message); }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); setBusy(false); }
  }
  return (
    <section className="card" style={{ padding: 24, margin: '24px 0' }}>
      <h2>Your data</h2>
      <p style={{ margin: '12px 0' }}>Download your profile, extracted resume text, saved jobs, search history and email preferences. Original uploaded files are not included. Keep the downloaded copy private.</p>
      <button className="btn btn-primary" type="button" disabled={busy} onClick={run}>Download my data</button>
      <p role="status" style={{ marginTop: 12 }}>{status}</p>
    </section>
  );
}

// Deletion is never started on load: only the final "Delete permanently" click sends it.
export function DeleteAccount({ user, leaving, onDeleted }) {
  const fj = useAccountServices();
  const [values, setValues] = useState({ phrase: '', email: '', understood: false });
  const [errors, setErrors] = useState({});
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [reauth, setReauth] = useState(false);
  const done = useRef(false);
  const refs = { phrase: useRef(null), email: useRef(null), understood: useRef(null), start: useRef(null), confirm: useRef(null), reauth: useRef(null) };
  const endpoint = fj.config.url.replace(/\/$/, '') + '/functions/v1/delete-account';
  // Pro members are told up front that deleting the account cancels Pro straight away.
  const [pro, setPro] = useState(null);
  useEffect(() => {
    let active = true;
    fj.sb?.from('subscriptions').select('status,current_period_end,cancel_at_period_end').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (active) setPro(isActive(data) ? data : null); }, () => {});
    return () => { active = false; };
  }, [fj, user.id]);

  useEffect(() => { if (panel) refs.confirm.current?.focus(); }, [panel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (reauth) refs.reauth.current?.focus(); }, [reauth]); // eslint-disable-line react-hooks/exhaustive-deps

  function start() {
    if (busy) return;
    setStatus(''); setReauth(false);
    const v = Deletion.validate(values, user && user.email);
    setErrors(v.errors);
    if (!v.ok) { (v.errors.phrase ? refs.phrase : v.errors.email ? refs.email : refs.understood).current?.focus(); return; }
    setPanel(true);
  }
  function cancel() { if (busy) return; setPanel(false); refs.start.current?.focus(); }
  async function confirm() {
    if (busy || done.current) return; // one request at a time
    const v = Deletion.validate(values, user && user.email);
    setErrors(v.errors);
    if (!v.ok) { setPanel(false); return; }
    setBusy(true);
    setStatus('Deleting your account. Keep this page open…');
    let token = '';
    try { const { data } = await fj.sb.auth.getSession(); token = data && data.session ? data.session.access_token : ''; }
    catch { /* treated as a sign-in failure */ }
    const r = token ? await Deletion.submit(fj.fetch, endpoint, token, values.phrase.trim(), values.email.trim()) : { status: 401, body: { reason: 'not_authenticated' } };
    const o = Deletion.outcome(r.status, r.body);
    if (o.kind === 'deleted') {
      done.current = true; leaving.current = true;
      // The server already ended every session; only the local copy remains.
      try { await fj.sb.auth.signOut({ scope: 'local' }); } catch { /* already gone */ }
      onDeleted();
      return;
    }
    setBusy(false); setPanel(false); setStatus(o.message);
    if (o.kind === 'phrase') setErrors({ phrase: o.message });
    if (o.kind === 'email') setErrors({ email: o.message });
    if (o.kind === 'reauth') setReauth(true);
  }
  async function signInAgain() {
    if (busy) return;
    leaving.current = true; // the page's own SIGNED_OUT redirect must not win
    try { await fj.sb.auth.signOut(); } catch { /* continue to sign-in */ }
    fj.navigate(fj.loginUrl(Deletion.RETURN_TO));
  }
  const errStyle = { color: 'var(--red)' };
  return (
    <section className="card" id="delete-account" style={{ padding: 24, margin: '24px 0', borderColor: 'var(--red)' }} aria-labelledby="delTitle">
      <h2 id="delTitle">Delete your account</h2>
      <p style={{ margin: '12px 0' }}>This permanently deletes your profile, extracted resume text, uploaded resume and photo files, saved jobs, search history and email preferences, then closes your account. It cannot be undone, and deleted data cannot be restored. Download your data first if you want a copy.</p>
      {pro && <p className="pro-delete-note" role="note" style={{ margin: '12px 0', padding: '10px 12px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red)' }}><strong>You have Fortune Jobs AI Pro.</strong> Deleting your account cancels Pro immediately, so you won’t be charged again. The rest of this month’s Pro time ends right away. To keep Pro until {new Date(pro.current_period_end).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}, cancel it under Subscription instead and delete your account later.</p>}
      <p style={{ margin: '12px 0' }} className="sub">If you are the last owner of a company on Fortune Jobs AI, its live job listings are closed. Search usage records are kept without your account attached. For your security you may be asked to sign in again first.</p>
      <div className="field">
        <label htmlFor="delPhrase">Type DELETE MY ACCOUNT</label>
        <input ref={refs.phrase} className="input" id="delPhrase" type="text" autoComplete="off" autoCapitalize="characters" spellCheck="false" aria-describedby="delPhraseErr" aria-invalid={errors.phrase ? 'true' : 'false'}
          value={values.phrase} onChange={(e) => setValues((v) => ({ ...v, phrase: e.target.value }))} />
        <p className="hint" id="delPhraseErr" role="alert" style={errStyle}>{errors.phrase || ''}</p>
      </div>
      <div className="field">
        <label htmlFor="delEmail">Your account email</label>
        <input ref={refs.email} className="input" id="delEmail" type="email" autoComplete="off" spellCheck="false" aria-describedby="delEmailErr" aria-invalid={errors.email ? 'true' : 'false'}
          value={values.email} onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))} />
        <p className="hint" id="delEmailErr" role="alert" style={errStyle}>{errors.email || ''}</p>
      </div>
      <div className="field">
        <label htmlFor="delUnderstand" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          <input ref={refs.understood} id="delUnderstand" type="checkbox" aria-describedby="delUnderstandErr" style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
            checked={values.understood} onChange={(e) => setValues((v) => ({ ...v, understood: e.target.checked }))} /> I understand this is permanent and cannot be undone.
        </label>
        <p className="hint" id="delUnderstandErr" role="alert" style={errStyle}>{errors.understood || ''}</p>
      </div>
      <button ref={refs.start} className="btn btn-outline" type="button" disabled={busy} style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={start}>Delete my account…</button>
      {panel && (
        <div role="group" aria-labelledby="delConfirmText" style={{ marginTop: 16, padding: 16, border: '1px solid var(--red)', borderRadius: 12, background: 'var(--red-bg)' }}>
          <p id="delConfirmText" style={{ marginBottom: 12 }}><strong>Last step.</strong> {pro ? 'Your Pro subscription will be cancelled, then your' : 'Your'} account and data will be deleted now.</p>
          <button ref={refs.confirm} className="btn btn-primary" type="button" disabled={busy} style={{ background: 'var(--red)', borderColor: 'var(--red)' }} onClick={confirm}>{busy ? 'Deleting…' : 'Delete permanently'}</button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={cancel}>Cancel</button>
        </div>
      )}
      <p role="status" aria-live="polite" style={{ marginTop: 12 }}>{status}</p>
      {reauth && <button ref={refs.reauth} className="btn btn-primary" type="button" onClick={signInAgain}>Sign in again</button>}
    </section>
  );
}
