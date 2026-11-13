const fs = require('node:fs');
const path = require('node:path');
const app = path.resolve(__dirname, '..');
const site = path.resolve(app, '..');
const pub = path.join(app, 'public');
fs.mkdirSync(pub, { recursive: true });
for (const file of [
  'resume-extraction.mjs', 'resume-matching.js', 'job-titles.js', 'favicon.svg',
  'favicon.ico', 'favicon-96x96.png', 'apple-touch-icon.png', 'site.webmanifest',
  'icon-192.png', 'icon-512.png',
  'config.js', 'auth.js', 'account.css', 'newsletter-preferences.js',
  'guest-resume-page.js', 'guest-resume.js',
  'resume-builder.js', 'resume-builder-page.js', 'data-safety.js', 'search-accuracy.js',
  'company-brand-map.js', 'company-logos.js'
]) {
  fs.copyFileSync(path.join(site, file), path.join(pub, file));
}
for (const directory of ['vendor', 'assets']) {
  fs.cpSync(path.join(site, directory), path.join(pub, directory), { recursive: true, force: true });
}
fs.mkdirSync(path.join(pub, 'config'), { recursive: true });
for (const file of ['job-roles.json', 'us-regions.json']) {
  fs.copyFileSync(path.join(site, 'config', file), path.join(pub, 'config', file));
}
