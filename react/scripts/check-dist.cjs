const fs = require('node:fs');
const path = require('node:path');

const dist = path.resolve(__dirname, '..', 'dist');
const required = [
  'index.html', 'find-jobs.html', 'results.html', 'login.html',
  'employer-login.html', 'profile.html', 'employers.html',
  'resume-search.html', 'resume-builder.html', 'privacy.html',
  'terms.html', 'about.html', 'contact.html', 'email-preferences.html'
];
const missing = [];

for (const page of required) {
  const file = path.join(dist, page);
  if (!fs.existsSync(file)) { missing.push(page); continue; }
  const html = fs.readFileSync(file, 'utf8');
  if (!/<meta\s+name=["']robots["']\s+content=["']noindex\s*,\s*nofollow["']/i.test(html)) {
    missing.push(`${page} → pre-launch noindex tag`);
  }
  if (['index.html', 'find-jobs.html', 'results.html'].includes(page)) {
    let previous = -1;
    for (const helper of ['company-brand-map.js', 'company-logos.js', 'data-safety.js', 'search-accuracy.js']) {
      const index = html.indexOf(`src="./${helper}"`);
      if (index < 0 || index <= previous) missing.push(`${page} → ${helper} missing or out of order`);
      previous = index;
    }
  }
  for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    const ref = match[1].split(/[?#]/, 1)[0];
    if (!ref || ref.startsWith('#') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref)) continue;
    const resolved = new URL(ref, `https://site.invalid/${page}`);
    const target = path.resolve(dist, '.' + decodeURIComponent(resolved.pathname));
    if (!target.startsWith(dist + path.sep) || !fs.existsSync(target)) missing.push(`${page} → ${match[1]}`);
  }
}

if (missing.length) {
  console.error('Build has missing local pages or assets:\n' + missing.map(item => `  ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Verified ${required.length} built pages and their local assets.`);
}
