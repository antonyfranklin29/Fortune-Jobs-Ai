-- Run after the pending migration in a disposable database.
begin;
do $$
declare
  fixture record;
begin
  for fixture in select * from (values
    ('H-1B sponsorship available', 'sponsors'),
    ('Visa sponsorship is provided for qualified candidates.', 'sponsors'),
    ('Visa sponsorship offered.', 'sponsors'),
    ('We can sponsor qualified applicants.', 'sponsors'),
    ('Will sponsor H‑1B.', 'sponsors'),
    ('We offer employment visa sponsorship.', 'sponsors'),
    ('<b>Visa sponsorship</b>&nbsp;available.', 'sponsors'),
    ('OPT candidates welcome.', 'opt_friendly'),
    ('CPT students are encouraged.', 'opt_friendly'),
    ('STEM OPT applicants accepted.', 'opt_friendly'),
    ('We accept candidates on OPT/CPT.', 'opt_friendly'),
    ('F-1 students welcome.', 'opt_friendly'),
    ('STEM OPT extension supported.', 'opt_friendly'),
    ('No sponsorship.', 'no_sponsorship'),
    ('Must be authorized to work without visa sponsorship.', 'no_sponsorship'),
    ('H-1B sponsorship is not available.', 'no_sponsorship'),
    ('Visa sponsorship will not be provided.', 'no_sponsorship'),
    ('We will not sponsor candidates.', 'no_sponsorship'),
    ('We are not able to sponsor candidates.', 'no_sponsorship'),
    ('US citizens only.', 'no_sponsorship'),
    ('Active security clearance required.', 'no_sponsorship'),
    ('OPT candidates welcome. Visa sponsorship is not offered.', 'no_sponsorship'),
    ('Visa sponsorship provided elsewhere. We cannot sponsor.', 'no_sponsorship'),
    ('We do not accept OPT candidates.', 'no_sponsorship'),
    ('Security clearance preferred.', 'unknown'),
    ('Medical CPT billing experience required.', 'unknown'),
    ('Employees may opt out of this program.', 'unknown'),
    ('Help coordinate visa sponsorship for clients.', 'unknown'),
    ('Training will be sponsored by the company.', 'unknown'),
    ('Authorized to work in the US.', 'unknown'),
    ('', 'unknown')
  ) as samples(description, expected) loop
    if public.classify_job_sponsorship('Engineer', fixture.description) is distinct from fixture.expected then
      raise exception 'Unexpected classification for % (expected %)', fixture.description, fixture.expected;
    end if;
  end loop;
  if public.classify_job_sponsorship('Engineer — visa sponsorship available', null) <> 'sponsors' then
    raise exception 'Title was not classified';
  end if;
end $$;

create temporary table sponsorship_fixture (
  id int primary key, job_title text, job_description text, sponsorship text
);
create trigger classify
before insert or update of job_title, job_description on sponsorship_fixture
for each row execute function public.set_job_sponsorship();

insert into sponsorship_fixture values (1, 'Engineer', 'Visa sponsorship available', 'no_sponsorship');
do $$ begin
  if (select sponsorship from sponsorship_fixture where id = 1) <> 'sponsors' then
    raise exception 'Insert trigger did not classify listing';
  end if;
end $$;
update sponsorship_fixture set job_description = 'Visa sponsorship is not available' where id = 1;
do $$ begin
  if (select sponsorship from sponsorship_fixture where id = 1) <> 'no_sponsorship' then
    raise exception 'Update trigger did not reclassify listing';
  end if;
end $$;
rollback;
