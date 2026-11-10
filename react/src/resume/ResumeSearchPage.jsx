// resume-search.html: start job matching from a résumé, from manually entered
// experience, or with nothing at all. The file is read in this browser and never
// uploaded; reviewed details stay in sessionStorage for up to two hours
// (lib/guestResume.js). Only the job title and chosen area reach Live Search.
import { useEffect, useRef, useState } from 'react';
import { readErrorText, readResumeFile, useResumeServices } from './services.jsx';
import * as Guest from './lib/guestResume.js';
import * as Matching from './lib/resumeMatching.js';
import { atsCheckText } from './lib/atsCheck.js';
import { AtsPanel } from './AtsPanel.jsx';
import './resume-base.css';
import './resume-search.css';

export const COUNTRIES = [
  ['us', '🇺🇸', 'United States'], ['ca', '🇨🇦', 'Canada'], ['gb', '🇬🇧', 'United Kingdom'], ['in', '🇮🇳', 'India'], ['au', '🇦🇺', 'Australia'],
  ['nz', '🇳🇿', 'New Zealand'], ['ie', '🇮🇪', 'Ireland'], ['de', '🇩🇪', 'Germany'], ['fr', '🇫🇷', 'France'], ['nl', '🇳🇱', 'Netherlands'],
  ['es', '🇪🇸', 'Spain'], ['it', '🇮🇹', 'Italy'], ['ch', '🇨🇭', 'Switzerland'], ['be', '🇧🇪', 'Belgium'], ['se', '🇸🇪', 'Sweden'],
  ['pl', '🇵🇱', 'Poland'], ['ae', '🇦🇪', 'United Arab Emirates'], ['sa', '🇸🇦', 'Saudi Arabia'], ['qa', '🇶🇦', 'Qatar'], ['sg', '🇸🇬', 'Singapore'],
  ['my', '🇲🇾', 'Malaysia'], ['ph', '🇵🇭', 'Philippines'], ['jp', '🇯🇵', 'Japan'], ['hk', '🇭🇰', 'Hong Kong'], ['za', '🇿🇦', 'South Africa'],
  ['ng', '🇳🇬', 'Nigeria'], ['mx', '🇲🇽', 'Mexico'], ['br', '🇧🇷', 'Brazil'], ['ar', '🇦🇷', 'Argentina'],
];
const COUNTRY_CODES = Object.fromEntries(COUNTRIES.map(([code, , name]) => [name, code]));
const EMPTY = { current_title: '', years_experience: null, skills: [], roles: [], city: '', region: '', country: '', scope: 'city' };
const READ_MESSAGES = { type: 'Please use a text-based PDF or DOCX. Convert older DOC files first.', size: 'Please choose a nonempty file under 5 MB.', docxLoading: 'The document reader is still loading. Try again in a moment.' };

function toForm(profile) {
  return {
    current_title: profile.current_title == null ? '' : String(profile.current_title),
    years_experience: profile.years_experience == null ? '' : String(profile.years_experience),
    city: profile.city || '', region: profile.region || '', country: COUNTRIES.some(([code]) => code === profile.country) ? profile.country : '',
    scope: profile.region ? (profile.scope || 'region') : 'city',
    skills: (profile.skills || []).join(', '),
  };
}

