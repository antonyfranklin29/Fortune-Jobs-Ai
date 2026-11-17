// Apply a complete provider snapshot to the existing catalogue in one transaction.
export async function storeRemoteJobs(db, unique, sources, started) {
  try {
    await db.query('begin');
    // Serialise remote runs and avoid an older snapshot undoing a newer completed run.
    await db.query('select pg_advisory_xact_lock(hashtext($1))', ['fortunejobsai remote feeds']);
    const { rows: [latest] } = await db.query(
      'select max(fetched_at) as fetched from pre_scraped_jobs where source = any($1)', [sources],
    );
    if (latest.fetched && +latest.fetched >= started) throw new Error('A newer snapshot is already stored');

    await db.query('create temp table remote_stage on commit drop as select * from pre_scraped_jobs with no data');
    const fields = Object.keys(unique[0] ?? {}).join(',');
    if (!fields) throw new Error('No active remote jobs in the combined feed');
    for (let i = 0; i < unique.length; i += 500) {
      await db.query(`insert into remote_stage (${fields})
        select ${fields} from jsonb_populate_recordset(null::pre_scraped_jobs, $1)`,
        [JSON.stringify(unique.slice(i, i + 500))]);
    }
    // Aggregator URLs can hide the employer URL. Preserve an existing employer listing
    // when both the remote title and company name match exactly.
    await db.query(`delete from remote_stage s using pre_scraped_jobs p
      where p.apply_url = s.apply_url and not (p.source is not distinct from s.source
        and p.source_listing_id is not distinct from s.source_listing_id)`);
    await db.query(`delete from remote_stage s using pre_scraped_jobs p
      where p.closed_at is null and p.is_remote and not coalesce(p.source = any($1), false)
        and lower(regexp_replace(trim(p.company), '\\s+', ' ', 'g')) = lower(regexp_replace(trim(s.company), '\\s+', ' ', 'g'))
        and lower(regexp_replace(trim(p.job_title), '\\s+', ' ', 'g')) = lower(regexp_replace(trim(s.job_title), '\\s+', ' ', 'g'))
      `, [['himalayas', 'remotive']]);
    await db.query(`update pre_scraped_jobs p set apply_url=s.apply_url
      from remote_stage s where p.source=s.source and p.source_listing_id=s.source_listing_id
        and p.apply_url<>s.apply_url and not exists (select 1 from pre_scraped_jobs other where other.apply_url=s.apply_url)`);
    const snapshot = new Date(started);
    const updates = fields.split(',').filter(field => !['source', 'source_listing_id', 'apply_url'].includes(field))
      .map(field => `${field}=excluded.${field}`).join(',');
    await db.query(`insert into pre_scraped_jobs (${fields}, fetched_at, last_seen_at, scraped_at)
      select ${fields}, $1, $1, $1 from remote_stage
      on conflict (apply_url) do update set ${updates}, fetched_at=$1, last_seen_at=$1, scraped_at=$1, closed_at=null
      where pre_scraped_jobs.source = excluded.source and pre_scraped_jobs.source_listing_id = excluded.source_listing_id`, [snapshot]);
    const { rowCount } = await db.query(`update pre_scraped_jobs set closed_at = now()
      where source = any($1) and closed_at is null and (last_seen_at is null or last_seen_at < $2)`, [sources, snapshot]);
    await db.query('commit');
    return rowCount;
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}
