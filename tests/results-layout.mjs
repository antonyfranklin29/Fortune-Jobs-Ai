// Results page list + selected-job detail, in a real browser with every network call stubbed.
// Proves that:
//   - desktop shows a list and a detail panel for the selected job, and selection follows clicks and the keyboard;
//   - without a profile no fit number is shown anywhere (no invented scores);
//   - with a profile, the fit shown equals resume-matching.js and its parts add up to it;
//   - on a phone the details open under the tapped job, close on a second tap, and nothing scrolls sideways.
// Run: node tests/results-layout.mjs   (needs Playwright and Chromium, like live-search-client-states.mjs)
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const FJResume = require(join(root, 'resume-matching.js'));

const now = Date.now();
// Test rows only; never shown on the site.
const ROWS = [
  { job_title: 'Data Analyst', company: 'Example Health', location: 'Raleigh, NC', salary: '$80,000–$95,000', apply_url: 'https://www.adzuna.com/details/1',
    employment_type: 'Full-time', work_mode: 'hybrid', is_remote: false, posted_at: new Date(now - 5 * 3600e3).toISOString(), country: 'us', source: 'adzuna',
    job_description: 'We need a data analyst with SQL, Python and Tableau to build reporting for clinical operations. 3+ years of experience required. You will partner with finance and operations teams.' },
  { job_title: 'Senior Data Analyst', company: 'Example Retail', location: 'Austin, TX', salary: null, apply_url: 'https://jobs.example.com/2',
    employment_type: 'Contract', work_mode: 'remote', is_remote: true, posted_at: new Date(now - 30 * 3600e3).toISOString(), country: 'us', source: 'adzuna',
    job_description: 'Senior data analyst role using SQL, Snowflake and Looker. 7+ years of experience. Own pricing analytics and present findings to leadership every week.' },
  { job_title: 'Data Analyst', company: 'Example Bank', location: 'Charlotte, NC', salary: null, apply_url: 'https://www.adzuna.com/details/3',
    employment_type: null, work_mode: null, is_remote: false, posted_at: new Date(now - 50 * 3600e3).toISOString(), country: 'us', source: 'adzuna',
    job_description: 'Short listing.' },
];
const PROFILE = { match_id: '11111111-2222-3333-4444-555555555555', current_title: 'Data Analyst', years_experience: 4,
  skills: ['SQL', 'Python', 'Excel'], roles: ['Data Analyst'], city: '', region: '', country: 'us', scope: 'city' };

const server = http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = readFileSync(join(root, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });

let failures = 0;
const check = (name, ok, detail = '') => { if (ok) console.log(`ok   ${name}`); else { failures++; console.log(`FAIL ${name} ${detail}`); } };