export function ResumeSearchPage() {
  const svc = useResumeServices();
  const [notice, setNotice] = useState({ text: '', error: false });
  const [draft, setDraft] = useState(null); // the detected or saved profile behind the form
  const [form, setForm] = useState(null);
  const [resumeText, setResumeText] = useState(''); // in memory only, for the ATS check
  const [jobText, setJobText] = useState('');
  const generation = useRef(0);
  const fileInput = useRef(null);
  const reviewRef = useRef(null);
  const formRef = useRef(null);
  const [scrollKey, setScrollKey] = useState(0);
  const say = (text, error = false) => setNotice({ text, error });

  useEffect(() => { if (scrollKey) reviewRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }, [scrollKey]);
  useEffect(() => {
    if (typeof document !== 'undefined') { const t = document.title; document.title = 'Upload Your Résumé: Free ATS Score and Job Matches | Fortune Jobs AI'; return () => { document.title = t; }; }
    return undefined;
  }, []);

  function fill(profile) { setDraft(profile); setForm(toForm(profile)); }
  function startManual() {
    generation.current++;
    setResumeText('');
    fill({ ...EMPTY });
    say('Enter your experience and skills below. No résumé file is needed.');
    setScrollKey((k) => k + 1);
  }

  useEffect(() => {
    const entry = new URLSearchParams(svc.search());
    if (entry.get('edit') === '1') {
      const saved = svc.storage ? Guest.load(svc.storage) : null;
      if (saved) { fill(saved); say('Edit your temporary matching details, then continue to job search.'); }
      else say('Your temporary details have expired. Upload a résumé or enter your experience again.');
    } else if (entry.get('manual') === '1') startManual();
    // Runs once per visit, like the legacy page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function extract(file) {
    const token = ++generation.current;
    say('Reading your résumé in this browser…');
    setForm(null); setDraft(null); setResumeText('');
    try {
      const text = await readResumeFile(svc, file, { messages: READ_MESSAGES });
      if (token !== generation.current) return;
      if (text.replace(/\s/g, '').length < 30) throw new Error('No readable résumé text found. Scanned PDFs need OCR first; export a text-based PDF or DOCX.');
      if (text.length > 60000) throw new Error('Please use a résumé with under 60,000 characters.');
      const profile = Guest.detect(text, { ...(svc.catalog() || {}), countries: COUNTRY_CODES }, Matching);
      profile.scope = profile.region ? 'region' : 'city';
      profile.skills = profile.skills.slice(0, 30);
      fill(profile); setResumeText(text);
      say('Your résumé was read. Review your job title and skills below before searching.');
      setScrollKey((k) => k + 1);
    } catch (error) {
      if (token !== generation.current) return;
      say(readErrorText(error, 'Could not read this résumé. Export a new PDF or DOCX and try again.'), true);
    }
  }

  function read() {
    const raw = form.years_experience.trim();
    return {
      ...draft, current_title: form.current_title.trim(), years_experience: raw === '' ? null : Number(raw),
      skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean), city: form.city.trim(), region: form.region.trim(), country: form.country, scope: form.scope,
    };
  }

  function onSubmit(e) {
    e.preventDefault();
    if (formRef.current && !formRef.current.reportValidity()) return;
    const profile = read();
    if (profile.skills.length > 30) { say('Choose up to 30 skills for matching.', true); return; }
    if (!profile.current_title) { say('Please enter your current or target job title.', true); return; }
    if (!profile.skills.length) { say('Add at least one skill you genuinely have so we can estimate job fit, or search without a résumé.', true); return; }
    try {
      const saved = Guest.save(svc.storage, profile);
      svc.navigate('find-jobs.html?resume=1&resume_id=' + encodeURIComponent(saved.match_id));
    } catch {
      say('Your browser could not keep the temporary matching details. Allow session storage or search without a résumé.', true);
    }
  }

  function forget() {
    generation.current++;
    try { Guest.clear(svc.storage); } catch { /* storage blocked */ }
    setDraft(null); setForm(null); setResumeText(''); setJobText('');
    say('Temporary résumé details cleared.');
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const ats = resumeText ? atsCheckText(resumeText, jobText, { target: form ? form.current_title : '' }) : null;
  return (
    <div className="fja-res fja-resume-search">
      <nav className="nav"><a className="brand" href="index.html">Fortune Jobs AI</a><a href="about.html">About</a><a href="find-jobs.html" style={{ color: 'var(--gold)' }}>Find Jobs</a></nav>
      <main>
        <h1>Get job matches based on your experience</h1>
        <p className="intro">Upload a résumé or enter your experience and skills yourself. We’ll show an explainable fit estimate when a job listing has enough detail. You can also <a href="find-jobs.html?resume=0">search jobs without adding any details</a>.</p>
        <section className="panel">
          <h2>Choose how to start</h2>
          <label className="drop" htmlFor="guestResumeFile"><strong>📄 Upload your résumé</strong><span>Text-based PDF or DOCX · up to 5 MB</span><span>Review the detected details before matching</span></label>
          <input id="guestResumeFile" ref={fileInput} type="file" hidden accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => { const file = e.target.files[0]; e.target.value = ''; if (file) extract(file); }} />
          <div className="actions">
            <button className="btn btn-outline" type="button" onClick={startManual}>Enter experience and skills instead</button>
            <a className="btn btn-outline" href="find-jobs.html?resume=0">Search jobs without a résumé</a>
          </div>
          <p className="sub">Your file is read in this browser and is not uploaded to our résumé storage. Temporary matching details stay in this tab for up to two hours. Only your job title and chosen search area are sent for a Live Search.</p>
        </section>
        <p id="notice" className={notice.error ? 'error' : ''} role="status" aria-live="polite">{notice.text}</p>
        {form && (
          <form className="panel" id="guestReview" ref={(n) => { formRef.current = n; reviewRef.current = n; }} onSubmit={onSubmit}>
            <h2>Your search summary</h2>
            <p className="sub">{draft && draft.experienceEstimated
              ? 'Experience is estimated from dated work history, with overlapping roles counted once. Please check it before relying on these matches.'
              : 'Check the detected details. You can change your job title, home area and skills.'}</p>
            <label className="field" htmlFor="guestRole">Job title</label>
            <input className="input" id="guestRole" maxLength={120} list="guestRoleOptions" required value={form.current_title} onChange={set('current_title')} />
            <datalist id="guestRoleOptions">{((draft && draft.roles) || []).map((role) => <option key={role} value={role} />)}</datalist>
            <div className="row">
              <div><label className="field" htmlFor="guestYears">Years of experience</label><input className="input" id="guestYears" type="number" min="0" max="60" step="0.1" placeholder="Leave blank if unknown" value={form.years_experience} onChange={set('years_experience')} /></div>
              <div><label className="field" htmlFor="guestCountry">Country (optional)</label>
                <select className="input" id="guestCountry" value={form.country} onChange={set('country')}>
                  <option value="">Choose country</option>
                  {COUNTRIES.map(([code, flag, name]) => <option key={code} value={code}>{flag} {name}</option>)}
                </select></div>
            </div>
            <div className="row">
              <div><label className="field" htmlFor="guestCity">Home city (optional)</label><input className="input" id="guestCity" maxLength={80} placeholder="e.g. Edison" value={form.city} onChange={set('city')} /></div>
              <div><label className="field" htmlFor="guestRegion">State or region (optional)</label><input className="input" id="guestRegion" maxLength={80} placeholder="e.g. New Jersey" value={form.region} onChange={set('region')} /></div>
            </div>
            <label className="field" htmlFor="guestScope">Search area</label>
            <select className="input" id="guestScope" value={form.scope} onChange={set('scope')}><option value="region">Across my state or region</option><option value="city">My city only</option></select>
            <label className="field" htmlFor="guestSkills">Skills, separated by commas</label>
            <textarea className="input" id="guestSkills" maxLength={2400} rows={3} value={form.skills} onChange={set('skills')} />
            <div className="actions">
              <button className="btn btn-primary" type="submit">Save details and find jobs</button>
              <button className="btn btn-outline" type="button" onClick={forget}>Clear these details</button>
              <button className="btn btn-outline" type="button" onClick={() => fileInput.current?.click()}>Use another résumé</button>
            </div>
          </form>
        )}
        {ats && (
          <div className="panel" id="atsPanel">
            <AtsPanel ats={ats} jobText={jobText} onJobText={setJobText} intro="We checked the text of your uploaded résumé for what applicant tracking systems (ATS) and recruiters commonly look for." />
            <p className="sub">Want to fix these? <a href="resume-builder.html">Open the résumé builder</a> and import the same file.</p>
          </div>
        )}
        <p className="sub">Fit estimates are based on confirmed skills and details found in each job listing. They are not ATS scores or hiring predictions. Search stays available without a résumé.</p>
      </main>
    </div>
  );
}
