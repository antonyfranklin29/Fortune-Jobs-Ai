begin;
create table public.partner_clicks (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  partner text not null check (partner in ('whatjobs','jobg8')),
  source text not null check (source ~ '^[a-z0-9_-]{1,40}$'),
  method text not null check (method in ('search','live','match','jobpage','alert')),
  campaign text not null check (campaign ~ '^[a-z0-9_-]{0,40}$'),
  job_key text not null check (job_key ~ '^[a-f0-9]{64}$'),
  country_hint text check (country_hint ~ '^[a-z]{2}$')
);
create index partner_clicks_created_idx on public.partner_clicks(created_at);
alter table public.partner_clicks enable row level security;
revoke all on public.partner_clicks from public, anon, authenticated;
grant select, delete on public.partner_clicks to service_role;
-- A global minute bucket bounds anonymous writes without retaining caller data.
create table public.partner_click_buckets (minute timestamptz primary key, hits integer not null);
alter table public.partner_click_buckets enable row level security;
revoke all on public.partner_click_buckets from public, anon, authenticated;
create function public.log_partner_click(p_partner text,p_source text,p_method text,p_campaign text,p_job_key text,p_country_hint text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer; bucket timestamptz := date_trunc('minute', now());
begin
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
revoke all on function public.log_partner_click(text,text,text,text,text,text) from public;
grant execute on function public.log_partner_click(text,text,text,text,text,text) to anon,authenticated;
-- Preserve the source on saved jobs so later Apply clicks use the same rules.
alter table public.saved_jobs add column if not exists source text check (char_length(source)<=50);
commit;
