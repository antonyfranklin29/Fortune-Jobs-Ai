// Screenshots of the AI features against the mocked backend (no real AI call).
//   node qa/signed-in/ai-shots.cjs <built site root> <screenshot dir>
const { chromium, devices } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const { makeDb, install, seedSession } = require('./mock-supabase.cjs');
const root = process.argv[2], shots = process.argv[3];
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const AI = {
  fit_explain: { fit: 'strong', headline: 'Strong fit: you match most of the core SQL and Power BI work.', strengths: ['5 years building Power BI dashboards with DAX', 'Daily SQL work against large datasets'], gaps: ['No Azure Synapse experience shown'], advice: 'Mention any Azure work in your summary before applying.' },
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
    await ctx.close();
  }
  console.log('errors:', errs.length ? errs : 'none'); await b.close(); srv.close();
});
