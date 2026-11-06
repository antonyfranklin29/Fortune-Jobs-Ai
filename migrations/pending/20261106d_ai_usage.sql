-- AI features (supabase/functions/ai-assist): one row per AI call, used for the daily
-- limits and to see cost. Only the Edge Function (service role) writes it; signed-in
-- people can read their own rows. Rows outlive a deleted account (user_id becomes null)
-- so today's site-wide count can't drop when someone deletes their account.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
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

-- Atomic reservation: one lock for all AI calls, so parallel requests can't pass the
-- limits together. Returns {"id", "used"} or {"error": "user_limit" | "global_limit"}.
create or replace function public.ai_reserve(p_user uuid, p_task text, p_model text, p_user_limit integer, p_global_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  used_user integer; used_all integer; new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('fortune.ai_reserve'));
  select count(*) into used_all from public.ai_usage where created_at >= day_start;
  if used_all >= p_global_limit then return jsonb_build_object('error', 'global_limit'); end if;
  select count(*) into used_user from public.ai_usage where user_id = p_user and created_at >= day_start;
  if used_user >= p_user_limit then return jsonb_build_object('error', 'user_limit', 'used', used_user); end if;
  insert into public.ai_usage (user_id, task, model) values (p_user, p_task, p_model) returning id into new_id;
  return jsonb_build_object('id', new_id, 'used', used_user);
end $$;
revoke all on function public.ai_reserve(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_reserve(uuid, text, text, integer, integer) to service_role;

-- Check: rls = true, reserve_callable_by_anon = false
select (select relrowsecurity from pg_class where oid = 'public.ai_usage'::regclass) as rls,
       has_function_privilege('anon', 'public.ai_reserve(uuid, text, text, integer, integer)', 'execute') as reserve_callable_by_anon;
-- Rollback: drop function public.ai_reserve(uuid, text, text, integer, integer); drop table public.ai_usage;
