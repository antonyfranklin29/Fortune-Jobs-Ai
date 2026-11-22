import { readZip, normalize, safeHttps } from './feed.mjs';
export function createIngestHandler({ getEnv, rpc, fetchImpl = fetch, zip, context }) {
 const json = (value, status = 200) => Response.json(value, { status });
 const same = (a,b) => { if (!a || !b || a.length !== b.length) return false; let d=0; for(let i=0;i<a.length;i++) d|=a.charCodeAt(i)^b.charCodeAt(i); return !d; };
 return async req => {
  if (req.method !== 'POST') return json({error:'method_not_allowed'},405);
  if (!same(req.headers.get('x-ingest-secret') || '',getEnv('INGEST_SECRET') || '')) return json({error:'unauthorised'},401);
  const url = getEnv('JOBG8_FEED_URL'), mode = getEnv('JOBG8_MODE') || 'qa';
  if (!url) return json({status:'unconfigured',mode},503);
  if (!safeHttps(url) || !['qa','live'].includes(mode)) return json({status:'invalid_configuration'},503);
  let run;
  const counts = {fetched:0,inserted:0,updated:0,closed:0,conflicts:0};
  try {
   run = await rpc('jobg8_start',{p_mode:mode});
   if (run.status !== 'started') return json({status:run.status,mode});
   const auth = {p_run:run.run_id,p_token:run.token};
   const finish = (ok,modified,note) => rpc('jobg8_finish',{...auth,p_ok:ok,p_modified:modified,p_note:note});
   const options = {redirect:'error',signal:AbortSignal.timeout(90_000),headers:{Accept:'application/zip','User-Agent':'FortuneJobsAI/1.0 (+https://fortunejobsai.com)'}};
   const head = await fetchImpl(url,{...options,method:'HEAD'});
   await head.body?.cancel();
   if (!head.ok) throw new Error('head_failed');
   const modified = head.headers.get('last-modified');
   if (modified && modified === run.last_modified) { await finish(true,modified,'unchanged'); return json({status:'unchanged',mode,run_id:run.run_id}); }
   if (!await rpc('jobg8_get',auth)) { await finish(false,null,'get_rate_limit'); return json({status:'rate_limited',mode},429); }
   const response = await fetchImpl(url,{...options,method:'GET'});
   if (!response.ok) { await response.body?.cancel(); throw new Error('get_failed'); }
   // A different GET Last-Modified is fine: record the version actually downloaded.
   const actualModified = response.headers.get('last-modified') || modified;
   counts.fetched = await readZip(response.body, async records => {
    const rows = records.map(raw => normalize(raw,context));
    await rpc('jobg8_stage',{...auth,p_rows:rows});
   },zip);
   await rpc('jobg8_ready',auth);
   let after='';
   for (;;) {
    const result=await rpc('jobg8_publish',{...auth,p_after:after});
    for (const key of ['inserted','updated','conflicts']) counts[key]+=result[key];
    if (!result.processed) break;
    if (result.after===after) throw new Error('invalid_cursor');
    after=result.after;
   }
   counts.closed=await finish(true,actualModified,null);
   return json({status:'succeeded',mode,run_id:run.run_id,...counts});
  } catch {
   // Never echo provider errors or the credential-bearing feed URL.
   if (run?.token) await rpc('jobg8_finish',{p_run:run.run_id,p_token:run.token,p_ok:false,p_modified:null,p_note:'collection_or_write_failed'}).catch(()=>{});
   return json({status:'failed',mode,run_id:run?.run_id,...counts},502);
  }
 };
}
