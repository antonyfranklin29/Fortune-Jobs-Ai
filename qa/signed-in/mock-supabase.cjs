// Fake Supabase backend for browser QA. Every request to the real project host
// is answered here; nothing leaves the test machine.
const SB = 'https://hqgakkcxcyspqhnlnscv.supabase.co';
const now = () => new Date().toISOString();
function makeDb({ signedIn = true, employer = 'none' } = {}) {
  const user = { id: '11111111-2222-4333-8444-555555555555', aud: 'authenticated', role: 'authenticated', email: 'qa-seeker@example.test', email_confirmed_at: now(), app_metadata: { provider: 'email' }, user_metadata: { full_name: 'QA Seeker' }, identities: [{ provider: 'email' }], created_at: now() };
  const jobs = [
    { job_title: 'Data Analyst', company: 'Example Health', location: 'Chicago, IL', salary: '$80,000 - $95,000', apply_url: 'https://jobs.example.test/1', employment_type: 'Full-time', work_mode: 'Hybrid', is_remote: false, posted_at: now(), category: 'it', country: 'us', job_description: 'We need SQL, Python and Tableau to build dashboards for finance partners across regions. 3+ years of experience.', source: 'employer', closed_at: null },
    { job_title: 'Senior Data Analyst', company: 'Example Bank', location: 'New York, NY', salary: null, apply_url: 'https://jobs.example.test/2', employment_type: 'Full-time', work_mode: 'On-site', is_remote: false, posted_at: now(), category: 'accounting', country: 'us', job_description: 'Excel, Power BI and SQL reporting for operations teams; stakeholder communication weekly.', source: 'employer', closed_at: null },
  ];
  const org = { id: 'org1', name: 'QA Synthetic Co', primary_domain: 'example.test', status: employer === 'verified' ? 'verified' : 'pending', domain_verified: employer === 'verified', active_limit: 15, active_posts: 0, posts: [], sources: [] };
  return { signedIn, user, jobs, calls: [], newsletter: { subscribed: false },
    tables: {
      profiles: [{ id: user.id, email: user.email, full_name: 'QA Seeker', current_title: 'Analyst', years_experience: 3, skills: ['SQL'], preferred_locations: ['Chicago'], job_types: ['fulltime'], avatar_url: null, resume_path: null, resume_name: null, resume_text: null, saved_filters: null }],
      saved_jobs: [], search_history: [], newsletter_preferences: [],
    },
    employerState: { orgs: employer === 'none' ? [] : [org], plan: { free_active_posts: 15, monthly_price_cents: 1499 } },
    storage: {} };
}
function session(db) {
  return { access_token: 'qa-access-token', refresh_token: 'qa-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: db.user };
}
function filterRows(rows, sp) {
  return rows.filter((r) => [...sp.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) return true;
    const m = /^eq\.(.*)$/.exec(v); if (m) return String(r[k]) === decodeURIComponent(m[1]);
    return true;
  }));
}
async function install(ctx, db) {
  await ctx.route(SB + '/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname; const method = req.method();
    const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch { return req.postData(); } })() : null;
    db.calls.push({ method, path: p + url.search, body });
    const json = (data, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range', ...headers }, body: data === null ? '' : JSON.stringify(data) });
    if (method === 'OPTIONS') return json(null, 204);
    if (p === '/auth/v1/settings') return json({ external: { google: true, email: true }, disable_signup: false });
    if (p === '/auth/v1/user') return db.signedIn ? json(db.user) : json({ msg: 'no session' }, 401);
    if (p === '/auth/v1/token') { if (body && body.password === 'wrong-password') return json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400); db.signedIn = true; return json(session(db)); }
    if (p === '/auth/v1/logout') { db.signedIn = false; return json(null, 204); }
    if (p === '/auth/v1/authorize') return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Google sign-in (mocked)</h1>' });
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.split('/').pop();
      if (fn === 'employer_my_state') return json(db.employerState);
      if (fn === 'operator_queue') return json({ code: '42501', message: 'operator_only' }, 403);
      return json({ message: 'not mocked' }, 404);
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.split('/').pop();
      if (table === 'pre_scraped_jobs') return json(db.jobs);
      const rows = db.tables[table]; if (!rows) return json({ message: 'unknown table' }, 404);
      const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
      if (method === 'GET') { const r = filterRows(rows, url.searchParams); return single ? (r[0] ? json(r[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406)) : json(r); }
      if (method === 'POST') {
        const items = (Array.isArray(body) ? body : [body]).map((x) => ({ id: table === 'profiles' ? x.id : crypto.randomUUID(), user_id: db.user.id, created_at: now(), ...x }));
        if (table === 'saved_jobs') for (const it of items) if (rows.some((r) => r.job_key === it.job_key)) return json({ code: '23505', message: 'duplicate key value violates unique constraint "saved_jobs_user_id_job_key_key"' }, 409);
        rows.push(...items); return single ? json(items[0], 201) : json(items, 201);
      }
      if (method === 'PATCH') { const r = filterRows(rows, url.searchParams); r.forEach((x) => Object.assign(x, body)); return single ? json(r[0]) : json(r); }
      if (method === 'DELETE') { const r = filterRows(rows, url.searchParams); db.tables[table] = rows.filter((x) => !r.includes(x)); return json(r); }
    }
    if (p.startsWith('/storage/v1/object/sign/')) return json({ signedURL: '/storage/v1/object/sign/resumes/qa.pdf?token=t' });
    if (p.startsWith('/storage/v1/object/') && method === 'POST' && !p.includes('/sign/')) { const key = p.replace('/storage/v1/object/', ''); db.storage[key] = true; return json({ Key: key, Id: 'x' }); }
    if (p.startsWith('/storage/v1/object/') && method === 'DELETE') return json([]);
    if (p === '/functions/v1/email-preferences') { if (method === 'POST') db.newsletter.subscribed = !!body.subscribed; return json({ subscribed: db.newsletter.subscribed, delivery_active: false }); }
    return json({ message: 'not mocked: ' + p }, 404);
  });
}
async function seedSession(ctx, db) {
  if (!db.signedIn) return;
  const value = JSON.stringify(session(db));
  await ctx.addInitScript((v) => { try { if (!sessionStorage.getItem('qa-seeded')) { sessionStorage.setItem('qa-seeded', '1'); localStorage.setItem('sb-hqgakkcxcyspqhnlnscv-auth-token', v); } } catch {} }, value);
}
module.exports = { makeDb, install, seedSession, SB };
