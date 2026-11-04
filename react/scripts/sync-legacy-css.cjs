const fs = require('node:fs');
const path = require('node:path');

const project = path.resolve(__dirname, '../..');
const target = path.resolve(__dirname, '../src/generated');
fs.mkdirSync(target, { recursive: true });
for (const [page, name] of [['find-jobs.html', 'landing-base.css'], ['results.html', 'results-base.css']]) {
  const html = fs.readFileSync(path.join(project, page), 'utf8');
  const match = html.match(/<style>([\s\S]*?)<\/style>/i);
  if (!match) throw new Error(`Missing inline stylesheet: ${page}`);
  fs.writeFileSync(path.join(target, name), match[1].trim() + '\n');
}
