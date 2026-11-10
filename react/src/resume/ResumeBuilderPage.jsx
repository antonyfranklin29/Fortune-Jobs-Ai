// resume-builder.html: a local-only résumé draft with a live preview. Nothing is
// sent to an AI provider or saved to the account. Optional imports (saved profile,
// or a PDF/DOCX read in this browser) only fill fields that are still empty, and
// always uncheck the accuracy confirmation so the person reviews again.
import { useEffect, useRef, useState } from 'react';
import { readErrorText, readResumeFile, useResumeServices } from './services.jsx';
import { FIELDS, advice, contactLine, draft, profileSuggestions } from './lib/resumeBuilder.js';
import { suggest } from './lib/resumeMatching.js';
import { atsCheck } from './lib/atsCheck.js';
import { AtsPanel } from './AtsPanel.jsx';
import './resume-base.css';
import './resume-builder.css';

const BLANK = Object.fromEntries(FIELDS.map((k) => [k, '']));
const PROFILE_LABELS = { name: 'Name', email: 'Email', target: 'Current title', skills: 'Confirmed skills', location: 'Preferred location' };
const IMPORT_MESSAGES = { type: 'Choose a text-based PDF or DOCX under 5 MB.', size: 'Choose a text-based PDF or DOCX under 5 MB.', docxLoading: 'The DOCX reader is still loading. Try again.' };

