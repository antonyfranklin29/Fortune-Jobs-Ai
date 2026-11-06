// Sign-in, sign-up, password reset (login.html and employer-login.html).
// Behaviour mirrors /login-form.js. The area only changes wording and the
// post-sign-in destination; RPCs verify company membership and reviewer rights
// on the server. No role is ever written to user metadata.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccountServices } from './services.jsx';
import { AccountNav, StatusMessage, Spinner, useDocumentTitle } from './components.jsx';
import * as Flow from './lib/accountFlow.js';
import './account-base.css';
import './auth-page.css';

const BASE_MODES = {
  signin: { title: 'Welcome back', sub: 'Sign in to see your profile, saved jobs and history.', btn: 'Sign in', pwLabel: 'Password', pwAuto: 'current-password' },
  signup: { title: 'Create your free account', sub: 'It takes 30 seconds. No credit card.', btn: 'Create account', pwLabel: 'Password', pwAuto: 'new-password' },
  forgot: { title: 'Reset your password', sub: "Enter your email and we'll send you a reset link." , btn: 'Send reset link' },
  reset: { title: 'Choose a new password', sub: 'Pick something at least 8 characters long.', btn: 'Save new password', pwLabel: 'New password', pwAuto: 'new-password' },
};
const EMPLOYER_MODES = {
  ...BASE_MODES,
  signin: { ...BASE_MODES.signin, title: 'Welcome back, employers', sub: 'Sign in to manage your company and job posts.' },
  signup: { ...BASE_MODES.signup, title: 'Create your employer account', sub: 'Start with a free account. Company verification follows.', btn: 'Create employer account' },
};

const SIDE = {
  jobseeker: {
    title: <>Your job search,<br /><span>remembered.</span></>,
    intro: 'Create a free Fortune Jobs AI profile and let the AI match jobs to your real background.',
    perks: [['📄', 'Upload your resume', 'AI ranks jobs against your actual experience.'], ['🔖', 'Save jobs', "Keep a shortlist and apply when you're ready."], ['🕘', 'Search history & saved filters', 'Pick up right where you left off.']],
    switchLabel: 'Hiring for your company?', switchText: 'Employer sign in', switchHref: 'employer-login.html',
  },
  employer: {
    title: <>Your next hire<br /><span>starts here.</span></>,
    intro: 'A dedicated workspace for your company, your job posts and your hiring team.',
    perks: [['📄', 'Build your company workspace', 'Register your company and verify its website domain.'], ['🔖', '15 active job posts, free', 'Manage your allowance across your whole company.'], ['🕘', 'Reviewed before publication', 'Track drafts, approvals and live job posts in one place.']],
    switchLabel: 'Looking for your next role?', switchText: 'Job seeker sign in', switchHref: 'login.html',
  },
  // login.html opened with ?next=employers.html (OAuth and email links return here).
  employerViaJobseekerPage: {
    title: 'Your next hire starts here.',
    intro: 'A dedicated workspace for your company, your job posts and your hiring team.',
    perks: [['📄', null, 'Register your company and verify its website domain.'], ['🔖', null, 'Manage up to 15 active job posts free across your company.'], ['🕘', null, 'Track drafts, approvals and live job posts in one place.']],
    switchLabel: 'Looking for your next role?', switchText: 'Job seeker sign in', switchHref: 'login.html',
  },
};

export function friendlyAuthError(err) {
  const m = (err && err.message) || String(err || '');
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox for the link we sent.';
  if (/already registered|already been registered/i.test(m)) return 'An account with this email already exists. Sign in instead.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/password should be at least|weak password/i.test(m)) return 'Please choose a stronger password (at least 8 characters).';
  if (/failed to fetch|network/i.test(m)) return "Can't reach the server. Check your connection and try again.";
  if (/session missing|jwt expired|refresh token/i.test(m)) return 'Your session has expired. Sign in again or request a new reset link.';
  return 'This request could not be completed. Please try again, or contact info@fortunejobsai.com.';
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
);

