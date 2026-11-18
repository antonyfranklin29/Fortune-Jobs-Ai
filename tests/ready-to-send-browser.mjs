// Built-site QA with fictional data and all external requests intercepted.
// Start React preview on :8891, then set PLAYWRIGHT_MODULE to a Playwright installation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../', import.meta.url);
const out = name => new URL(name, root).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'taylor@example.com', aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-11-01T00:00:00Z' };
const profile = { id: user.id, full_name: 'Taylor Morgan', phone: '202-555-0148', skills: ['SQL', 'Power BI'], current_title: 'Data Analyst',
  resume_text: 'Taylor Morgan\nEducation\nExample University\nB.S. Information Systems, 2026\nSkills\nSQL, Power BI' };
const resume = { summary: 'Information systems graduate with experience building SQL queries and Power BI reports for coursework.',
  experience: [{ role: 'University reporting project | 2026', bullets: ['Used SQL to explore a sample sales dataset and check data quality.', 'Built a Power BI report to present the results to classmates.'] }],
  skills: ['SQL', 'Power BI'], keywords_added: ['data quality'], not_supported: ['Professional AWS experience'] };
const letter = { greeting: 'Dear Hiring Team,', paragraphs: ['I am applying for the Data Analyst role at Example Analytics. My information systems coursework includes SQL queries and Power BI reports.',
  'For a university project, I explored a sample sales dataset, checked data quality and built a report to present the results to classmates.',
  'I would welcome a conversation about how I could contribute to your reporting work. Thank you for considering my application.'], closing: 'Kind regards,', not_supported: ['Professional AWS experience'] };
const job = { id: 1, job_title: 'Data Analyst', company: 'Example Analytics', location: 'Edison, NJ', country: 'us', source: 'employer_direct',
  apply_url: 'https://example.com/jobs/analyst', employment_type: 'Full-time', posted_at: new Date().toISOString(),
  job_description: 'Use SQL to check data quality and Power BI to build reporting dashboards. Present findings to colleagues. This fictional listing is used for local interface testing.' };
const key = [job.job_title, job.company, job.apply_url].map(value => value.toLowerCase()).join('|');
const saved = { ...job, id: 10, job_key: key, user_id: user.id, materials: {}, stage: 'saved', created_at: new Date().toISOString() };
let isSaved = false;
const aiCalls = [], scripts = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const token = [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800, role: 'authenticated' })).toString('base64url'), 'fixture'].join('.');
  await context.addInitScript(({ token, user }) => localStorage.setItem('sb-hqgakkcxcyspqhnlnscv-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user })), { token, user });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') { if (url.pathname.endsWith('.js')) scripts.push(url.pathname); return route.continue(); }
    if (!url.hostname.endsWith('.supabase.co')) return route.abort();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let value = [];
    if (url.pathname.endsWith('/auth/v1/user')) value = user;
    else if (url.pathname.endsWith('/functions/v1/ai-assist')) {
      const { task } = route.request().postDataJSON(); aiCalls.push(task);
      value = { ok: true, result: task === 'cover_letter' ? letter : resume, remaining: 24 - aiCalls.length };
    } else if (url.pathname.endsWith('/rest/v1/profiles')) value = [profile];
    else if (url.pathname.endsWith('/rest/v1/pre_scraped_jobs')) value = [job];
    else if (url.pathname.endsWith('/rest/v1/saved_jobs')) {
      if (route.request().method() === 'POST') isSaved = true;
      value = isSaved ? [saved] : [];
    }
    else if (url.pathname.endsWith('/rest/v1/rpc/save_job_material')) {
      const args = route.request().postDataJSON();
      if (isSaved) saved.materials[args.p_kind] = args.p_material;
      value = isSaved ? saved.materials : null;
    }
    if (route.request().headers().accept?.includes('vnd.pgrst.object') && Array.isArray(value)) value = value[0] || null;
    return route.fulfill({ status: 200, headers, body: JSON.stringify(value) });
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8891/results.html?mode=quick&q=Data+Analyst');
  await page.getByRole('button', { name: '✨ Tailor my résumé', exact: true }).click();
  await page.getByText(resume.summary, { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Write a cover letter/ }).count(), 1);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Taylor Morgan[\s\S]*Example University/);
  assert.ok(!scripts.some(path => path.includes('applicationDocx')), 'Word library stays out of the initial page load');
  const resumeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  await mkdir(new URL('docs/samples/', root), { recursive: true });
  await (await resumeDownload).saveAs(out('docs/samples/tailored-resume.docx'));
  assert.ok(scripts.some(path => path.includes('applicationDocx')), 'Word library loads only for download');
  await page.getByRole('button', { name: 'Save job', exact: true }).first().click();
  await page.getByText('Job saved to your profile.', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Write a cover letter/ }).click();
  await page.getByText(letter.greeting, { exact: true }).waitFor();
  const letterDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  await (await letterDownload).saveAs(out('docs/samples/cover-letter.docx'));
  await mkdir(new URL('docs/screenshots/', root), { recursive: true });
  await page.setViewportSize({ width: 1440, height: 2600 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const detail = await page.locator('.featured-detail').boundingBox();
  await page.screenshot({ path: out('docs/screenshots/ready-to-send.png'), clip: { ...detail, height: Math.min(detail.height, 1450) } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('region', { name: 'Fortune AI Coach for this job' }).scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 390, height: 3200 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const coach = await page.getByRole('region', { name: 'Fortune AI Coach for this job' }).boundingBox();
  await page.screenshot({ path: out('docs/screenshots/ready-to-send-mobile.png'), clip: coach });
  await page.goto('http://127.0.0.1:8891/profile.html#saved');
  await page.getByRole('button', { name: 'Cover letter ✓', exact: true }).click();
  await page.getByText(letter.greeting, { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Résumé ✓', exact: true }).count(), 1);
  assert.deepEqual(aiCalls, ['tailor_resume', 'cover_letter']);
  assert.deepEqual(Object.keys(saved.materials).sort(), ['cover_letter', 'tailor_resume']);
  console.log('Built-site QA passed: both tools, copy, two browser downloads, mobile fit and tracker reopen. All remote calls were stubbed.');
} finally { await browser.close(); }
