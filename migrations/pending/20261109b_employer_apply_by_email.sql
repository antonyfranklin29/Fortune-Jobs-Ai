-- Employer jobs without an application link: candidates apply by email.
--
-- A post may give an apply_email instead of an apply link. The address must be on the
-- company's verified domain (e.g. recruiter@vendorco.com for vendorco.com), so a post can
-- never send résumés to a Gmail or look-alike address. The post's apply_url is then set to
-- our own page, https://fortunejobsai.com/apply.html?job=<post id>, so the job catalogue,
-- duplicate checks, saved jobs and reviewer emails keep working unchanged. That page reads
-- the address with employer_apply_info(), only while the job is live, and opens the job
-- seeker's own email program. Nothing about the applicant is sent to or stored by us.
-- Apply after 20261108_employer_work_email_verify.sql.

alter table public.employer_posts
  add column if not exists apply_email text
  check (apply_email is null or (char_length(apply_email) <= 254 and apply_email ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$'));

create or replace function public.employer_apply_page(p_post uuid) returns text
language sql immutable as $$ select 'https://fortunejobsai.com/apply.html?job=' || p_post::text $$;

create or replace function public.employer_posts_apply_method() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare dom text;
begin
  new.apply_email := nullif(lower(btrim(coalesce(new.apply_email, ''))), '');
  if new.apply_email is not null then
    select lower(primary_domain) into dom from employer_orgs where id = new.org_id;
    if split_part(new.apply_email, '@', 2) <> dom and split_part(new.apply_email, '@', 2) not like '%.' || dom then
      raise exception 'apply_email_domain_mismatch' using detail = dom;
    end if;
    new.apply_url := public.employer_apply_page(new.id);
  elsif new.apply_url is null or new.apply_url = public.employer_apply_page(new.id) then
    raise exception 'apply_link_required';
  end if;
  return new;
end $$;

drop trigger if exists employer_posts_apply_method on public.employer_posts;
create trigger employer_posts_apply_method before insert or update of apply_email, apply_url on public.employer_posts
  for each row execute function public.employer_posts_apply_method();

-- Same as before, plus apply_email. On edit, a missing apply_email key keeps the current method;
-- an empty string switches back to a link.
create or replace function public.employer_save_post(p_org uuid, p_post uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare u uuid := public.employer_caller(); p employer_posts; f jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  if not public.employer_is_member(p_org, u) then raise exception 'not_a_member' using errcode = '42501'; end if;
  if (select status from employer_orgs where id = p_org) in ('rejected','suspended') then raise exception 'organization_inactive'; end if;
  if p_post is null then
    if (select count(*) from employer_posts where org_id = p_org and status in ('draft','pending_review')) >= 50 then
      raise exception 'too_many_open_drafts';
    end if;
    insert into employer_posts (org_id, created_by, job_title, canonical_role, state_code, city, work_mode,
                                employment_type, description, apply_url, apply_email, posting_date, closing_date)
    values (p_org, u, btrim(f->>'job_title'), f->>'canonical_role', upper(f->>'state_code'), btrim(f->>'city'),
            coalesce(f->>'work_mode', 'onsite'), coalesce(f->>'employment_type', 'Full-time'),
            btrim(f->>'description'), nullif(btrim(f->>'apply_url'), ''), f->>'apply_email', (f->>'posting_date')::date, (f->>'closing_date')::date)
    returning * into p;
    perform public.employer_audit_log(u, 'employer', p_org, 'post', p.id::text, 'created');
  else
    select * into p from employer_posts where id = p_post and org_id = p_org for update;
    if not found then raise exception 'post_not_found'; end if;
    if p.status = 'closed' then raise exception 'post_closed'; end if;
    update employer_posts set
      job_title       = coalesce(btrim(f->>'job_title'), job_title),
      canonical_role  = coalesce(f->>'canonical_role', canonical_role),
      state_code      = coalesce(upper(f->>'state_code'), state_code),
      city            = coalesce(btrim(f->>'city'), city),
      work_mode       = coalesce(f->>'work_mode', work_mode),
      employment_type = coalesce(f->>'employment_type', employment_type),
      description     = coalesce(btrim(f->>'description'), description),
      apply_email     = case when f ? 'apply_email' then f->>'apply_email' else apply_email end,
      apply_url       = case when f ? 'apply_email' and nullif(btrim(f->>'apply_email'), '') is not null then apply_url
                             else coalesce(nullif(btrim(f->>'apply_url'), ''), apply_url) end,
      posting_date    = coalesce((f->>'posting_date')::date, posting_date),
      closing_date    = coalesce((f->>'closing_date')::date, closing_date),
      revision        = revision + 1,
      -- A published or approved post keeps its public version; the edit waits for review.
      status          = case when status in ('rejected','approved') then 'draft' else status end,
      -- Only a live (or paused) version needs a separate review queue entry; other
      -- edits fall back to draft or stay in review at the new revision.
      has_unreviewed_changes = status in ('published','paused'),
      publish_state   = null,
      updated_at      = now()
    where id = p.id returning * into p;
    perform public.employer_audit_log(u, 'employer', p_org, 'post', p.id::text, 'edited', jsonb_build_object('revision', p.revision));
  end if;
  return jsonb_build_object('id', p.id, 'status', p.status, 'revision', p.revision);
end $function$;

-- Public: the apply-by-email details for one job, only while it is live on the site.
-- Reviewers and the company's own members can also open it before it goes live (preview).
create or replace function public.employer_apply_info(p_job uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('job_title', p.job_title, 'company', o.name, 'location', p.city || ', ' || p.state_code,
           'work_mode', p.work_mode, 'employment_type', p.employment_type, 'description', left(p.description, 6000),
           'apply_email', p.apply_email, 'closing_date', p.closing_date,
           'live', exists (select 1 from pre_scraped_jobs j where j.apply_url = p.apply_url and j.closed_at is null))
  from employer_posts p join employer_orgs o on o.id = p.org_id
  where p.id = p_job and p.apply_email is not null
    and ((o.status not in ('rejected','suspended')
          and exists (select 1 from pre_scraped_jobs j where j.apply_url = p.apply_url and j.closed_at is null))
      or exists (select 1 from employer_operators op where op.user_id = auth.uid())
      or exists (select 1 from employer_org_members m where m.org_id = p.org_id and m.user_id = auth.uid() and m.status = 'active'))
$$;

-- The workspace's post list does not include apply_email; members read it here.
create or replace function public.employer_apply_emails(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.employer_is_member(p_org, public.employer_caller()) then raise exception 'not_a_member' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(id::text, apply_email) from employer_posts where org_id = p_org and apply_email is not null), '{}'::jsonb);
end $$;
revoke all on function public.employer_apply_emails(uuid) from public, anon;
grant execute on function public.employer_apply_emails(uuid) to authenticated;
revoke all on function public.employer_apply_info(uuid) from public;
grant execute on function public.employer_apply_info(uuid) to anon, authenticated;
revoke all on function public.employer_posts_apply_method() from public, anon, authenticated;
