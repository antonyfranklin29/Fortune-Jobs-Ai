// Tell Bing (and other IndexNow engines) which public pages changed, so they recrawl them now.
// Usage: node scripts/indexnow.mjs <changed file paths...>   (e.g. from git diff --name-only)
import { readFileSync, existsSync } from 'node:fs';

export const SITE = 'https://fortunejobsai.com';
export const KEY = '1f0e8b72f79c843779156477ed99e958';

// jobs/data-analyst/raleigh-nc/index.html -> https://fortunejobsai.com/jobs/data-analyst/raleigh-nc/
// Only indexable HTML pages count: pages marked noindex are skipped, and removed files are ignored.
export function urlsFor(files, read = file => existsSync(file) ? readFileSync(file, 'utf8') : null) {
  const urls = new Set();
  for (const file of files) {
    if (!/^((?:jobs|salaries|h1b)\/.*index\.html|index\.html|[a-z-]+\.html)$/.test(file) || file === 'results.html') continue;
    const html = read(file);
    if (!html || /<meta name="robots" content="noindex/.test(html)) continue;
    urls.add(SITE + '/' + file.replace(/index\.html$/, ''));
  }
  return [...urls].slice(0, 10000);
}

export async function ping(urls, fetchImpl = fetch) {
  if (!urls.length) return 'nothing to submit';
  const response = await fetchImpl('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: 'fortunejobsai.com', key: KEY, keyLocation: SITE + '/' + KEY + '.txt', urlList: urls }),
  });
  if (![200, 202].includes(response.status)) throw new Error('IndexNow returned HTTP ' + response.status);
  return urls.length + ' URLs submitted (HTTP ' + response.status + ')';
}

if (import.meta.url === 'file://' + process.argv[1]) console.log(await ping(urlsFor(process.argv.slice(2))));
