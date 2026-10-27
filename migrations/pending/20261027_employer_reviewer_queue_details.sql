-- Applied to production on 2026-10-27 after an approved change. Give an independent reviewer the actual submitted
-- revision before they decide whether a company or job can go public.
-- The queue remains restricted by employer_require_operator and excludes the
-- reviewer's own organizations. No table grants or publication rules change.
begin;

create or replace function public.operator_queue()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_require_operator(null);
begin
  return jsonb_build_object(
    'orgs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'domain', o.primary_domain,
        'status', o.status, 'domain_verified', o.domain_verified_at is not null,
        'registrant_email', a.email, 'created_at', o.created_at))
      from public.employer_orgs o
      join auth.users a on a.id = o.created_by
      where o.status = 'pending' and not public.employer_is_member(o.id, u)), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'org', o.name, 'org_domain', o.primary_domain,
        'org_status', o.status, 'job_title', p.job_title,
        'canonical_role', p.canonical_role, 'description', p.description,
        'city', p.city, 'state_code', p.state_code,
        'work_mode', p.work_mode, 'employment_type', p.employment_type,
        'posting_date', p.posting_date, 'closing_date', p.closing_date,
        'apply_url', p.apply_url, 'revision', p.revision,
        'status', p.status, 'changes', p.has_unreviewed_changes))
      from public.employer_posts p
      join public.employer_orgs o on o.id = p.org_id
      where (p.status = 'pending_review' or p.has_unreviewed_changes)
        and not public.employer_is_member(o.id, u)), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'org', o.name, 'adapter', s.adapter,
        'board_token', s.board_token,
        'requested_apply_hosts', s.requested_apply_hosts))
      from public.employer_sources s
      join public.employer_orgs o on o.id = s.org_id
      where s.status = 'pending' and not public.employer_is_member(o.id, u)), '[]'::jsonb));
end $$;

revoke all on function public.operator_queue() from public, anon;
grant execute on function public.operator_queue() to authenticated;

commit;
