import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const files = [
  'tests/sql/supabase-shim.sql',
  'migrations/20261015_ingest_taxonomy.sql',
  'migrations/20261015_ingest_catalogue.sql',
  'migrations/20261015_ingest_feed.sql',
  'migrations/pending/20261016_employer_submissions.sql',
  'migrations/pending/20261016_employer_feed_runs.sql',
  'migrations/pending/20261017_employer_domain_checks.sql',
  'migrations/pending/20261017_employer_account_deletion.sql',
  'migrations/pending/20261017_employer_search_visibility.sql',
  'migrations/pending/20261017_employer_feed_publish_hardening.sql',
  'migrations/pending/20261017_employer_feed_registry_bridge.sql',
  'migrations/pending/20261018_employer_access_hardening.sql',
  'migrations/pending/20261019_employer_pending_account_cleanup.sql',
  'migrations/pending/20261019_employer_concurrency_hardening.sql',
  'migrations/pending/20261020_employer_post_actions.sql',
  'migrations/pending/20261021_employer_feed_concurrency_hardening.sql',
  'migrations/pending/20261022_employer_paused_post_state.sql',
  'migrations/pending/20261023_employer_refresh_workflow.sql',
  'migrations/pending/20261024_employer_url_conflicts.sql',
  'migrations/pending/20261025_employer_maintenance.sql',
  'migrations/pending/20261026_employer_email_domain_rule.sql',
  'migrations/pending/20261024_employer_routine_post_approval.sql',
  'migrations/pending/20261027_employer_reviewer_queue_details.sql',
];

const owner = '11111111-1111-1111-1111-111111111111';
const reviewer = '22222222-2222-2222-2222-222222222222';
const outsider = '33333333-3333-3333-3333-333333333333';

test('verified company publishes only first-party, low-risk jobs automatically', async () => {
  const db = new PGlite();
  try {
    for (const file of files) {
      try { await db.exec(await readFile(new URL('../' + file, import.meta.url), 'utf8')); }
      catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
    }
    const scalar = async (sql) => (await db.query(sql)).rows[0].value;
    await db.exec(`insert into auth.users (id,email,email_confirmed_at) values
      ('${owner}','hr@synthetic.example',now()),
      ('${reviewer}','reviewer@fortunejobsai.com',now()),
      ('${outsider}','outsider@other.example',now());
      insert into public.employer_operators(user_id) values ('${reviewer}');`);
    assert.equal(await scalar(`select has_function_privilege('anon','public.employer_submit_post(uuid)','EXECUTE') as value`),false);
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);
    const org = await scalar(`select public.employer_register_org('Synthetic Company','synthetic.example')->>'org_id' as value`);
    const job = async (url, description = 'Build useful dashboards and explain results to our product and operations teams.') => {
      const fields = {job_title:'Data Analyst', canonical_role:'data-analyst',state_code:'NJ',city:'Newark',
        description,apply_url:url,posting_date:new Date().toISOString().slice(0,10),
        closing_date:new Date(Date.now()+30*86400000).toISOString().slice(0,10)};
      return scalar(`select public.employer_save_post('${org}',null,'${JSON.stringify(fields)}'::jsonb)->>'id' as value`);
    };

    const pending = await job('https://jobs.synthetic.example/one');
    await db.exec(`select set_config('request.jwt.claim.sub','${outsider}',false)`);
    await assert.rejects(() => db.query(`select public.employer_submit_post('${pending}')`),/post_not_found/,
      'another signed-in user cannot submit the company post');
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);
    assert.equal(JSON.parse(await scalar(`select public.employer_submit_post('${pending}')::text as value`)).review,'manual',
      'an unverified company must remain in review');

    await db.exec(`select set_config('request.jwt.claim.sub','${outsider}',false)`);
    await assert.rejects(() => db.query('select public.operator_queue()'),/operator_only/,
      'ordinary users cannot read the reviewer queue');
    await db.exec(`select set_config('request.jwt.claim.sub','${reviewer}',false)`);
    const queue = JSON.parse(await scalar('select public.operator_queue()::text as value'));
    assert.equal(queue.orgs[0].registrant_email,'hr@synthetic.example');
    assert.equal(queue.posts[0].id,pending);
    assert.match(queue.posts[0].description,/Build useful dashboards/);
    assert.equal(queue.posts[0].apply_url,'https://jobs.synthetic.example/one');
    assert.equal(queue.posts[0].revision,1);

    await db.exec(`select public.operator_verify_domain('${org}','Independent company contact confirmed hiring authority')`);
    await db.exec(`select public.operator_set_org_status('${org}','verified','Independent company contact confirmed')`);
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);

    const ordinary = await job('https://jobs.synthetic.example/two');
    const published = JSON.parse(await scalar(`select public.employer_submit_post('${ordinary}')::text as value`));
    assert.equal(published.review,'automatic');
    assert.equal(published.published,true);
    assert.equal(await scalar(`select status as value from public.employer_posts where id='${ordinary}'`),'published');

    for (const [url, description] of [
      ['https://external.example/apply','Build useful dashboards and explain results to our product and operations teams.'],
      ['https://jobs.synthetic.example/three','Pay an application fee to get this job. Build dashboards for the team.'],
    ]) {
      const id = await job(url, description);
      const result = JSON.parse(await scalar(`select public.employer_submit_post('${id}')::text as value`));
      assert.equal(result.review,'manual');
      assert.equal(await scalar(`select status as value from public.employer_posts where id='${id}'`),'pending_review');
    }

    const riskyEdit = await scalar(`select public.employer_save_post('${org}','${ordinary}',
      '{"description":"Send a gift card before applying, then build dashboards for our product and operations teams."}'::jsonb)->>'id' as value`);
    assert.equal(riskyEdit,ordinary);
    assert.equal(JSON.parse(await scalar(`select public.employer_submit_post('${ordinary}')::text as value`)).review,'manual');
    assert.equal(await scalar(`select status as value from public.employer_posts where id='${ordinary}'`),'published',
      'risky edit must leave the previously approved live version unchanged');

    for (const number of [4,5]) {
      const id = await job(`https://jobs.synthetic.example/${number}`);
      const result = JSON.parse(await scalar(`select public.employer_submit_post('${id}')::text as value`));
      assert.equal(result.published,true);
    }
    const capped = await job('https://jobs.synthetic.example/six');
    assert.equal(JSON.parse(await scalar(`select public.employer_submit_post('${capped}')::text as value`)).review,'manual',
      'more than three automatic decisions in 24 hours require a reviewer');


    // The auto path must still use the same database quota as reviewer approval.
    for (let number=0;number<12;number++) {
      await db.exec(`update public.employer_audit set at=now()-interval '2 days' where action='auto_approved'`);
      const id = await job(`https://jobs.synthetic.example/quota-${number}`);
      assert.equal(JSON.parse(await scalar(`select public.employer_submit_post('${id}')::text as value`)).published,true);
    }
    assert.equal(await scalar(`select public.employer_active_count('${org}') as value`),15);
    await db.exec(`update public.employer_audit set at=now()-interval '2 days' where action='auto_approved'`);
    const sixteenth = await job('https://jobs.synthetic.example/quota-blocked');
    const blocked = JSON.parse(await scalar(`select public.employer_submit_post('${sixteenth}')::text as value`));
    assert.equal(blocked.published,false);
    assert.equal(blocked.state,'upgrade_required');
    assert.equal(await scalar(`select public.employer_active_count('${org}') as value`),15);
  } finally { await db.close(); }
});
