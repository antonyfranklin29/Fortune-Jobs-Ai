-- Account emails sent to each person, so each one goes out once (per person, kind and key).
-- Rows go with the account (ON DELETE CASCADE): nothing is kept after deletion.
create table if not exists public.account_emails (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('welcome','pro_started','pro_payment_failed','pro_cancelled','account_deleted')),
  key text not null,
  provider_id text,
  created_at timestamptz not null default now(),
  unique (user_id, kind, key)
);
alter table public.account_emails enable row level security;
revoke all on public.account_emails from public, anon, authenticated;
grant all on public.account_emails to service_role;

-- Welcome email: when a person confirms their email address (email/password sign-up), or signs up
-- already confirmed (Google). Calls the account-email function in the background; a failure never
-- blocks sign-up.
create or replace function public.send_welcome_email() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email_confirmed_at is not null and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    begin
      perform net.http_post(
        url := 'https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/account-email',
        headers := jsonb_build_object('content-type', 'application/json',
          'x-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret')),
        body := jsonb_build_object('kind', 'welcome', 'user_id', new.id, 'key', 'welcome'),
        timeout_milliseconds := 20000);
    exception when others then null;
    end;
  end if;
  return new;
end $$;
revoke all on function public.send_welcome_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_confirmed_welcome on auth.users;
create trigger on_auth_user_confirmed_welcome
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.send_welcome_email();
