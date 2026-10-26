const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const logos = require('../company-logos.js');

test('known employer marks resolve to local assets; lookalike names do not', () => {
  assert.equal(logos.urlFor({ company: 'CBRE' }), 'assets/company-logos/cbre.com.png');
  assert.equal(logos.urlFor({ company: 'Capital One' }), 'assets/company-logos/capitalone.com.png');
  assert.equal(logos.urlFor({ company: 'CBRE Staffing' }), null);
  assert.equal(logos.urlFor({ company: 'Capital One Recruiting LLC' }), null);
  for (const [, domain] of Object.entries({ cbre: 'cbre.com', capital: 'capitalone.com' })) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'company-logos', `${domain}.png`)));
  }
});

test('feed logo is accepted only from the expected HTTPS image location', () => {
  const logo = 'https://d2q79iu7y748jz.cloudfront.net/s/_squarelogo/96x96/example';
  const row = { company: 'Other Co', source_metadata: { company: { logos: { squareSizes: { url96: logo } } } } };
  assert.equal(logos.urlFor(row), logo);
  assert.equal(logos.urlFor({ ...row, source_metadata: JSON.stringify(row.source_metadata) }), logo);
  assert.equal(logos.urlFor({ ...row, source_metadata: { company: { logos: { square: 'https://evil.example/s/_squarelogo/a' } } } }), null);
  assert.equal(logos.urlFor({ ...row, source_metadata: { company: { logos: { square: 'http://d2q79iu7y748jz.cloudfront.net/s/_squarelogo/a' } } } }), null);
  assert.equal(logos.urlFor({ ...row, source_metadata: { company: { logos: { square: 'https://d2q79iu7y748jz.cloudfront.net/other/a' } } } }), null);
});

test('unknown employer falls back to a safe initial', () => {
  const escaped = value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const html = logos.html({ company: '<Unmapped Co>' }, escaped);
  assert.match(html, /&lt;/);
  assert.doesNotMatch(html, /<img/);
});

test('resolved catalogue logo is used only for the exact employer name and trusted CDN', () => {
  global.FJ_COMPANY_BRANDS = {
    'acme labs': 'https://img.logo.dev/acme.com?token=pk_public123',
    'evil company': 'https://untrusted.example/logo.png'
  };
  assert.equal(logos.urlFor({ company: 'Acme Labs' }), 'https://img.logo.dev/acme.com?token=pk_public123');
  assert.equal(logos.urlFor({ company: 'Acme Labs Staffing' }), null);
  assert.equal(logos.urlFor({ company: 'Evil Company' }), null);
  delete global.FJ_COMPANY_BRANDS;
});
