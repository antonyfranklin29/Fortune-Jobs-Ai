-- AI features (supabase/functions/ai-assist): one row per AI answer, used for the daily
-- limits and to see cost. Only the Edge Function (service role) reads or writes it; signed-in
-- people can read their own rows so the site can show "AI actions left today".
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  task text not null check (task in ('tailor_resume','fit_explain','smart_search','interview_prep','skill_gap','job_post_writer','candidate_shortlist')),
  model text not null check (char_length(model) <= 80),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_day on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_day on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
drop policy if exists ai_usage_own_read on public.ai_usage;
create policy ai_usage_own_read on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));

-- Check
select relrowsecurity from pg_class where oid = 'public.ai_usage'::regclass;
-- Rollback: drop table public.ai_usage;
