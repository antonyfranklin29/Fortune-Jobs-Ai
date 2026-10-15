-- Run as postgres. All disposable rows are rolled back; no auth API/mail is called.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); claimed uuid; n integer;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(a,'newsletter-a@example.invalid','{}'),(b,'newsletter-b@example.invalid','{}');
 insert into public.newsletter_preferences(user_id,subscribed,consent_at,next_send_at) values(a,true,now(),now()-interval '1 day'),(b,false,null,now()-interval '1 day');
 claimed:=public.newsletter_claim(a,'disposable-fixture');
 if claimed is null then raise exception 'Expected first claim'; end if;
 if public.newsletter_claim(a,'disposable-fixture') is not null then raise exception 'Duplicate claim'; end if;
 if public.newsletter_claim(a,'new-campaign') is not null then raise exception 'Cadence bypass'; end if;
 if public.newsletter_claim(b,'disposable-fixture') is not null then raise exception 'Opt-out bypass'; end if;
 update public.newsletter_deliveries set state='unknown' where id=claimed;
 update public.newsletter_preferences set next_send_at=now()-interval '1 day' where user_id=a;
 if public.newsletter_claim(a,'later-attempt') is not null then raise exception 'Unknown delivery retried'; end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 set local role authenticated;
 select count(*) into n from public.newsletter_preferences;
 if n<>1 then raise exception 'Owner RLS failed'; end if;
 reset role;
 delete from auth.users where id=a;
 if exists(select 1 from public.newsletter_preferences where user_id=a) or exists(select 1 from public.newsletter_deliveries where user_id=a) then raise exception 'Deletion cascade failed'; end if;
end $$;
rollback;
select 'PASS: claim uniqueness, seven-day cadence, opt-out, unknown-send hold, owner RLS, deletion cascade; all fixtures rolled back' as result;
