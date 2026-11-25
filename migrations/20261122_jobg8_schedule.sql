-- FILE ONLY: apply after review, function deployment, and privately configured feed URL.
-- Hourly is within the provider's required 60–240-minute refresh window.
-- QA mode is the default. Enabling the schedule does NOT authorise paid go-live.
select cron.schedule('fortune-jobg8-ingest','23 * * * *',$cron$
 select net.http_post(
  url:='https://hqgakkcxcyspqhnlnscv.supabase.co/functions/v1/jobg8-ingest',
  headers:=jsonb_build_object('Content-Type','application/json','x-ingest-secret',
   (select decrypted_secret from vault.decrypted_secrets where name='ingest_secret' limit 1)),
  body:='{}'::jsonb,timeout_milliseconds:=120000
 );
$cron$);
-- Rollback (do not run here): select cron.unschedule('fortune-jobg8-ingest');
