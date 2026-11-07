// Copies the functions ats-ingest needs from job-ingest/lib.mjs into ats-ingest/core.mjs, and
// job-ingest/config.mjs into ats-ingest/config.mjs, so the deployed worker is self-contained.
// Run after changing either source: node scripts/build-ats-core.cjs
const fs = require('fs'), path = require('path');
const fn = path.join(__dirname, '..', 'supabase', 'functions');
const src = fs.readFileSync(path.join(fn, 'job-ingest', 'lib.mjs'), 'utf8');
const names = ['compileRoles', 'titleMatchesRole', 'classifyRole', 'regionIndex', 'stateFromEvidence', 'canonicalUrl', 'parsePostedAt', 'dedupe'];
const tracking = src.match(/^const TRACKING = .*$/m)[0];
let out = '// GENERATED from ../job-ingest/lib.mjs by scripts/build-ats-core.cjs. Do not edit;\n// tests/ats-ingest.ts checks it matches the source.\n' + tracking + '\n\n';
for (const n of names) {
  const i = src.indexOf('export function ' + n + '(');
  if (i < 0) throw new Error('missing ' + n);
  const end = src.indexOf('\n}\n', i);
  out += src.slice(i, end + 2) + '\n';
}
fs.writeFileSync(path.join(fn, 'ats-ingest', 'core.mjs'), out);
fs.copyFileSync(path.join(fn, 'job-ingest', 'config.mjs'), path.join(fn, 'ats-ingest', 'config.mjs'));
