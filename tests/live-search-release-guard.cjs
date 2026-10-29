// Release guard for Live Search. The direct Make webhook has no rate limits or budget, so
// Live Search may only be switched on when it goes through the gateway AND the old webhook
// address is gone from every public page (a page that still carries it lets anyone call it).
// Run: node --test tests/live-search-release-guard.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const flag = (html, name) => {
  const m = html.match(new RegExp(`^const ${name} = (true|false);`, 'm'));
  assert.ok(m, `${name} switch not found in results.html`);
  return m[1] === 'true';
};
const PAGES = fs.readdirSync(root).filter((f) => f.endsWith('.html') || (f.endsWith('.js') && !f.endsWith('.min.js')));
const MAKE_HOOK = /hook\.[a-z0-9]+\.make\.com\/[A-Za-z0-9]+/;

test('Live Search is never switched on over the direct Make webhook', () => {
  const html = read('results.html');
  const paused = flag(html, 'LIVE_SEARCH_PAUSED');
  const viaGateway = flag(html, 'LIVE_SEARCH_VIA_GATEWAY');
  if (paused) return;
  assert.equal(viaGateway, true, 'Unpausing Live Search requires LIVE_SEARCH_VIA_GATEWAY = true');
  const carrying = PAGES.filter((f) => MAKE_HOOK.test(read(f)));
  assert.deepEqual(carrying, [], 'Unpausing Live Search requires the old Make webhook address to be removed from every public page');
});

test('the pause is checked before any Live Search request is sent', () => {
  const html = read('results.html');
  const body = html.slice(html.indexOf('async function handleSearch('));
  const pause = body.indexOf("if (mode === 'live' && LIVE_SEARCH_PAUSED)");
  const gateway = body.indexOf('if (LIVE_SEARCH_VIA_GATEWAY)');
  const direct = body.indexOf('fetch(WEBHOOK_URL_LIVE');
  assert.ok(pause > 0, 'pause check missing from handleSearch');
  assert.ok(gateway < 0 || pause < gateway, 'pause must be checked before the gateway path');
  assert.ok(direct < 0 || pause < direct, 'pause must be checked before the direct webhook path');
});
