-- Apply after 20261021_employer_feed_concurrency_hardening.sql.
-- Project the backing listing's closed state accurately in the private workspace.
-- Preserve existing approval/suspension policy and mutation-time checks.
begin;
do $$ begin
 if position('feed_closed_approver_deleted' in pg_get_functiondef('public.employer_before_account_deleted()'::regprocedure))=0 then
  raise exception 'apply 20261021_employer_feed_concurrency_hardening first';
 end if;
end $$;
create or replace function public.employer_my_state()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := public.employer_caller();
begin
  return jsonb_build_object(
    'plan', (select jsonb_build_object('free_active_posts', free_active_posts, 'paid_plan_code', paid_plan_code,
               'monthly_price_cents', monthly_price_cents, 'currency', currency,
               'checkout_available', false, 'paid_publishing_enabled', paid_publishing_enabled)
               from employer_billing_config where id),
    'orgs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'primary_domain', o.primary_domain, 'status', o.status,
        'role', m.role, 'domain_verified', o.domain_verified_at is not null,
        'dns_record', '_fortunejobsai.' || o.primary_domain,
        'dns_value', 'fortunejobsai-verify=' || c.token,
        'active_posts', public.employer_active_count(o.id),
        'active_limit', public.employer_active_limit(o.id),
        'entitlement', (select jsonb_build_object('plan_code', e.plan_code, 'status', e.status, 'paid_through', e.paid_through)
                          from employer_entitlements e where e.org_id = o.id),
        'posts', coalesce((select jsonb_agg(jsonb_build_object(
            'id', p.id, 'status', case when p.status='published' and (j.id is null or j.closed_at is not null) then 'paused' else p.status end, 'publish_state', p.publish_state, 'job_title', p.job_title,
            'canonical_role', p.canonical_role, 'state_code', p.state_code, 'city', p.city,
            'work_mode', p.work_mode, 'employment_type', p.employment_type, 'description', p.description,
            'apply_url', p.apply_url, 'posting_date', p.posting_date, 'closing_date', p.closing_date,
            'has_unreviewed_changes', p.has_unreviewed_changes, 'review_note', p.review_note,
            'can_activate', coalesce(o.status = 'verified' and (p.status in ('approved','paused','closed') or (p.status='published' and j.closed_at is not null))
                and not p.has_unreviewed_changes and p.reviewed_revision = p.revision
                and (p.closing_date + 1)::timestamptz > now(), false),
            'keep_on_downgrade', p.keep_on_downgrade, 'updated_at', p.updated_at) order by p.updated_at desc)
            from employer_posts p left join pre_scraped_jobs j on j.id=p.published_job_id and j.employer_post_id=p.id where p.org_id = o.id), '[]'::jsonb),
        'sources', coalesce((select jsonb_agg(jsonb_build_object(
            'id', s.id, 'adapter', s.adapter, 'api_region', s.api_region, 'board_token', s.board_token,
            'status', s.status, 'enabled', s.enabled, 'authorization_expires_at', s.authorization_expires_at,
            'requested_apply_hosts', s.requested_apply_hosts, 'allowed_apply_hosts', s.allowed_apply_hosts,
            'candidates', (select count(*) from employer_feed_candidates fc where fc.source_id = s.id),
            'selected', (select count(*) from employer_feed_candidates fc where fc.source_id = s.id and fc.selected)))
            from employer_sources s where s.org_id = o.id), '[]'::jsonb)
      ) order by o.created_at)
      from employer_orgs o
      join employer_org_members m on m.org_id = o.id and m.user_id = u and m.status = 'active'
      left join employer_domain_challenges c on c.org_id = o.id), '[]'::jsonb));
end $$;




commit;
