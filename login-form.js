const MODES = {
  signin: { title: 'Welcome back', sub: 'Sign in to see your profile, saved jobs and history.', btn: 'Sign in', pwLabel: 'Password', pwAuto: 'current-password' },
  signup: { title: 'Create your free account', sub: 'It takes 30 seconds. No credit card.', btn: 'Create account', pwLabel: 'Password', pwAuto: 'new-password' },
  forgot: { title: 'Reset your password', sub: "Enter your email and we'll send you a reset link.", btn: 'Send reset link' },
  reset:  { title: 'Choose a new password', sub: 'Pick something at least 8 characters long.', btn: 'Save new password', pwLabel: 'New password', pwAuto: 'new-password' }
};
let mode = 'signin';
const $ = id => document.getElementById(id);
let providerAvailability = {google:false};
let oauthBusy = false;
const incomingAuthError = FJAccountFlow.callbackError(location.search, location.hash);
// Area selects presentation/destination only. RPCs independently verify company
// membership and review permissions. No role is saved in user metadata.
const employerFlow = document.body.dataset.accountArea === 'employer'
  || FJAccountFlow.isEmployerNext(new URLSearchParams(location.search).get('next'));
if (employerFlow) {
  document.title = 'Employer sign in · Fortune Jobs AI';
  $('accountArea').textContent = 'EMPLOYER ACCOUNT';
  MODES.signin = { ...MODES.signin, title: 'Welcome back, employers', sub: 'Sign in to manage your company and job posts.' };
  MODES.signup = { ...MODES.signup, title: 'Create your employer account', sub: 'Start with a free account. Company verification follows.', btn: 'Create employer account' };
  $('signupNotice').textContent = 'Your account lets you register a company. Domain verification and independent review are required before jobs can go live. Read our privacy information before continuing.';
  // OAuth and email links return through the existing approved login URL.
  // Keep that callback page in employer context even when sign-in is cancelled.
  if (document.body.dataset.accountArea !== 'employer') {
    $('authSideTitle').textContent = 'Your next hire starts here.';
    $('authSideIntro').textContent = 'A dedicated workspace for your company, your job posts and your hiring team.';
    $('authPerk1').textContent = 'Register your company and verify its website domain.';
    $('authPerk2').textContent = 'Manage up to 15 active job posts free across your company.';
    $('authPerk3').textContent = 'Track drafts, approvals and live job posts in one place.';
    $('accountSwitchLabel').textContent = 'Looking for your next role?';
    $('accountSwitchLink').textContent = 'Job seeker sign in'; $('accountSwitchLink').href = 'login.html';
  }
}

// Only allow returning to our own pages (blocks redirects to other sites)
function nextPage(fallback) {
  const n = new URLSearchParams(location.search).get('next') || '';
  return employerFlow ? FJAccountFlow.employerNext(n) : FJAccountFlow.next(n, fallback);
}

function setMode(m) {
  mode = m;
  const c = MODES[m];
  document.querySelectorAll('[data-show]').forEach(el => {
    const shown = el.dataset.show.split(' ').includes(m);
    el.style.display = shown ? '' : 'none';
    el.querySelectorAll('input,select,textarea').forEach(input => { input.disabled = !shown; });
  });
  $('password').minLength = m === 'signin' ? 1 : 8;
  $('tabSignin').classList.toggle('active', m === 'signin');
  $('tabSignup').classList.toggle('active', m === 'signup');
  $('tabSignin').setAttribute('aria-selected', String(m === 'signin'));
  $('tabSignup').setAttribute('aria-selected', String(m === 'signup'));
  $('emailLabel').textContent = m === 'signin' ? 'Username (email)' : 'Email';
  $('authTitle').textContent = c.title;
  $('authSub').textContent = c.sub;
  $('submitBtn').textContent = c.btn;
  if (c.pwLabel) { $('passwordLabel').textContent = c.pwLabel; $('password').autocomplete = c.pwAuto; }
  $('password').type = 'password'; $('pwToggle').textContent = 'Show'; $('pwToggle').setAttribute('aria-label','Show password');
  hideMsg();
}

function showMsg(text, kind) { const m = $('msg'); m.textContent = text; m.className = `msg show ${kind || 'error'}`; }
function hideMsg() { $('msg').className = 'msg'; }
function busy(on) { $('submitBtn').disabled = on; if (on) $('submitBtn').innerHTML = '<span class="spinner"></span>'; else $('submitBtn').textContent = MODES[mode].btn; }

