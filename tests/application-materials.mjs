import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('saved application drafts keep owner RLS, merge fields and disappear on account deletion', async () => {
  const db = new PGlite();
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const draft = time => ({ result: { summary: 'SQL project' }, identity: { name: 'Test Student' }, generated_at: time });
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; grant usage on schema auth, public to authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.users(id uuid primary key);
      create table public.ai_usage(task text check (task in ('tailor_resume','fit_explain')));
      create table public.saved_jobs(id int primary key, user_id uuid references auth.users(id) on delete cascade, job_key text, stage text default 'saved');
      alter table public.saved_jobs enable row level security;
      create policy owner_read on public.saved_jobs for select to authenticated using (user_id=auth.uid());
      create policy owner_update on public.saved_jobs for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
      grant select on public.saved_jobs to authenticated; grant update(stage) on public.saved_jobs to authenticated;
      insert into auth.users values ('${a}'),('${b}');
      insert into public.saved_jobs(id,user_id,job_key) values (1,'${a}','a'),(2,'${b}','b');`);
    await db.exec(readFileSync(new URL('../migrations/pending/20261118_saved_job_materials.sql', import.meta.url), 'utf8'));
    await db.exec("insert into public.ai_usage values ('cover_letter'), ('tailor_resume');");
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${a}';`);
    const save = async (key, kind, value) => (await db.query('select public.save_job_material($1,$2,$3::jsonb) as material', [key, kind, JSON.stringify(value)])).rows[0].material;
    await save('a', 'tailor_resume', draft('2026-11-18T12:00:00Z'));
    const merged = await save('a', 'cover_letter', draft('2026-11-18T12:01:00Z'));
    assert.deepEqual(Object.keys(merged).sort(), ['cover_letter', 'tailor_resume']);
    assert.equal(await save('a','tailor_resume', draft('2026-11-18T11:00:00Z')), null, 'older response cannot replace latest');
    assert.equal(await save('b','tailor_resume', draft('2026-11-18T12:00:00Z')), null, 'cross-user write denied');
    assert.equal(await save('unsaved','tailor_resume', draft('2026-11-18T12:00:00Z')), null);
    assert.equal((await db.query('select count(*)::int as n from public.saved_jobs')).rows[0].n, 1);
    await assert.rejects(save('a', 'other', draft('2026-11-18T12:00:00Z')), /Invalid application material/);
    await db.exec('reset role;');
    assert.equal((await db.query("select has_column_privilege('authenticated','public.saved_jobs','user_id','update') as allowed")).rows[0].allowed, false);
    await db.query('delete from auth.users where id=$1', [a]);
    assert.equal((await db.query('select count(*)::int as n from public.saved_jobs where id=1')).rows[0].n, 0);
    assert.equal((await db.query('select materials from public.saved_jobs where id=2')).rows[0].materials, null);
    const deletion = readFileSync(new URL('../supabase/functions/delete-account/index.ts', import.meta.url), 'utf8');
    assert.match(deletion, /purgeRows\("saved_jobs",/);
  } finally { await db.close(); }
});
