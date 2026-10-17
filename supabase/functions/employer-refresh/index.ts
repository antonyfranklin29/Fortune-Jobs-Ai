import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createEmployerRefreshHandler } from './handler.mjs';
import { createEmployerFeedHandler } from '../employer-feed/handler.mjs';
import { compileRoles,regionIndex } from '../job-ingest/lib.mjs';
import { ROLES,REGIONS } from '../job-ingest/config.mjs';
const base=Deno.env.get('SUPABASE_URL')??'';
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const secret=Deno.env.get('INGEST_SECRET')??'';
async function rpc(name:string,args:Record<string,unknown>={}){
  if(!base||!key)throw Error('backend_not_configured');
  const response=await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',
    headers:{'content-type':'application/json',apikey:key,authorization:`Bearer ${key}`},
    body:JSON.stringify(args),signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw Error('backend_unavailable');return response.json();
}
// The coordinator's database flag defaults OFF. The internal staging handler
// cannot be reached directly; only an admitted coordinator request invokes it.
const stage=createEmployerFeedHandler({secret,enabled:true,roles:compileRoles(ROLES),idx:regionIndex(REGIONS),
  loadSource:(id:string)=>rpc('employer_source_for_worker',{p_source:id}),
  store:{
    begin:(id:string,revision:number,snapshot:unknown)=>rpc('employer_feed_run_begin',{p_source_id:id,p_revision:revision,p_snapshot:snapshot}),
    stage:(id:string,token:string,revision:number,rows:unknown,summary:unknown)=>rpc('employer_feed_stage_registered_run',{
      p_run_id:id,p_token:token,p_revision:revision,p_rows:rows,p_summary:summary}),
    fail:(id:string,token:string,reason:string)=>rpc('employer_feed_run_fail',{p_run_id:id,p_token:token,p_reason:reason}),
  }});
Deno.serve(createEmployerRefreshHandler({secret,stage,
  claim:(source:string|null)=>rpc('employer_refresh_claim',{p_source:source}),
  finish:(ticket:string,run:string)=>rpc('employer_refresh_finish',{p_ticket:ticket,p_run:run}),
  fail:(ticket:string,reason:string)=>rpc('employer_refresh_fail',{p_ticket:ticket,p_reason:reason}),
  health:()=>rpc('employer_refresh_health'),
  maintenancePreview:()=>rpc('employer_maintenance_run',{p_apply:false,p_limit:25}),
  maintenanceHealth:()=>rpc('employer_maintenance_health'),
}));