function Section({ label, content, list }) {
  if (!content || (Array.isArray(content) && !content.length)) return null;
  return (<>
    <h3>{label}</h3>
    {list ? <ul>{content.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p>{content}</p>}
  </>);
}

export function ResumeBuilderPage() {
  const svc = useResumeServices();
  const [values, setValues] = useState(BLANK);
  const [confirmed, setConfirmed] = useState(false);
  const [jobText, setJobText] = useState('');
  const [profile, setProfile] = useState({ status: '', signIn: false, suggestions: null });
  const [imported, setImported] = useState({ status: '', text: '', suggestions: null });
  const profileGen = useRef(0);
  const importGen = useRef(0);

  useEffect(() => {
    if (typeof document !== 'undefined') { const t = document.title; document.title = 'Free Résumé Builder with ATS Score Checker | Fortune Jobs AI'; return () => { document.title = t; }; }
    return undefined;
  }, []);

  const data = draft(values);
  const tips = advice(data);
  const ats = atsCheck(data, jobText);
  const canExport = confirmed && !!data.name && !!(data.email || data.phone);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const fillEmpty = (pairs) => setValues((v) => {
    const next = { ...v };
    for (const [key, suggestion] of Object.entries(pairs)) if (key in next && suggestion && !String(next[key]).trim()) next[key] = suggestion;
    return next;
  });

  function onExport() { if (canExport) svc.print(); }

  function onClear() {
    if (!svc.confirm('Clear all résumé details in this tab?')) return;
    importGen.current++; profileGen.current++;
    setImported({ status: '', text: '', suggestions: null });
    setProfile({ status: '', signIn: false, suggestions: null });
    setValues(BLANK); setConfirmed(false); setJobText('');
  }

  async function loadProfile() {
    const gen = ++profileGen.current;
    setProfile({ status: 'Reading your saved profile…', signIn: false, suggestions: null });
    try {
      const account = svc.account;
      if (!account || !account.sb) throw new Error('Accounts are unavailable right now. Try again later.');
      const user = await account.user();
      if (gen !== profileGen.current) return;
      if (!user) { setProfile({ status: 'Sign in to read your saved profile, or keep using the blank form.', signIn: true, suggestions: null }); return; }
      const { data: row, error } = await account.sb.from('profiles').select('full_name,email,current_title,skills,preferred_locations').eq('id', user.id).maybeSingle();
      if (gen !== profileGen.current) return;
      if (error) throw new Error('Could not read your profile. Try again later.');
      const suggestions = profileSuggestions(row, user.email);
      if (!Object.keys(PROFILE_LABELS).some((k) => suggestions[k])) { setProfile({ status: 'Your profile has no details to add yet. You can fill the form directly.', signIn: false, suggestions: null }); return; }
      setProfile({ status: 'Review these saved details before adding them to empty fields.', signIn: false, suggestions });
    } catch (error) {
      if (gen !== profileGen.current) return;
      setProfile({ status: (error && error.message) || 'Could not read your profile. Try again later.', signIn: false, suggestions: null });
    }
  }

  function useProfile() {
    if (!profile.suggestions) return;
    fillEmpty(profile.suggestions); setConfirmed(false);
    setProfile((p) => ({ ...p, status: 'Profile details added to empty fields. Check every fact before exporting; your saved profile has not changed.' }));
  }

  async function importFile(file) {
    const gen = ++importGen.current;
    setImported({ status: 'Reading your résumé in this browser…', text: '', suggestions: null });
    try {
      const text = await readResumeFile(svc, file, { messages: IMPORT_MESSAGES });
      if (gen !== importGen.current) return;
      if (text.replace(/\s/g, '').length < 30 || text.length > 60000) throw new Error('The document has no readable text or is too long. Scanned PDFs need OCR first.');
      setImported({ status: 'Read locally. Review the extracted text, then choose whether to use the suggested title and skills. Copy only facts you want in the résumé.', text, suggestions: suggest(text) });
    } catch (error) {
      if (gen !== importGen.current) return;
      setImported({ status: readErrorText(error, 'Could not read this document.'), text: '', suggestions: null });
    }
  }

  function useSuggestions() {
    const s = imported.suggestions;
    if (!s) return;
    setValues((v) => ({
      ...v,
      target: s.current_title && !v.target ? s.current_title : v.target,
      skills: s.skills.length && !v.skills ? s.skills.join('\n') : v.skills,
    }));
    setConfirmed(false);
    setImported((i) => ({ ...i, status: 'Suggestions added where fields were blank. Check them carefully and enter your own experience and education.' }));
  }

  const showSuggestions = !!(imported.suggestions && (imported.suggestions.current_title || imported.suggestions.skills.length));
  const field = (id, label, props = {}) => (
    <div className="field"><label htmlFor={id}>{label}</label><input className="input" id={id} value={values[id]} onChange={set(id)} {...props} /></div>
  );
  const area = (id, label, props = {}) => (
    <textarea className="input" id={id} value={values[id]} onChange={set(id)} {...props} />
  );
  const contact = contactLine(data);

  return (
    <div className="fja-res fja-resume-builder">
      <nav className="builder-nav" aria-label="Main"><a href="index.html">Fortune Jobs AI</a><a href="find-jobs.html">Find jobs</a><a href="profile.html">My profile</a></nav>
      <main>
        <h1>Build your résumé</h1>
        <p className="lead">Turn your own facts into a clean, editable résumé. Your draft stays in this browser tab; you can optionally read details from your saved Fortune Jobs AI profile. This version does not send your résumé to an AI provider or save the draft to your account. Review every statement before sharing it.</p>

        <section className="card import-card" aria-labelledby="profileImportTitle">
          <h2 id="profileImportTitle">Start from your saved profile</h2>
          <p>Optional: read your saved name, contact email, current title, confirmed skills and preferred location. Review them here before adding them to empty fields. Your existing profile is not changed.</p>
          <button className="btn btn-outline btn-sm" type="button" onClick={loadProfile}>Review saved profile</button>
          <p id="profileStatus" role="status" aria-live="polite">{profile.status}</p>
          {profile.signIn && <a id="profileSignIn" href="login.html?next=resume-builder.html">Sign in to use your profile</a>}
          {profile.suggestions && (<>
            <ul id="profilePreview" className="source-text">
              {Object.entries(PROFILE_LABELS).filter(([k]) => profile.suggestions[k]).map(([k, label]) => <li key={k}>{label + ': ' + profile.suggestions[k].replace(/\n/g, ', ')}</li>)}
            </ul>
            <button className="btn btn-outline btn-sm" type="button" onClick={useProfile}>Add reviewed profile details</button>
          </>)}
        </section>

        <section className="card import-card" aria-labelledby="importTitle">
          <h2 id="importTitle">Start from an existing résumé</h2>
          <p>Optional: choose a text-based PDF or DOCX (up to 5 MB). We read it in this browser, suggest a title and skills, and show the source text for you to review. Nothing is automatically added to the final résumé.</p>
          <input id="importFile" type="file" aria-label="Existing résumé file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => { const file = e.target.files[0]; e.target.value = ''; if (file) importFile(file); }} />
          <p id="importStatus" role="status" aria-live="polite">{imported.status}</p>
          {showSuggestions && <button className="btn btn-outline btn-sm" type="button" onClick={useSuggestions}>Use reviewed title and skills</button>}
          {imported.text && <details id="sourceDetails"><summary>Review extracted text</summary><pre id="sourceText" className="source-text">{imported.text}</pre></details>}
        </section>

        <div className="layout">
          <form className="editor card" id="resumeForm" onSubmit={(e) => e.preventDefault()}>
            <section><h2>Contact and target role</h2>
              <div className="row-2">{field('name', 'Name', { maxLength: 120, autoComplete: 'name' })}{field('target', 'Target role', { maxLength: 120, placeholder: 'Data Analyst' })}</div>
              <div className="row-2">{field('email', 'Email', { type: 'email', maxLength: 200, autoComplete: 'email' })}{field('phone', 'Phone', { maxLength: 80, autoComplete: 'tel' })}</div>
              <div className="row-2">{field('location', 'City and region', { maxLength: 120, autoComplete: 'address-level2' })}{field('link', 'Portfolio or LinkedIn URL', { type: 'url', maxLength: 300, placeholder: 'https://' })}</div>
            </section>
            <section><h2>Professional summary</h2>
              <div className="field"><label htmlFor="summary">Write a summary using facts you can verify</label>{area('summary', 'Professional summary', { maxLength: 1000, rows: 4, placeholder: 'Your experience, focus, and the work you want to do.' })}</div>
            </section>
            <section><h2>Experience</h2>
              <div className="field"><label htmlFor="experience">One line per role or achievement</label>{area('experience', 'Experience', { maxLength: 5000, rows: 7, placeholder: 'Data Analyst, Example Co. — 2022–2025\nBuilt weekly reports using SQL and Power BI.' })}
                <p className="small">Enter only real employers, dates and outcomes. You can edit the preview by editing these fields.</p></div>
            </section>
            <section><h2>Skills, education and projects</h2>
              <div className="field"><label htmlFor="skills">Skills, one per line</label>{area('skills', 'Skills', { maxLength: 2000, rows: 4, placeholder: 'SQL\nPower BI' })}</div>
              <div className="field"><label htmlFor="education">Education and credentials, one per line</label>{area('education', 'Education', { maxLength: 2000, rows: 3 })}</div>
              <div className="field"><label htmlFor="projects">Projects, one per line</label>{area('projects', 'Projects', { maxLength: 3000, rows: 3 })}</div>
            </section>
            <AtsPanel ats={ats} jobText={jobText} onJobText={setJobText} />
            <div id="advice" className="notice" aria-live="polite">
              <strong>{tips.length ? 'Before you export' : 'Ready to review'}</strong>
              {tips.length ? <ul>{tips.map((tip) => <li key={tip}>{tip}</li>)}</ul> : <p>Check every statement against your own records.</p>}
            </div>
            <label className="verify"><input type="checkbox" id="confirmed" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> <span>I reviewed the details and confirm they are accurate.</span></label>
            <div className="actions">
              <button className="btn btn-primary" id="export" type="button" disabled={!canExport} onClick={onExport}>Print or save PDF</button>
              <button className="btn btn-outline" id="clear" type="button" onClick={onClear}>Clear form</button>
            </div>
            <p className="small" style={{ marginTop: 12 }}>Use your browser’s “Save as PDF” option in the print dialog. Closing this tab discards your draft.</p>
          </form>
          <div className="preview-wrap">
            <div className="preview-toolbar"><strong>Live preview</strong><span className="small">Plain layout for easy reading</span></div>
            <article className="paper" id="preview" aria-label="Résumé preview">
              <h2>{data.name || 'Your name'}</h2>
              <p className="role">{data.target || 'Target role'}</p>
              <p className="contact">{contact || 'Add a contact method'}</p>
              <Section label="Profile" content={data.summary} />
              <Section label="Experience" content={data.experience} list />
              <Section label="Skills" content={data.skills} list />
              <Section label="Education" content={data.education} list />
              <Section label="Projects" content={data.projects} list />
            </article>
          </div>
        </div>
      </main>
    </div>
  );
}
