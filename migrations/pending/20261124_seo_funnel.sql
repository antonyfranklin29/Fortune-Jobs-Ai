begin;
-- File only. No IP, user agent, raw search, full referrer, resume or payment data.
create table public.seo_funnel_sessions (
 id uuid primary key, created_at timestamptz not null default now(),
 landing_path text not null, referrer text not null, source text not null,
 medium text not null default '', campaign text not null default ''
);
create index seo_funnel_created on public.seo_funnel_sessions(created_at);
create table public.seo_funnel_searches (
 id uuid primary key, session_id uuid not null references public.seo_funnel_sessions(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index seo_funnel_search_session on public.seo_funnel_searches(session_id);
create table public.seo_signup_attribution (
 user_id uuid primary key references auth.users(id) on delete cascade,
 session_id uuid not null references public.seo_funnel_sessions(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index seo_signup_session on public.seo_signup_attribution(session_id);
create table public.seo_pro_conversions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table public.seo_funnel_buckets(minute timestamptz primary key,hits integer not null);
alter table public.seo_funnel_sessions enable row level security;
alter table public.seo_funnel_searches enable row level security;
alter table public.seo_signup_attribution enable row level security;
alter table public.seo_pro_conversions enable row level security;
alter table public.seo_funnel_buckets enable row level security;
revoke all on public.seo_funnel_sessions,public.seo_funnel_searches,public.seo_signup_attribution,public.seo_pro_conversions,public.seo_funnel_buckets from public,anon,authenticated;
grant select,delete on public.seo_funnel_sessions,public.seo_funnel_searches,public.seo_signup_attribution,public.seo_pro_conversions to service_role;

-- A strict route allowlist is inserted below from our public roles/regions.
create function public.seo_safe_path(p_path text) returns text language sql immutable set search_path='' as $$
 select case when p_path='/index.html' then '/' when p_path = any(array['/','/index.html','/other','/find-jobs.html','/resume-search.html','/resume-builder.html','/application-tracker.html','/about.html','/contact.html','/privacy.html','/terms.html','/results.html','/login.html','/employer-login.html']) or p_path ~ '^/(jobs|salaries|h1b)/$' or p_path ~ '^/jobs/(tech|healthcare|transport)/$' or p_path ~ '^/(jobs|salaries|h1b)/(data-analyst|business-analyst|business-intelligence-developer|power-bi-developer|tableau-developer|sql-developer|data-engineer|data-scientist|machine-learning-engineer|software-engineer|full-stack-developer|devops-engineer|cloud-engineer|qa-engineer|cybersecurity-analyst|servicenow-developer|salesforce-developer|anaplan-model-builder|product-manager|project-manager|registered-nurse|accountant|marketing-manager|human-resources-manager|sales-representative|customer-service-representative|licensed-practical-nurse|certified-nursing-assistant|medical-assistant|pharmacy-technician|physical-therapist|respiratory-therapist|home-health-aide|cdl-truck-driver|delivery-driver|warehouse-associate|forklift-operator|dispatcher|logistics-coordinator)(/(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new-hampshire|new-jersey|new-mexico|new-york|north-carolina|north-dakota|ohio|oklahoma|oregon|pennsylvania|rhode-island|south-carolina|south-dakota|tennessee|texas|utah|vermont|virginia|washington|west-virginia|wisconsin|wyoming|district-of-columbia|raleigh-nc|chicago-il|new-york-ny|austin-tx|seattle-wa|san-francisco-ca|dallas-tx|houston-tx|charlotte-nc|atlanta-ga|boston-ma|washington-dc|jersey-city-nj|newark-nj|arlington-va|los-angeles-ca|san-jose-ca|denver-co|phoenix-az))?/$' or p_path ~ '^/jobs/(remote|entry-level)/((data-analyst|business-analyst|business-intelligence-developer|power-bi-developer|tableau-developer|sql-developer|data-engineer|data-scientist|machine-learning-engineer|software-engineer|full-stack-developer|devops-engineer|cloud-engineer|qa-engineer|cybersecurity-analyst|servicenow-developer|salesforce-developer|anaplan-model-builder|product-manager|project-manager|registered-nurse|accountant|marketing-manager|human-resources-manager|sales-representative|customer-service-representative|licensed-practical-nurse|certified-nursing-assistant|medical-assistant|pharmacy-technician|physical-therapist|respiratory-therapist|home-health-aide|cdl-truck-driver|delivery-driver|warehouse-associate|forklift-operator|dispatcher|logistics-coordinator)/)?$' or p_path ~ '^/jobs/entry-level/(data-analyst|business-analyst|business-intelligence-developer|power-bi-developer|tableau-developer|sql-developer|data-engineer|data-scientist|machine-learning-engineer|software-engineer|full-stack-developer|devops-engineer|cloud-engineer|qa-engineer|cybersecurity-analyst|servicenow-developer|salesforce-developer|anaplan-model-builder|product-manager|project-manager|registered-nurse|accountant|marketing-manager|human-resources-manager|sales-representative|customer-service-representative|licensed-practical-nurse|certified-nursing-assistant|medical-assistant|pharmacy-technician|physical-therapist|respiratory-therapist|home-health-aide|cdl-truck-driver|delivery-driver|warehouse-associate|forklift-operator|dispatcher|logistics-coordinator)/(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new-hampshire|new-jersey|new-mexico|new-york|north-carolina|north-dakota|ohio|oklahoma|oregon|pennsylvania|rhode-island|south-carolina|south-dakota|tennessee|texas|utah|vermont|virginia|washington|west-virginia|wisconsin|wyoming|district-of-columbia|raleigh-nc|chicago-il|new-york-ny|austin-tx|seattle-wa|san-francisco-ca|dallas-tx|houston-tx|charlotte-nc|atlanta-ga|boston-ma|washington-dc|jersey-city-nj|newark-nj|arlington-va|los-angeles-ca|san-jose-ca|denver-co|phoenix-az)/$' then p_path else '/other' end;
$$;
create function public.seo_valid_context(p jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p)='object'
  and (p->>'id') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  and (p->>'path')=public.seo_safe_path(p->>'path')
  and (p->>'referrer') in ('direct','other','google.com','google.co.uk','bing.com','duckduckgo.com','yahoo.com','linkedin.com','instagram.com','facebook.com','reddit.com','t.co','threads.net','youtube.com','fortunejobsai.com')
  and (p->>'source') ~ '^[a-z0-9_-]{1,40}$'
  and (p->>'medium') ~ '^[a-z0-9_-]{0,40}$'
  and (p->>'campaign') ~ '^[a-z0-9_-]{0,40}$',false);
$$;
create function public.seo_log_funnel(p_context jsonb,p_event text,p_event_id uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; bucket timestamptz:=date_trunc('minute',now()); sid uuid;
begin
 if not public.seo_valid_context(p_context) or p_event is null or p_event not in ('landing','search') or (p_event='search' and p_event_id is null) then return false; end if;
 sid:=(p_context->>'id')::uuid;
 if p_event='landing' and exists(select 1 from public.seo_funnel_sessions where id=sid) then return true; end if;
 if p_event='search' and exists(select 1 from public.seo_funnel_searches where id=p_event_id and session_id=sid) then return true; end if;
 insert into public.seo_funnel_buckets values(bucket,1)
 on conflict(minute) do update set hits=seo_funnel_buckets.hits+1 where seo_funnel_buckets.hits<300 returning hits into n;
 if n is null then return false; end if;
 delete from public.seo_funnel_buckets where minute<bucket-interval '10 minutes';
 insert into public.seo_funnel_sessions(id,landing_path,referrer,source,medium,campaign)
 values(sid,p_context->>'path',p_context->>'referrer',p_context->>'source',p_context->>'medium',p_context->>'campaign') on conflict(id) do nothing;
 if p_event='search' then
  -- At most 60 distinct search combinations per tab session. No raw query retained.
  perform pg_advisory_xact_lock(hashtextextended(sid::text,71));
  if (select count(*) from public.seo_funnel_searches where session_id=sid)>=60 then return false; end if;
  insert into public.seo_funnel_searches(id,session_id) values(p_event_id,sid) on conflict(id) do nothing;
 end if;
 return true;
end $$;
create function public.seo_attach_signup(p_user uuid,p_context jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 -- Existing accounts cannot be relabelled by returning to the site. Attribution
 -- is client-declared measurement, never authority for billing or permissions.
 if not exists(select 1 from auth.users where id=p_user and created_at>=now()-interval '24 hours')
  or exists(select 1 from public.seo_signup_attribution where user_id=p_user)
  or not public.seo_valid_context(p_context) then return false; end if;
 if not public.seo_log_funnel(p_context,'landing',null) then return false; end if;
 insert into public.seo_signup_attribution(user_id,session_id)
 values(p_user,(p_context->>'id')::uuid) on conflict(user_id) do nothing;
 return true;
end $$;
create function public.seo_link_signup(p_context jsonb) returns boolean language sql security definer set search_path='' as $$
 select public.seo_attach_signup(auth.uid(),p_context);
$$;
create function public.seo_signup_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Fail-open: account creation must not depend on optional analytics.
 begin perform public.seo_attach_signup(new.id,new.raw_user_meta_data->'seo_first_touch');exception when others then null;end;
 return new;
end $$;
create trigger seo_signup_created after insert on auth.users for each row execute function public.seo_signup_created();
create function public.seo_pro_started() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.livemode and new.status='active' and new.stripe_subscription_id is not null and new.current_period_end>now() then
  begin insert into public.seo_pro_conversions(user_id) values(new.user_id) on conflict(user_id) do nothing; exception when others then null; end;
 end if;
 return new;
end $$;
create trigger seo_pro_started after insert or update on public.subscriptions for each row execute function public.seo_pro_started();

create view public.seo_funnel_weekly with (security_barrier=true) as
select date_trunc('week',s.created_at at time zone 'UTC')::date as landing_week,
 s.landing_path,s.referrer,s.source,
 count(distinct s.id) as landing_sessions,
 count(distinct q.session_id) as searched_sessions,
 count(distinct q.id) as searches,
 count(distinct a.user_id) as signups,
 count(distinct p.user_id) as pro
from public.seo_funnel_sessions s
left join public.seo_funnel_searches q on q.session_id=s.id
left join public.seo_signup_attribution a on a.session_id=s.id
left join public.seo_pro_conversions p on p.user_id=a.user_id
group by 1,2,3,4;
revoke all on public.seo_funnel_weekly from public,anon,authenticated;
grant select on public.seo_funnel_weekly to service_role;
create function public.seo_funnel_prune() returns void language sql security definer set search_path='' as $$
 delete from public.seo_funnel_sessions where created_at<now()-interval '90 days';
 delete from public.seo_pro_conversions where created_at<now()-interval '90 days';
$$;
revoke all on function public.seo_safe_path(text),public.seo_valid_context(jsonb),public.seo_attach_signup(uuid,jsonb),public.seo_signup_created(),public.seo_pro_started(),public.seo_funnel_prune(),public.seo_link_signup(jsonb),public.seo_log_funnel(jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.seo_log_funnel(jsonb,text,uuid) to anon,authenticated;
grant execute on function public.seo_link_signup(jsonb) to authenticated;
grant execute on function public.seo_funnel_prune() to service_role;
commit;