function AuthPage({ area }) {
  const fj = useAccountServices();
  const params = useMemo(() => new URLSearchParams(fj.search()), [fj]);
  const incomingAuthError = useMemo(() => Flow.callbackError(fj.search(), fj.hash()), [fj]);
  const employerFlow = area === 'employer' || Flow.isEmployerNext(params.get('next'));
  const modes = employerFlow ? EMPLOYER_MODES : BASE_MODES;
  const side = area === 'employer' ? SIDE.employer : employerFlow ? SIDE.employerViaJobseekerPage : SIDE.jobseeker;
  useDocumentTitle(employerFlow ? 'Employer sign in · Fortune Jobs AI' : 'Job seeker sign in · Fortune Jobs AI');

  const initialMode = ['signup', 'forgot', 'reset'].includes(params.get('mode')) ? params.get('mode') : 'signin';
  const [mode, setModeState] = useState(initialMode);
  const [message, setMessage] = useState({ text: '', kind: 'error' });
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [google, setGoogle] = useState(false);
  const [providerStatus, setProviderStatus] = useState('Checking sign-in options…');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const emailRef = useRef(null), passwordRef = useRef(null);
  const modeRef = useRef(mode); modeRef.current = mode;

  const showMsg = (text, kind = 'error') => setMessage({ text, kind });
  const setMode = useCallback((m) => { setModeState(m); setShowPassword(false); setMessage({ text: '', kind: 'error' }); }, []);

  // Only allow returning to our own pages (blocks redirects to other sites).
  const nextPage = (fallback) => {
    const n = params.get('next') || '';
    return employerFlow ? Flow.employerNext(n) : Flow.next(n, fallback);
  };

  useEffect(() => {
    let active = true;
    if (!fj.sb) { showMsg('Accounts are temporarily unavailable. Please try again later.'); return undefined; }
    (async () => {
      try {
        const r = await fj.fetch(`${fj.config.url}/auth/v1/settings`, { headers: { apikey: fj.config.key }, signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error('Provider settings unavailable');
        const s = await r.json();
        if (!active) return;
        setGoogle(Flow.providers(s).google);
        setProviderStatus('Use an available provider or sign in with email.');
      } catch {
        if (active) setProviderStatus('Other sign-in options could not be checked. You can try email below.');
      }
    })();
    if (incomingAuthError) showMsg(incomingAuthError);
    // Arrived from a password-reset email.
    const { data: sub } = fj.sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') setMode('reset'); });
    (async () => {
      try {
        const user = await fj.user();
        if (!active) return;
        if (user && modeRef.current !== 'reset' && !incomingAuthError) fj.replace(nextPage('profile.html'));
        else if (!user && modeRef.current === 'reset') { setMode('forgot'); showMsg(incomingAuthError || 'Open a valid password-reset email link, or request a new one below.'); }
      } catch { if (active) showMsg('Your account session could not be checked. Please try again.'); }
    })();
    return () => { active = false; sub?.subscription?.unsubscribe?.(); };
    // Runs once per page view, like the legacy init().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    if (!fj.sb) { showMsg('Accounts are temporarily unavailable. Please try again later.'); return; }
    if (busy || oauthBusy) return;
    const mail = email.trim();
    if (mode !== 'reset' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { showMsg('Please enter a valid email address.'); emailRef.current?.focus(); return; }
    if ((mode === 'signup' || mode === 'reset') && (password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password))) { showMsg('Use at least 8 characters, with letters and numbers.'); passwordRef.current?.focus(); return; }
    if (mode === 'signin' && !password) { showMsg('Please enter your password.'); passwordRef.current?.focus(); return; }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await fj.sb.auth.signInWithPassword({ email: mail, password });
        if (error) throw error;
        fj.navigate(nextPage('profile.html'));
      } else if (mode === 'signup') {
        const { data, error } = await fj.sb.auth.signUp({
          email: mail, password,
          options: { data: { full_name: fullName.trim().slice(0, 120) }, emailRedirectTo: fj.baseUrl() + 'login.html?next=' + encodeURIComponent(nextPage('profile.html')) },
        });
        if (error) throw error;
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('already registered');
        if (data.session) { fj.navigate(nextPage('profile.html?welcome=1')); return; }
        setMode('signin');
        setEmail(mail);
        showMsg(`Almost done! We sent a confirmation link to ${mail}. Click it, then sign in here.`, 'ok');
      } else if (mode === 'forgot') {
        const { error } = await fj.sb.auth.resetPasswordForEmail(mail, { redirectTo: fj.baseUrl() + 'login.html?mode=reset' + (employerFlow ? '&next=employers.html' : '') });
        if (error) throw error;
        showMsg(`If an account exists for ${mail}, a reset link is on its way. Check your inbox.`, 'ok');
      } else if (mode === 'reset') {
        const { data: sessionData, error: sessionError } = await fj.sb.auth.getSession();
        if (sessionError || !sessionData.session) { setMode('forgot'); showMsg('Your reset link has expired or is missing. Request a new link below.'); return; }
        const { error } = await fj.sb.auth.updateUser({ password });
        if (error) throw error;
        showMsg('Password updated. Taking you to your account…', 'ok');
        setTimeout(() => fj.navigate(nextPage('profile.html')), 1200);
      }
    } catch (err) {
      showMsg(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    if (!fj.sb || oauthBusy || !google) return;
    setOauthBusy(true);
    setProviderStatus('Opening Google securely…');
    try {
      const { error } = await fj.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: fj.baseUrl() + 'login.html?next=' + encodeURIComponent(nextPage('profile.html')) } });
      if (error) throw error;
    } catch (error) { showMsg(friendlyAuthError(error)); }
    finally { setOauthBusy(false); setProviderStatus('You can also sign in with your email address.'); }
  }

  const c = modes[mode];
  const shows = (list) => list.split(' ').includes(mode);
  return (
    <div className="fja-acct fja-login" data-account-area={area}>
      <AccountNav><a href="index.html" className="nav-link">← Back to job search</a></AccountNav>
      <div className="auth-wrap">
        <aside className="auth-side">
          <h1>{side.title}</h1>
          <p>{side.intro}</p>
          <ul className="perks">
            {side.perks.map(([icon, bold, text]) => (
              <li key={text}><span className="ic">{icon}</span><span>{bold ? <b>{bold}</b> : null}{text}</span></li>
            ))}
          </ul>
        </aside>
        <main className="auth-main">
          <div className="auth-card">
            {shows('signin signup') && (
              <div className="tabs" role="tablist">
                <button className={`tab${mode === 'signin' ? ' active' : ''}`} role="tab" type="button" aria-selected={mode === 'signin'} onClick={() => setMode('signin')}>Sign in</button>
                <button className={`tab${mode === 'signup' ? ' active' : ''}`} role="tab" type="button" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>Create account</button>
              </div>
            )}
            <p className="account-area">{employerFlow ? 'EMPLOYER ACCOUNT' : 'JOB SEEKER ACCOUNT'}</p>
            <h2 className="auth-title">{c.title}</h2>
            <p className="auth-sub">{c.sub}</p>
            <StatusMessage text={message.text} kind={message.kind} />
            <form onSubmit={onSubmit} noValidate>
              {shows('signup') && (
                <div className="field">
                  <label htmlFor="fullName">Full name</label>
                  <input className="input" id="fullName" type="text" autoComplete="name" maxLength={120} placeholder="Jane Doe" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
              )}
              {shows('signin signup forgot') && (
                <div className="field">
                  <label htmlFor="email">{mode === 'signin' ? 'Username (email)' : 'Email'}</label>
                  <input ref={emailRef} className="input" id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              )}
              {shows('signin signup reset') && (
                <div className="field">
                  <label htmlFor="password">{c.pwLabel}</label>
                  <div className="pw-wrap">
                    <input ref={passwordRef} className="input" id="password" type={showPassword ? 'text' : 'password'} autoComplete={c.pwAuto}
                      minLength={mode === 'signin' ? 1 : 8} placeholder={mode === 'signin' ? 'Your password' : '8+ characters, letters and numbers'} value={password} onChange={(e) => setPassword(e.target.value)} />
                    <button type="button" className="pw-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((v) => !v)}>{showPassword ? 'Hide' : 'Show'}</button>
                  </div>
                </div>
              )}
              {shows('signin') && (
                <div className="row-between"><span /><button type="button" className="link-btn" onClick={() => setMode('forgot')}>Forgot password?</button></div>
              )}
              <button className="btn btn-primary btn-block" type="submit" disabled={busy || oauthBusy}>{busy ? <Spinner /> : c.btn}</button>
            </form>
            {shows('signin signup') && (
              <div>
                <div className="divider">or continue with</div>
                <button className="google-btn" type="button" disabled={!google || oauthBusy} onClick={signInWithGoogle}><GoogleIcon /> Continue with Google</button>
                {!google && <div className="google-note" style={{ display: 'block' }}>Google sign-in is not available yet. Use email below.</div>}
                <p className="fine" role="status">{providerStatus}</p>
              </div>
            )}
            {shows('forgot reset') && <p className="fine"><button type="button" className="link-btn" onClick={() => setMode('signin')}>← Back to sign in</button></p>}
            {shows('signup') && (
              <p className="fine">{employerFlow
                ? 'Your account lets you register a company. Domain verification and independent review are required before jobs can go live. Read our privacy information before continuing.'
                : 'By creating an account you agree to let Fortune Jobs AI store your profile so it can match jobs for you.'}</p>
            )}
            <p className="fine account-switch"><span>{side.switchLabel}</span> <a href={side.switchHref}>{side.switchText}</a></p>
            <p className="fine"><a href="terms.html">Terms</a> · <a href="privacy.html">Privacy</a> · <a href="contact.html">Need help?</a></p>
          </div>
        </main>
      </div>
    </div>
  );
}

/** login.html */
export function LoginPage() { return <AuthPage area="jobseeker" />; }
/** employer-login.html */
export function EmployerLoginPage() { return <AuthPage area="employer" />; }