function togglePw() {
  const p = $('password'); const show = p.type === 'password';
  p.type = show ? 'text' : 'password';
  $('pwToggle').textContent = show ? 'Hide' : 'Show';
  $('pwToggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

function friendly(err) {
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

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!window.FJ) { showMsg('Accounts are temporarily unavailable. Please try again later.'); return; }
  if ($('submitBtn').disabled || oauthBusy) return;
  const email = $('email').value.trim();
  const password = $('password').value;
  if (mode !== 'reset' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showMsg('Please enter a valid email address.'); $('email').focus(); return; }
  if ((mode === 'signup' || mode === 'reset') && password.length < 8) { showMsg('Password must be at least 8 characters.'); $('password').focus(); return; }
  if (mode === 'signin' && !password) { showMsg('Please enter your password.'); $('password').focus(); return; }

  busy(true);
  try {
    if (mode === 'signin') {
      const { error } = await FJ.sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      location.href = nextPage('profile.html');
    } else if (mode === 'signup') {
      const full_name = $('fullName').value.trim().slice(0, 120);
      const { data, error } = await FJ.sb.auth.signUp({
        email, password,
        options: { data: { full_name }, emailRedirectTo: FJ.baseUrl() + 'login.html?next=' + encodeURIComponent(nextPage('profile.html')) }
      });
      if (error) throw error;
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('already registered');
      }
      if (data.session) { location.href = nextPage('profile.html?welcome=1'); return; }
      setMode('signin');
      $('email').value = email;
      showMsg(`Almost done! We sent a confirmation link to ${email}. Click it, then sign in here.`, 'ok');
    } else if (mode === 'forgot') {
      const { error } = await FJ.sb.auth.resetPasswordForEmail(email, { redirectTo: FJ.baseUrl() + 'login.html?mode=reset' + (employerFlow ? '&next=employers.html' : '') });
      if (error) throw error;
      showMsg(`If an account exists for ${email}, a reset link is on its way. Check your inbox.`, 'ok');
    } else if (mode === 'reset') {
      const { data: sessionData, error: sessionError } = await FJ.sb.auth.getSession();
      if (sessionError || !sessionData.session) { setMode('forgot'); showMsg('Your reset link has expired or is missing. Request a new link below.'); return; }
      const { error } = await FJ.sb.auth.updateUser({ password });
      if (error) throw error;
      showMsg('Password updated. Taking you to your account…', 'ok');
      setTimeout(() => { location.href = nextPage('profile.html'); }, 1200);
    }
  } catch (err) {
    showMsg(friendly(err));
  } finally {
    busy(false);
  }
});

async function signInWithProvider(provider) {
  if (provider !== 'google' || !window.FJ || oauthBusy || !providerAvailability[provider]) return;
  oauthBusy = true;
  $('googleBtn').disabled = true; $('submitBtn').disabled = true;
  $('providerStatus').textContent = 'Opening ' + 'Google' + ' securely…';
  try {
    const { error } = await FJ.sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: FJ.baseUrl() + 'login.html?next=' + encodeURIComponent(nextPage('profile.html')) }
    });
    if (error) throw error;
  } catch (error) { showMsg(friendly(error)); }
  finally {
    oauthBusy=false; $('submitBtn').disabled=false;
    $('googleBtn').disabled=!providerAvailability.google;
    $('providerStatus').textContent='You can also sign in with your email address.';
  }
}

// Grey out the Google button until it's switched on in Supabase
async function checkProviders() {
  try {
    const r = await fetch(`${FJ_CONFIG.url}/auth/v1/settings`, { headers: { apikey: FJ_CONFIG.key }, signal:AbortSignal.timeout(10000) });
    if(!r.ok)throw new Error('Provider settings unavailable');
    const s = await r.json();
    providerAvailability=FJAccountFlow.providers(s);
    $('providerStatus').textContent='Use an available provider or sign in with email.';
  } catch (e) { $('providerStatus').textContent='Other sign-in options could not be checked. You can try email below.'; }
  for(const provider of ['google']){
    $(provider+'Btn').disabled=!providerAvailability[provider];
    $(provider+'Note').style.display=providerAvailability[provider]?'none':'block';
  }
}

(async function init() {
  const params = new URLSearchParams(location.search);
  setMode(['signup', 'forgot', 'reset'].includes(params.get('mode')) ? params.get('mode') : 'signin');
  if (!window.FJ) { showMsg('Accounts are temporarily unavailable. Please try again later.'); return; }
  checkProviders();
  if(incomingAuthError)showMsg(incomingAuthError);

  // Arrived from a password-reset email
  FJ.sb.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') setMode('reset'); });

  try {
    const user = await FJ.user();
    if (user && mode !== 'reset' && !incomingAuthError) location.replace(nextPage('profile.html'));
    else if (!user && mode === 'reset') { setMode('forgot'); showMsg(incomingAuthError || 'Open a valid password-reset email link, or request a new one below.'); }
  } catch { showMsg('Your account session could not be checked. Please try again.'); }
})();
