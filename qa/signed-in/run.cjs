const { chromium, devices } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const { makeDb, install, seedSession } = require('./mock-supabase.cjs');
const root = process.argv[2], shots = process.argv[3], only = process.argv[4];
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp' };
const BASE = 'http://localhost:8800';
const results = [];
const go = (page, url) => page.goto(url).catch((e) => { if (!/ERR_ABORTED|interrupted/.test(e.message)) throw e; });
const rec = (area, check, ok, detail = '') => results.push({ area, check, ok, detail: String(detail).slice(0, 300) });
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(root, p), (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(p)] || 'application/octet-stream'); r.end(d); }); }).listen(8800, async () => {
  const b = await chromium.launch();
  for (const [vp, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['mobile', devices['iPhone 13']]]) {
    async function ctxWith(dbOpts) {
      const db = makeDb(dbOpts); const ctx = await b.newContext({ ...opts, acceptDownloads: true });
      await ctx.route(/^(?!http:\/\/localhost:8800|https:\/\/hqgakkcxcyspqhnlnscv\.supabase\.co).*/, (rt) => rt.abort());
      await install(ctx, db); await seedSession(ctx, db);
      const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
      return { db, ctx, page, errs };
    }
    const A = (area) => `${area} [${vp}]`;
    // 1. Signed out: saving a job asks to sign in and keeps the search
    { const { page, errs, ctx } = await ctxWith({ signedIn: false });
      await go(page, BASE + '/results.html?mode=quick&q=Data+Analyst&location=Chicago'); await page.waitForSelector('.react-save');
      await page.click('.react-save'); await page.waitForURL(/login\.html/);
      const u = new URL(page.url()); rec(A('Saved jobs'), 'signed-out Save keeps the search in next=', /q=Data/.test(u.searchParams.get('next') || ''), 'next=' + u.searchParams.get('next'));
      rec(A('Saved jobs'), 'no page errors', !errs.length, errs.join('; ')); await ctx.close(); }
    // 2. Email login (mock credentials) and Google button
    { const { page, db, errs, ctx } = await ctxWith({ signedIn: false });
      await go(page, BASE + '/login.html?next=' + encodeURIComponent('results.html?mode=quick&q=Nurse')); await page.waitForSelector('#email');
      await page.waitForFunction(() => !document.querySelector('.google-btn')?.disabled, null, { timeout: 5000 }).catch(() => {});
      rec(A('Login'), 'Google button enabled when provider is on', !(await page.isDisabled('.google-btn')));
      await page.fill('#email', 'qa-seeker@example.test'); await page.fill('#password', 'wrong-password'); await page.click('button[type=submit]');
      await page.waitForSelector('.msg, [role=alert], .status', { timeout: 4000 }).catch(() => {});
      rec(A('Login'), 'wrong password shows friendly error', /Wrong email or password/.test(await page.textContent('body')));
      await page.fill('#password', 'qa-password-123'); await page.click('button[type=submit]'); await page.waitForURL((u) => new URL(u).pathname === '/results.html', { timeout: 8000 }).catch(() => {});
      rec(A('Login'), 'email sign-in returns to next page with query', /results\.html\?mode=quick&q=Nurse/.test(page.url()), page.url().replace(BASE, ''));
      const tokenCall = db.calls.find((c) => c.path.startsWith('/auth/v1/token')); rec(A('Login'), 'password grant sent only to mocked Supabase', !!tokenCall);
      await go(page, BASE + '/login.html'); await page.waitForURL((u) => new URL(u).pathname !== '/login.html', { timeout: 5000 }).catch(() => {});
      rec(A('Login'), 'signed-in visitor on login.html is sent to profile', /profile\.html/.test(page.url()), page.url().replace(BASE, ''));
      await ctx.close();
      const g = await ctxWith({ signedIn: false });
      await go(g.page, BASE + '/employer-login.html'); await g.page.waitForFunction(() => !document.querySelector('.google-btn')?.disabled, null, { timeout: 5000 }).catch(() => {});
      await g.page.click('.google-btn'); await g.page.waitForURL(/authorize/, { timeout: 5000 }).catch(() => {});
      const au = new URL(g.page.url()); rec(A('Login'), 'employer Google redirect returns to login.html?next=employers.html', au.searchParams.get('provider') === 'google' && /login\.html\?next=employers\.html/.test(au.searchParams.get('redirect_to') || ''), au.searchParams.get('redirect_to'));
      await g.ctx.close(); }
    // 3. Signed-in seeker: save, duplicate, saved list, #saved link, history, profile edit, resume, export, email prefs, sign out
    { const { page, db, errs, ctx } = await ctxWith({ signedIn: true });
      await go(page, BASE + '/results.html?mode=quick&q=Data+Analyst&location=Chicago'); await page.waitForSelector('.react-save'); await page.waitForTimeout(500);
      await page.click('.react-save'); await page.waitForTimeout(500);
      rec(A('Saved jobs'), 'Save job stores the job', db.tables.saved_jobs.length === 1 && /Saved/.test(await page.textContent('.react-save')), (await page.textContent('body')).match(/Job saved[^\n]*|Could not[^\n]*/)?.[0]);
      // duplicate: job saved in another tab, this page doesn't know
      db.tables.saved_jobs.push({ ...db.tables.saved_jobs[0], id: 'dup', job_key: (await page.evaluate(() => 0)) || 'x' });
      db.tables.saved_jobs.pop();
      const histRows = db.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/rest/v1/search_history'));
      rec(A('Search history'), 'signed-in search is recorded in history', histRows.length >= 1, `${histRows.length} history inserts`);
      await go(page, BASE + '/index.html'); await page.waitForTimeout(400);
      const savedLink = vp === 'mobile' ? '.mobile-tabs a[href="./profile.html#saved"]' : '.nav-links a[href="./profile.html#saved"]';
      await page.click(savedLink); await page.waitForSelector('#saved .sjob', { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(800);
      const inView = await page.evaluate(() => { const r = document.getElementById('saved')?.getBoundingClientRect(); return r ? r.top < innerHeight && r.bottom > 0 && r.top >= -5 : false; });
      rec(A('Saved jobs'), 'Saved Jobs link lands on the saved list', inView, `scrollY=${await page.evaluate(() => scrollY)}`);
      rec(A('Saved jobs'), 'saved job listed on profile', (await page.locator('#saved .sjob').count()) === 1);
      await page.screenshot({ path: `${shots}/profile-saved-${vp}.png` });
      await page.click('#saved .sjob button:has-text("Remove")'); await page.waitForTimeout(500);
      rec(A('Saved jobs'), 'remove from profile', db.tables.saved_jobs.length === 0);
      rec(A('Search history'), 'history list shows the search', (await page.locator('#history li').count()) >= 1, await page.textContent('#history'));
      // profile edit
      await page.fill('#pName', 'QA Seeker Edited'); await page.fill('#pYears', '4.5'); await page.click('#profile button[type=submit]'); await page.waitForTimeout(500);
      rec(A('Profile'), 'save profile details', db.tables.profiles[0].full_name === 'QA Seeker Edited' && db.tables.profiles[0].years_experience === 4.5);
      await page.fill('#pYears', '99'); await page.click('#profile button[type=submit]'); await page.waitForTimeout(200);
      rec(A('Profile'), 'rejects 99 years', /between 0 and 60/.test(await page.textContent('#profile')));
      // resume upload + review + save
      await page.setInputFiles('#resumeInput', process.argv[5]); await page.waitForSelector('#resumeReview', { timeout: 15000 }).catch(() => {});
      const hasReview = await page.locator('#resumeReview').count();
      rec(A('Résumé'), 'PDF read in browser and review shown', hasReview === 1, hasReview ? await page.inputValue('#reviewTitle') : await page.textContent('#resume'));
      if (hasReview) { await page.click('text=Save reviewed profile'); await page.waitForTimeout(800);
        const p = db.tables.profiles[0]; rec(A('Résumé'), 'reviewed résumé saved (file + profile)', !!p.resume_path && Object.keys(db.storage).some((k) => k.startsWith('resumes/' + db.user.id)), p.resume_path);
        rec(A('Résumé'), 'résumé row shows extracted words', /words/.test(await page.textContent('#resume'))); }
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), page.click('text=Download my data')]);
      let exportOk = false; if (dl) { const f = await dl.path(); const data = JSON.parse(fs.readFileSync(f, 'utf8')); exportOk = data.profile?.id === db.user.id && Array.isArray(data.saved_jobs); }
      rec(A('Profile'), 'Download my data gives a JSON export', exportOk, dl ? dl.suggestedFilename() : 'no download: ' + await page.locator('text=Download my data').locator('xpath=..').textContent());
      // email preferences
      await page.click('text=Manage weekly emails'); await page.waitForURL(/email-preferences/); await page.waitForFunction(() => !document.getElementById('save')?.disabled, null, { timeout: 5000 }).catch(() => {});
      await page.check('#weekly'); await page.click('#save'); await page.waitForTimeout(500);
      rec(A('Email prefs'), 'signed-in opt-in saved', db.newsletter.subscribed === true && /Preference saved/.test(await page.textContent('#status')), await page.textContent('#status'));
      const prefCall = db.calls.find((c) => c.path === '/functions/v1/email-preferences' && c.method === 'POST'); rec(A('Email prefs'), 'consent version sent', prefCall?.body?.consent_version === 'weekly-v1');
      // résumé builder signed-in import
      await go(page, BASE + '/resume-builder.html'); await page.click('text=Review saved profile'); await page.waitForSelector('#profilePreview', { timeout: 5000 }).catch(() => {});
      rec(A('Résumé'), 'builder imports saved profile', (await page.locator('#profilePreview').count()) === 1);
      // sign out
      await go(page, BASE + '/profile.html'); await page.waitForSelector('text=Log out'); await page.click('text=Log out'); await page.waitForTimeout(800);
      rec(A('Profile'), 'Log out signs out and leaves profile', !/profile\.html/.test(page.url()) && !db.signedIn, page.url().replace(BASE, ''));
      await go(page, BASE + '/profile.html'); await page.waitForTimeout(800);
      rec(A('Profile'), 'profile after sign-out redirects to login', /login\.html\?next=profile\.html/.test(page.url()), page.url().replace(BASE, ''));
      rec(A('Seeker'), 'no page errors', !errs.length, errs.join('; '));
      await ctx.close(); }
    // 4. Duplicate save (saved in another tab)
    { const { page, db, ctx } = await ctxWith({ signedIn: true });
      await page.route('**/rest/v1/saved_jobs?select=job_key*', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
      await go(page, BASE + '/results.html?mode=quick&q=Data+Analyst'); await page.waitForSelector('.react-save'); await page.waitForTimeout(400);
      db.tables.saved_jobs.push({ id: 'x', user_id: db.user.id, job_key: 'data analyst|example health|https://jobs.example.test/1' });
      await page.click('.react-save'); await page.waitForTimeout(500);
      rec(A('Saved jobs'), 'already-saved job (other tab) shows as saved, not an error', /Saved/.test(await page.textContent('.react-save')), (await page.textContent('body')).match(/Job saved[^\n]*|Could not[^\n]*/)?.[0]);
      await ctx.close(); }
    // 5. Employer workspace: no company, pending, verified
    for (const employer of ['none', 'pending', 'verified']) {
      const { page, errs, ctx } = await ctxWith({ signedIn: true, employer });
      await go(page, BASE + '/employers.html'); await page.waitForTimeout(1500);
      const text = await page.textContent('body');
      const ok = employer === 'none' ? /Register|company/i.test(text) : /QA Synthetic Co/.test(text);
      rec(A('Employer'), `workspace renders (${employer})`, ok && !errs.length, (errs.join('; ') || text.replace(/\s+/g, ' ').slice(0, 160)));
      const sw = await page.evaluate(() => document.documentElement.scrollWidth); rec(A('Employer'), `no sideways scroll (${employer})`, sw <= (vp === 'mobile' ? 390 : 1280), sw);
      if (employer === 'verified') await page.screenshot({ path: `${shots}/employer-${vp}.png` });
      await ctx.close();
    }
  }
  fs.writeFileSync(shots + '/../results.json', JSON.stringify(results, null, 1));
  for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.area.padEnd(26) + r.check + (r.ok ? '' : '  → ' + r.detail));
  await b.close(); srv.close();
});
