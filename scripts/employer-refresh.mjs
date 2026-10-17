// Scheduled/manual backend caller. Secrets come only from the runner environment.
// No browser, public client key or command-line secret is used.
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
export async function runRefresh({url,secret,publishableKey,fetchImpl=fetch,healthOnly=false}={}){
  if(!url||!secret)throw Error('refresh_runner_not_configured');
  const endpoint=new URL(url);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)
    throw Error('invalid_refresh_endpoint');
  const invoke=async action=>{
    const response=await fetchImpl(endpoint.href,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json','x-ingest-secret':secret,
        ...(publishableKey?{apikey:publishableKey,authorization:`Bearer ${publishableKey}`}:{})},body:JSON.stringify({action}),
      signal:AbortSignal.timeout(170_000)});
    if(!response.ok)throw Error('refresh_endpoint_failed');
    return response.json();
  };
  const health=await invoke('health');
  if(health.enabled!==true)return{status:'disabled',health};
  const refresh=healthOnly?null:await invoke('refresh');
  const after=healthOnly?health:await invoke('health');
  const attention=Boolean(after.expired_claim||after.overdue_sources>0||after.failed_24h>0||after.degraded_24h>0||
    (refresh&&!['complete','idle'].includes(refresh.status)));
  return{status:attention?'attention_required':'healthy',refresh,health:after};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    // The same PUBLIC project key shipped on the website satisfies the platform
    // JWT gate. The private ingest secret remains the actual caller authority.
    const publishableKey=readFileSync(new URL('../config.js',import.meta.url),'utf8').match(/\bkey:\s*'([^']+)'/)?.[1];
    if(!publishableKey)throw Error('public_project_configuration_missing');
    const report=await runRefresh({url:process.env.EMPLOYER_REFRESH_URL,secret:process.env.INGEST_SECRET,publishableKey,
      healthOnly:process.argv.includes('--health-only')});
    console.log(JSON.stringify(report));
    if(report.status==='attention_required')process.exitCode=1;
  }catch{console.error('Employer refresh runner failed. Check configuration and private operational logs.');process.exitCode=1;}
}
