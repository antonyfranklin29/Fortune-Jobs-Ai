// Insert the Cloudflare Web Analytics beacon into every page's <head>.
//
// It goes in <head>, not before </body>, because build-search-pages.cjs rebuilds
// about.html from index.html's head plus a fresh body — a tag in the body would
// be dropped there. Re-running this is safe: a page that already has the beacon
// is left alone, and a changed token replaces the old tag.
//
//   node scripts/add-analytics.cjs <token>

const fs = require('node:fs');
const path = require('node:path');

const token = (process.argv[2] || '').trim();
if (!/^[A-Za-z0-9]{10,64}$/.test(token)) {
  console.error('Usage: node scripts/add-analytics.cjs <cloudflare-beacon-token>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const tag =
  `<!-- Cloudflare Web Analytics (privacy-friendly, no cookies) -->\n` +
  `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" ` +
  `data-cf-beacon='{"token": "${token}"}'></script>\n`;

const existing = /[ \t]*<!-- Cloudflare Web Analytics[\s\S]*?beacon\.min\.js[\s\S]*?<\/script>\n?/;

let changed = 0, skipped = 0;
for (const file of fs.readdirSync(root).filter((f) => f.endsWith('.html'))) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, 'utf8');

  if (existing.test(html)) {
    const next = html.replace(existing, tag);
    if (next === html) { skipped++; console.log(`  = ${file} (already current)`); continue; }
    fs.writeFileSync(full, next);
    changed++; console.log(`  ~ ${file} (token updated)`);
    continue;
  }

  if (!html.includes('</head>')) { console.log(`  ! ${file} (no </head>, skipped)`); continue; }
  fs.writeFileSync(full, html.replace('</head>', tag + '</head>'));
  changed++; console.log(`  + ${file}`);
}
console.log(`\n${changed} page(s) updated, ${skipped} already current.`);
console.log('Now run: node scripts/build-search-pages.cjs');
