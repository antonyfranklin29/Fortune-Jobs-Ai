const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function api() {
  const sandbox = { module: { exports: {} }, URL, URLSearchParams };
  vm.runInNewContext(fs.readFileSync('source-tracking.js', 'utf8'), sandbox);
  return sandbox.module.exports;
}
const store = () => { const m = new Map(); return { getItem: k => m.get(k), setItem: (k,v) => m.set(k,v) }; };
test('first session attribution wins, supports ref and sanitises every field', () => {
  const a = api(), s = store();
  const first = a.capture('?utm_source=Instagram&utm_medium=SOCIAL!&utm_campaign=Fall%20<Launch>&ref=other', s);
  assert.equal(first.source, 'instagram'); assert.equal(first.medium, 'social'); assert.equal(first.campaign, 'falllaunch');
  assert.equal(a.capture('?utm_source=facebook', s).source, 'instagram');
  assert.equal(a.capture('?ref=Reddit', store()).source, 'reddit');
  assert.equal(a.capture('', store()).source, 'organic');
  assert.equal(a.clean('A'.repeat(100)).length, 40);
});
test('Jobg8 appends once without reserialising signed query text or fragments', () => {
  const a = api(), original = 'https://click.example/path?token=a%2fb+X&X=One%20Two#part';
  const url = a.appendJobg8(original, { source: 'instagram', campaign: 'launch' }, 'live');
  assert.equal(url, 'https://click.example/path?token=a%2fb+X&X=One%20Two&source=instagram&method=live&campaign=launch#part');
  assert.equal(a.appendJobg8(url, { source: 'facebook', campaign: 'other' }, 'search'), url);
  assert.match(a.appendJobg8('https://click.example/job', {}, 'match'), /source=organic&method=match$/);
});
test('WhatJobs URLs stay byte-identical and logging failure cannot block navigation', async () => {
  const a = api(), url = 'https://us.whatjobs.com/job?token=a%2fb+X&x=One%20Two', opened = [];
  const result = a.navigate({ source: 'whatjobs', apply_url: url }, { method: 'search', open: value => opened.push(value), log: () => Promise.reject(new Error('offline')) });
  await Promise.resolve(); assert.equal(result, url); assert.deepEqual(opened, [url]);
});
test('anonymous RPC bounds writes and never exposes private telemetry rows', async () => {
  const { PGlite } = await import('@electric-sql/pglite'); const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create table saved_jobs(id int);');
    await db.exec(fs.readFileSync('migrations/20261122_partner_clicks.sql','utf8'));
    const call = () => db.query("select log_partner_click('whatjobs','organic','search','',$1,'us') as ok", ['a'.repeat(64)]);
    await db.exec('set role anon'); assert.equal((await call()).rows[0].ok,true);
    await assert.rejects(db.query('select * from partner_clicks'), /permission denied/);
    await db.exec('reset role'); await db.exec('update partner_click_buckets set hits=300');
    await db.exec('set role anon'); assert.equal((await call()).rows[0].ok,false); await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as n from partner_clicks')).rows[0].n,1);
    const columns = (await db.query("select column_name from information_schema.columns where table_name='partner_clicks' order by ordinal_position")).rows.map(r=>r.column_name);
    assert.deepEqual(columns,['id','created_at','partner','source','method','campaign','job_key','country_hint']);
  } finally { await db.close(); }
});
