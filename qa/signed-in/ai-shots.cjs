// Screenshots of the AI features against the mocked backend (no real AI call).
//   node qa/signed-in/ai-shots.cjs <built site root> <screenshot dir>
const { chromium, devices } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const { makeDb, install, seedSession } = require('./mock-supabase.cjs');
const root = process.argv[2], shots = process.argv[3];
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const AI = {
  fit_explain: { fit: 'strong', headline: 'Strong fit: you match most of the core SQL and Power BI work.', strengths: ['5 years building Power BI dashboards with DAX', 'Daily SQL work against large datasets'], gaps: ['No Azure Synapse experience shown'], advice: 'Mention any Azure work in your summary before applying.' },
  tailor_resume: { summary: 'Data analyst with 5 years turning SQL and Power BI work into finance dashboards.', experience: [{ role: 'Data Analyst, Acme (2021–2025)', bullets: ['Built 20+ Power BI dashboards used by finance partners', 'Wrote SQL to model regional revenue'] }], skills: ['SQL', 'Power BI', 'Python'], keywords_added: ['finance partners'], not_supported: ['Tableau'] },
  interview_prep: { questions: [{ question: 'How do you validate a dashboard number?', type: 'technical', why_asked: 'Accuracy matters for finance.', answer_outline: 'Walk through your SQL reconciliation at Acme.' }], questions_to_ask: ['Who uses these dashboards most?'] },
  skill_gap: { ready_now: 'almost', have: ['SQL', 'Python'], gaps: [{ skill: 'Apache Spark', why: 'Most data engineer jobs ask for it.', how_to_learn: 'Databricks Academy free courses', weeks: 4 }], related_roles: ['BI Developer'] },
  job_post_writer: { summary: 'Join our data team.', responsibilities: ['Build pipelines'], requirements: ['3+ years SQL'], nice_to_have: [], missing_info: ['Salary range (required in NJ job ads)'] },
  candidate_shortlist: { ranking: [{ id: 2, label: 'B.K.', fit: 'strong', strengths: ['Spark at scale'], concerns: [] }, { id: 1, label: 'A.J.', fit: 'partial', strengths: ['SQL'], concerns: ['No cloud work shown'] }], note: 'Check each résumé yourself.' },
  smart_search: { q: 'Power BI Developer', location: 'New Jersey', work_mode: 'Remote', date_posted: '7' },
};
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(root, p), (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(p)] || 'application/octet-stream'); r.end(d); }); }).listen(8801, async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [vp, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['mobile', devices['iPhone 13']]]) {
    const db = makeDb({}); const ctx = await b.newContext(opts);
    await ctx.route(/^(?!http:\/\/localhost:8801|https:\/\/hqgakkcxcyspqhnlnscv\.supabase\.co).*/, (rt) => rt.abort());
    await install(ctx, db); await seedSession(ctx, db);
    await ctx.route('**/functions/v1/ai-assist', async (rt) => { const body = JSON.parse(rt.request().postData() || '{}'); await new Promise((r) => setTimeout(r, 300)); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task: body.task, result: AI[body.task] || {}, remaining: 24 }) }); });
    const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(vp + ': ' + e.message));
    await page.goto('http://localhost:8801/index.html'); await page.waitForSelector('#aiSmartSearch');
    await page.locator('.ai-smart-search').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/${vp}-home.png` });
    await page.fill('#aiSmartSearch', 'remote power bi jobs in nj this week'); await page.click('.ai-smart-search button');
    await page.waitForURL(/results\.html/); console.log(vp, 'smart search ->', page.url().replace('http://localhost:8801', ''));
    await page.goto('http://localhost:8801/results.html?mode=quick&q=Data+Analyst'); await page.waitForSelector('.featured-card-select');
    if (vp === 'mobile') await page.click('.featured-card-select');
    await page.waitForSelector('.ai-tools button'); await page.click('.ai-tools button >> nth=0'); await page.waitForSelector('.ai-result');
    await page.locator('.ai-tools').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/${vp}-fit.png` });
    for (const [i, name] of [[1, 'tailor'], [2, 'interview']]) { await page.click(`.ai-tools button >> nth=${i}`); await page.waitForSelector('.ai-result'); await page.locator('.ai-tools').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/${vp}-${name}.png`, fullPage: false }); }
    await page.goto('http://localhost:8801/profile.html#skill-plan'); await page.waitForSelector('.ai-skill-gap input');
    await page.fill('.ai-skill-gap input', 'Data Engineer'); await page.click('.ai-skill-gap form button'); await page.waitForSelector('.ai-plan');
    await page.locator('.ai-skill-gap').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/${vp}-skillplan.png` });
    await ctx.close();
    const db2 = makeDb({ employer: 'verified' }); const ctx2 = await b.newContext(opts);
    await ctx2.route(/^(?!http:\/\/localhost:8801|https:\/\/hqgakkcxcyspqhnlnscv\.supabase\.co).*/, (rt) => rt.abort());
    await install(ctx2, db2); await seedSession(ctx2, db2);
    await ctx2.route('**/functions/v1/ai-assist', (rt) => { const body = JSON.parse(rt.request().postData() || '{}'); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task: body.task, result: AI[body.task], remaining: 20 }) }); });
    const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errs.push(vp + ' employer: ' + e.message));
    await p2.goto('http://localhost:8801/employers.html'); await p2.waitForSelector('text=New job post');
    await p2.click('text=New job post'); await p2.click('text=Write the description with AI');
    await p2.getByLabel('Job title', { exact: true }).fill('Data Engineer');
    await p2.fill('#aiPostNotes', 'Azure, Spark, hybrid in Newark NJ'); await p2.click('text=Write description');
    await p2.waitForSelector('text=Salary range'); const desc = await p2.getByLabel('Description', { exact: true }).inputValue();
    console.log(vp, 'post writer filled description:', JSON.stringify(desc.slice(0, 60)));
    await p2.locator('#aiPostNotes').scrollIntoViewIfNeeded(); await p2.screenshot({ path: `${shots}/${vp}-postwriter.png` });
    console.log(vp, 'shortlist hidden:', (await p2.locator('text=AI candidate shortlist').count()) === 0);
    const wide = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); console.log(vp, 'employer sideways scroll:', wide);
    await ctx2.close();
  }
  console.log('errors:', errs.length ? errs : 'none'); await b.close(); srv.close();
});
