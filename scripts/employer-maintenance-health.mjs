import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
export async function checkMaintenance({url,secret,publishableKey,fetchImpl=fetch}={}){
  if(!url||!secret||!publishableKey)throw Error('maintenance_monitor_not_configured');
  const endpoint=new URL(url);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('invalid_endpoint');
  const response=await fetchImpl(endpoint.href,{method:'POST',redirect:'error',
    headers:{'content-type':'application/json',apikey:publishableKey,authorization:`Bearer ${publishableKey}`,'x-ingest-secret':secret},
    body:JSON.stringify({action:'maintenance_health'}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('maintenance_monitor_unavailable');
  const health=await response.json();
  if(typeof health.attention_required!=='boolean'||typeof health.overdue!=='boolean')throw Error('invalid_maintenance_health');
  return{status:health.attention_required||health.overdue||health.schedule_active!==true?'attention_required':'healthy',health};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const key=readFileSync(new URL('../config.js',import.meta.url),'utf8').match(/\bkey:\s*'([^']+)'/)?.[1];
    const report=await checkMaintenance({url:process.env.EMPLOYER_REFRESH_URL,secret:process.env.INGEST_SECRET,publishableKey:key});
    console.log(JSON.stringify(report));if(report.status!=='healthy')process.exitCode=1;
  }catch{console.error('Private maintenance health check failed. Check the database maintenance report and runner configuration.');process.exitCode=1;}
}
