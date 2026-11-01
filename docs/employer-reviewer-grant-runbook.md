# Granting the first independent employer reviewer: runbook (prepared, not run)

Status: **prepared only.** No reviewer has been named or granted, and `employer_operators` has 0 rows. Run this only after Franklin names a real reviewer in writing. Nothing here names or assumes a person.

## Preconditions (each needs Franklin)

1. **Who.** A named person who belongs to none of the companies they will review. The database enforces this per review (`employer_require_operator` raises `cannot_review_own_organization`). Still pick someone with no employer membership, so the separation is obvious.
2. **Their account.** The reviewer signs in once on fortunejobsai.com with their own email, so that an `auth.users` row exists. Staff never create the account or sign in for them.
3. **Audit note.** A short reference to where the appointment is recorded, for example "appointed by Franklin, email 2026-11-xx". Never store ID documents or credentials in the note.

## Grant (single transaction, service role, SQL editor)

Replace the two placeholders. The block refuses to grant if the email matches zero or several accounts, or if the person is an active member of any company.

```sql
begin;
do $$
declare
  v_email text := '<REVIEWER_EMAIL>';           -- placeholder: supplied by Franklin
  v_note  text := '<APPOINTMENT_REFERENCE>';    -- placeholder: short audit reference
  v_ids   uuid[];
begin
  select array_agg(id) into v_ids from auth.users where lower(email) = lower(v_email);
  if v_ids is null or array_length(v_ids, 1) <> 1 then
    raise exception 'expected exactly one account for %, found %', v_email, coalesce(array_length(v_ids, 1), 0);
  end if;
  if exists (select 1 from public.employer_org_members where user_id = v_ids[1] and status = 'active') then
    raise exception 'reviewer is an active member of an employer company; choose an independent reviewer';
  end if;
  if exists (select 1 from public.employer_operators where user_id = v_ids[1]) then
    raise exception 'already a reviewer';
  end if;
  insert into public.employer_operators (user_id, note) values (v_ids[1], left(v_note, 200));
end $$;
select count(*) as reviewers from public.employer_operators;   -- expect 1
commit;
```

## Verify (read-only)

- `select count(*) from employer_operators;` returns 1.
- The reviewer signs in to the employer workspace and sees the review queue. A different, non-reviewer account still gets `operator_only`.
- Then run one end-to-end post from submission to approval or rejection, following `docs/employer-authorized-pilot-checklist.md` section 4.

## Revoke

```sql
delete from public.employer_operators where user_id = (select id from auth.users where lower(email) = lower('<REVIEWER_EMAIL>'));
```

Approvals already recorded keep their `reviewed_by` audit; deleting the account sets those references to null, as the account-deletion review confirmed.
