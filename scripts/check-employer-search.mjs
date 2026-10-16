// Local query-plan probe of the ACTUAL pending RLS. Never connects to Supabase.
// Re-run with: node scripts/check-employer-search.mjs
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=await PGlite.create();
const files=['tests/sql/supabase-shim.sql','migrations/20261015_ingest_taxonomy.sql',
  'migrations/20261015_ingest_catalogue.sql','migrations/20261015_ingest_feed.sql',
  'migrations/pending/20261016_employer_submissions.sql'];
const report={environment:'PGlite single connection; synthetic 50,000 jobs, 100 employers; not production latency',samples:[]};
const queries={national:"country='us' and (search_text ilike '%analyst%')",
  north_carolina:"country='us' and (search_text ilike '%analyst%') and (location ilike '%North Carolina%' or location ilike '%, NC%' or location='NC')"};
const probe=async(label,where)=>{
  const sql=`explain (analyze,format json) select job_title,company,location,salary,apply_url,employment_type,work_mode,is_remote,posted_at,category,country,job_description,source,closed_at from public.pre_scraped_jobs where closed_at is null and ${where} order by posted_at desc nulls last limit 300`;
  const times=[];let plan;
  await db.exec('set role anon');
  try{for(let i=0;i<8;i++){
    plan=(await db.query(sql)).rows[0]['QUERY PLAN'][0];if(i>1)times.push(plan['Execution Time']);
  }}finally{await db.exec('reset role');}
  times.sort((a,b)=>a-b);
  return {case:label,median_ms:times[Math.floor(times.length/2)],rows:plan.Plan['Actual Rows'],scan:JSON.stringify(plan.Plan).includes('Seq Scan')?'includes sequential scan':'indexed scan'};
};
try{
  for(const file of files)await db.exec(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
  await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('11111111-1111-1111-1111-111111111111','fixture@synthetic.com',now());
    insert into employer_orgs(name,primary_domain,status,domain_verified_at,created_by)
      select 'Synthetic '||g,'synthetic-'||g||'.com',case when g%10=0 then 'suspended' else 'verified' end,now(),'11111111-1111-1111-1111-111111111111'::uuid from generate_series(1,100)g;
    insert into employer_sources(id,org_id,adapter,board_token,employer_name,status,enabled,rights_basis,permission_ref,approved_by,approved_at,authorization_expires_at,allow_display,allowed_apply_hosts,submitted_by)
      select 'source-'||row_number()over(order by id),id,'lever','synthetic-'||row_number()over(order by id),name,'approved',true,'employer_written_permission','fixture','11111111-1111-1111-1111-111111111111'::uuid,now(),now()+interval '10 days',true,array['jobs.lever.co'],'11111111-1111-1111-1111-111111111111'::uuid from employer_orgs;
    insert into pre_scraped_jobs(category,job_title,company,location,apply_url,posted_at,search_text,country)
      select 'Data Analyst',case when g%3=0 then 'Software Engineer' else 'Data Analyst' end,'Synthetic Employer',
        case when g%5=0 then 'Raleigh, NC' else 'Edison, NJ' end,'https://synthetic.com/job/'||g,
        now()-g*interval '1 minute',case when g%3=0 then 'software engineer synthetic employer' else 'data analyst synthetic employer' end,'us' from generate_series(1,50000)g;
    analyze pre_scraped_jobs;analyze employer_orgs;analyze employer_sources;`);
  // Same database and SQL, changing ONLY the RLS policy for the baseline.
  for(const [name,where] of Object.entries(queries)){
    await db.exec(`alter policy "public can read pre-scraped jobs" on pre_scraped_jobs using(closed_at is null)`);
    report.samples.push(await probe('legacy / old RLS / '+name,where));
    await db.exec(`alter policy "public can read pre-scraped jobs" on pre_scraped_jobs using(closed_at is null and (expires_at is null or expires_at>now()) and (employer_org_id is null or employer_listing_visible(employer_org_id,employer_source_id)))`);
    report.samples.push(await probe('legacy / new RLS / '+name,where));
  }
  await db.exec(`with sources as(select org_id,id,row_number()over(order by id) n from employer_sources)
    update pre_scraped_jobs j set source='employer_feed',employer_org_id=s.org_id,employer_source_id=s.id,
      expires_at=case when j.id%13=0 then now()-interval '1 day' else now()+interval '1 day' end
      from sources s where j.id%2=0 and (j.id/2)%100+1=s.n;
    analyze pre_scraped_jobs;`);
  const expected=(await db.query(`select count(*)::int n from pre_scraped_jobs j where closed_at is null and (expires_at is null or expires_at>now())
    and (employer_org_id is null or exists(select 1 from employer_orgs o join employer_sources s on s.org_id=o.id
      where o.id=j.employer_org_id and s.id=j.employer_source_id and o.status='verified' and s.status='approved' and s.enabled and s.allow_display and s.authorization_expires_at>now()))`)).rows[0].n;
  await db.exec('set role anon');const visible=(await db.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n;await db.exec('reset role');
  assert.equal(visible,expected);report.visibility={total:50000,expected,anonymous_visible:visible};
  for(const [name,where]of Object.entries(queries))report.samples.push(await probe('half employer / new RLS / '+name,where));
  await db.exec(readFileSync(new URL('../migrations/pending/20261017_employer_search_visibility.sql',import.meta.url),'utf8'));
  for(const [name,where]of Object.entries(queries))report.samples.push(await probe('half employer / batched visibility / '+name,where));
  await db.exec('set role anon');
  assert.equal((await db.query('select count(*)::int n from pre_scraped_jobs')).rows[0].n,expected);
  await db.exec('reset role');
  await db.exec('set role anon');
  report.plan=(await db.query("explain (format json) select job_title from pre_scraped_jobs where closed_at is null and country='us' and search_text ilike '%analyst%' order by posted_at desc nulls last limit 300")).rows[0]['QUERY PLAN'];
  await db.exec('reset role');
  console.log(JSON.stringify(report,null,2));
}finally{await db.close();}
