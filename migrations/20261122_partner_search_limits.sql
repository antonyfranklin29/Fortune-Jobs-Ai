begin;
create table public.partner_search_limits (
  client_hash text primary key check (client_hash ~ '^[a-f0-9]{64}$'),
  started_at timestamptz not null,
  searches integer not null check (searches between 1 and 30)
);
create index partner_search_limits_started_idx on public.partner_search_limits(started_at);
alter table public.partner_search_limits enable row level security;
revoke all on public.partner_search_limits from public,anon,authenticated;
create function public.partner_search_admit(p_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare admitted integer;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  insert into public.partner_search_limits values(p_hash,now(),1)
  on conflict(client_hash) do update
    set started_at=case when partner_search_limits.started_at<=now()-interval '10 minutes' then now() else partner_search_limits.started_at end,
        searches=case when partner_search_limits.started_at<=now()-interval '10 minutes' then 1 else partner_search_limits.searches+1 end
    where partner_search_limits.started_at<=now()-interval '10 minutes' or partner_search_limits.searches<30
  returning searches into admitted;
  delete from public.partner_search_limits where started_at<now()-interval '1 day';
  return admitted is not null;
end $$;
revoke all on function public.partner_search_admit(text) from public,anon,authenticated;
grant execute on function public.partner_search_admit(text) to service_role;
create or replace function public.log_partner_click(p_partner text,p_source text,p_method text,p_campaign text,p_job_key text,p_country_hint text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer; bucket timestamptz := date_trunc('minute', now());
begin
  if coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'user-agent','')
      ~* '(headless|curl|python-requests|wget|spider|crawler|googlebot|bingbot|playwright|puppeteer|node-fetch)' then return false; end if;
  if p_partner is null or p_partner not in ('whatjobs','jobg8')
    or p_source is null or p_source !~ '^[a-z0-9_-]{1,40}$'
    or p_method is null or p_method not in ('search','live','match','jobpage','alert')
    or p_campaign is null or p_campaign !~ '^[a-z0-9_-]{0,40}$'
    or p_job_key is null or p_job_key !~ '^[a-f0-9]{64}$'
    or (p_country_hint is not null and p_country_hint !~ '^[a-z]{2}$') then return false; end if;
  insert into public.partner_click_buckets values(bucket, 1)
    on conflict(minute) do update set hits=partner_click_buckets.hits+1 where partner_click_buckets.hits<300
    returning hits into n;
  if n is null then return false; end if;
  delete from public.partner_click_buckets where minute < bucket - interval '10 minutes';
  insert into public.partner_clicks(partner,source,method,campaign,job_key,country_hint)
    values(p_partner,p_source,p_method,p_campaign,p_job_key,p_country_hint);
  return true;
end $$;

commit;