async function open({ width, height, profile }) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (u.includes('/rest/v1/pre_scraped_jobs')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(ROWS) });
    if (u.includes('supabase.co')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: u.includes('/auth/') ? '{}' : '[]' });
    if (u.includes('jsdelivr')) return route.continue().catch(() => {});
    return route.abort();
  });
  if (profile) await page.addInitScript((p) => sessionStorage.setItem('fj_guest_resume_v1', JSON.stringify({ expires: Date.now() + 3600e3, profile: p })), PROFILE);
  const qs = new URLSearchParams({ q: 'data analyst', mode: 'quick', ...(profile ? { resume: '1', resume_id: PROFILE.match_id } : {}) });
  await page.goto(`${base}/results.html?${qs}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.job-card', { timeout: 20000 });
  return { ctx, page, errors };
}

try {
  // Desktop, no profile.
  {
    const { ctx, page, errors } = await open({ width: 1440, height: 900, profile: false });
    const cards = await page.locator('#jobsGrid .job-card').count();
    check('desktop: every listing is in the list', cards === ROWS.length, `cards=${cards}`);
    const first = await page.locator('#jobDetail .detail-title').textContent();
    const firstCard = await page.locator('#jobsGrid .job-card').first().locator('.job-title').textContent();
    check('desktop: the first job is selected and shown in the detail panel', first === firstCard, `${first} vs ${firstCard}`);
    await page.locator('#jobsGrid .job-card').nth(2).locator('.job-summary').click();
    const company = await page.locator('#jobDetail .detail-company').textContent();
    const thirdCompany = await page.locator('#jobsGrid .job-card').nth(2).locator('.job-company').textContent();
    const expanded = await page.locator('.job-summary[aria-expanded="true"]').count();
    check('desktop: clicking a job shows it, and only it is marked expanded', company === thirdCompany && expanded === 1, `${company} vs ${thirdCompany}, expanded=${expanded}`);
    await page.locator('#jobsGrid .job-card').nth(1).locator('.job-summary').focus();
    await page.keyboard.press('Enter');
    const viaKeyboard = await page.locator('#jobDetail .detail-company').textContent();
    check('desktop: a job can be selected with the keyboard', viaKeyboard === (await page.locator('#jobsGrid .job-card').nth(1).locator('.job-company').textContent()));
    const numbers = await page.locator('.fit-chip, .fit-total, .fit-meter').count();
    const text = await page.locator('#resultsSection').innerText();
    check('no profile: no fit number is shown anywhere', numbers === 0 && !/\d+\s*\/\s*100/.test(text), `fit elements=${numbers}`);
    await page.locator('#jobsGrid .job-card', { hasText: 'Example Health' }).locator('.job-summary').click();
    const detail = await page.locator('#jobDetail').innerText();
    check('desktop: the detail shows the listing\'s own facts and apply route', /\$80,000–\$95,000/.test(detail) && /Full-time/.test(detail) && /Hybrid/.test(detail) && /Apply on Adzuna/.test(detail) && /clinical operations/.test(detail), detail.slice(0, 200));
    check('desktop: no page errors', errors.length === 0, errors.join('; '));
    await ctx.close();
  }
  // Desktop, with a profile.
  {
    const { ctx, page, errors } = await open({ width: 1440, height: 900, profile: true });
    const titles = await page.locator('#jobsGrid .job-card .job-summary .job-title').allTextContents();
    const companies = await page.locator('#jobsGrid .job-card .job-summary .job-company').allTextContents();
    let consistent = true; let checked = 0;
    for (let i = 0; i < titles.length; i++) {
      const row = ROWS.find((r) => r.job_title === titles[i] && r.company === companies[i]);
      const expected = FJResume.assess(row, PROFILE, () => ({}));
      const chip = page.locator('#jobsGrid .job-card').nth(i).locator('.fit-chip.top');
      const shown = await chip.count() ? await chip.textContent() : '';
      if (expected) { checked++; if (!shown.startsWith(String(expected.score))) consistent = false; }
      else if (/\d/.test(shown)) consistent = false;
    }
    check('profile: every fit chip equals the résumé matcher, and sparse listings get no number', consistent && checked > 0, `checked=${checked}`);
    const parts = await page.evaluate(() => {
      const total = Number(document.querySelector('#jobDetail .fit-total strong')?.textContent);
      const spans = [...document.querySelectorAll('#jobDetail .fit-parts dt span')].map((s) => Number(s.textContent.replace('−', '-').split(' ')[0]));
      return { total, spans };
    });
    const sum = parts.spans.reduce((a, b) => a + b, 0);
    check('profile: the fit parts add up to the total shown', Number.isFinite(parts.total) && sum === parts.total, JSON.stringify(parts));
    check('profile: no page errors', errors.length === 0, errors.join('; '));
    await ctx.close();
  }
  // Phone.
  {
    const { ctx, page, errors } = await open({ width: 390, height: 844, profile: true });
    check('phone: the side panel is not used', !(await page.locator('#jobDetail').isVisible()) || (await page.locator('#jobDetail').innerHTML()) === '');
    const card = page.locator('#jobsGrid .job-card').nth(1);
    await card.locator('.job-summary').click();
    const open1 = await card.locator('.card-detail').isVisible();
    const applyVisible = await card.locator('.card-detail .apply-btn').isVisible();
    await card.locator('.job-summary').click();
    const closed = !(await card.locator('.card-detail').isVisible());
    check('phone: tapping a job opens its details under it, with Apply; tapping again closes them', open1 && applyVisible && closed);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('phone: nothing scrolls sideways', overflow <= 0, `overflow=${overflow}px`);
    check('phone: no page errors', errors.length === 0, errors.join('; '));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
