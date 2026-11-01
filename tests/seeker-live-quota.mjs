// Disposable embedded PostgreSQL. No production database or paid workflow calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);`);
  for (const file of [
    'migrations/20261013_live_search_gateway.sql',
    'migrations/20261013_live_search_admission_function.sql',
    'migrations/pending/20261031_seeker_live_search_quota.sql',
  ]) await db.exec(readFileSync(file, 'utf8'));
  await db.exec(`update public.live_search_limits set max_concurrent=500,
    per_client_per_minute=500, per_client_per_hour=500, per_client_per_day=500,
    global_per_hour=500, global_per_day=500, global_per_30_days=500,
    pro_billing_enabled=true, pro_monthly_searches=50, free_monthly_searches=3;`);

  const user = '12345678-1234-1234-1234-123456789abc';
  await db.query('insert into auth.users(id) values ($1)', [user]);
  await db.query(`insert into public.seeker_live_entitlements
    (user_id,status,period_start,period_end,provider_subscription_id)
    values ($1,'active',now()-interval '1 day',now()+interval '29 days','test-only')`, [user]);

  async function admit(id, hash, account = null) {
    const { rows } = await db.query('select public.live_search_try_admit($1,$2,$3,$4) as result',
      [id, hash, account, 'Data Analyst']);
    return rows[0].result;
  }
  async function settle(id, status) {
    await db.query('select public.live_search_settle($1,$2,$3)', [id, status, 'test']);
  }
  async function balance(hash, account = null) {
    const { rows } = await db.query('select public.live_search_quota_status($1,$2) as result', [account, hash]);
    return rows[0].result;
  }

  assert.equal((await balance('subscriber-ip', user)).remaining, 50);

  for (let i = 1; i <= 50; i++) {
    const id = `paid-${i}`;
    const result = await admit(id, 'subscriber-ip', user);
    assert.equal(result.admitted, true, `paid search ${i}`);
    assert.equal(result.remaining, 50 - i);
    await settle(id, 'completed');
  }
  const exhausted = await admit('paid-51', 'subscriber-ip', user);
  assert.equal(exhausted.reason, 'rate_limited_pro_month');
  assert.equal(exhausted.remaining, 0);
  assert.deepEqual(
    (({ plan, limit, used, remaining }) => ({ plan, limit, used, remaining }))(await balance('subscriber-ip', user)),
    { plan: 'seeker_pro', limit: 50, used: 50, remaining: 0 },
  );

  for (let i = 1; i <= 3; i++) {
    const id = `guest-${i}`;
    assert.equal((await admit(id, 'guest-ip')).admitted, true);
    await settle(id, 'completed');
  }
  assert.equal((await admit('guest-4', 'guest-ip')).reason, 'rate_limited_free_month');
  assert.equal((await balance('guest-ip')).remaining, 0);

  const first = await admit('failed-1', 'another-guest-ip');
  assert.equal(first.admitted, true);
  await settle('failed-1', 'failed');
  assert.equal((await admit('retry-1', 'another-guest-ip')).admitted, true,
    'a failed search releases its monthly reservation');

  await db.exec('update public.live_search_limits set global_per_30_days=55');
  assert.equal((await admit('over-global', 'new-ip')).reason, 'budget_month');
  const config = await db.query('select pro_monthly_searches,pro_billing_enabled from public.live_search_limits');
  assert.deepEqual(config.rows[0], { pro_monthly_searches: 50, pro_billing_enabled: true });
  console.log('seeker Live Search quota: 50 paid, 3 free, refunds, and global cap passed');
} finally {
  await db.close();
}
