-- Pending review. Materials live on the existing owner-scoped saved_jobs row.
-- Deleting that row (including account deletion) removes both documents.
begin;
-- cover_letter uses the same ai_reserve and daily limits as the existing tasks.
alter table public.ai_usage drop constraint ai_usage_task_check;
alter table public.ai_usage add constraint ai_usage_task_check check (task in
  ('tailor_resume','cover_letter','fit_explain','smart_search','interview_prep',
   'skill_gap','job_post_writer','candidate_shortlist'));
alter table public.saved_jobs add column if not exists materials jsonb;
alter table public.saved_jobs add constraint saved_jobs_materials_object
  check (materials is null or (jsonb_typeof(materials) = 'object'
    and octet_length(materials::text) <= 524288));

-- The tracker migration grants column-level UPDATE. Keep that restriction and
-- the existing RLS policies, adding only this column to the grant.
grant update (materials) on public.saved_jobs to authenticated;

-- One field per write prevents a cover letter and résumé generated concurrently
-- from replacing one another. Invoker privileges and RLS both enforce ownership.
create or replace function public.save_job_material(p_job_key text, p_kind text, p_material jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare stored jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_kind not in ('tailor_resume', 'cover_letter') or p_kind is null
    or p_material is null or jsonb_typeof(p_material) <> 'object'
    or jsonb_typeof(p_material->'result') is distinct from 'object'
    or jsonb_typeof(p_material->'identity') is distinct from 'object'
    or nullif(p_material->>'generated_at', '') is null
    or octet_length(p_material::text) > 250000 then
    raise exception 'Invalid application material' using errcode = '22023';
  end if;
  -- Validate the timestamp before it participates in the concurrent-write check.
  perform (p_material->>'generated_at')::timestamptz;
  update public.saved_jobs
    set materials = jsonb_set(coalesce(materials, '{}'::jsonb), array[p_kind], p_material, true)
    where job_key = p_job_key and user_id = auth.uid()
      and coalesce((materials->p_kind->>'generated_at')::timestamptz, '-infinity'::timestamptz)
        <= (p_material->>'generated_at')::timestamptz
    returning materials into stored;
  return stored;
end;
$$;
revoke all on function public.save_job_material(text, text, jsonb) from public, anon;
grant execute on function public.save_job_material(text, text, jsonb) to authenticated;
commit;
