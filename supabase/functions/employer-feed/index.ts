import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createEmployerFeedHandler } from "./handler.mjs";
import { compileRoles, regionIndex } from "../job-ingest/lib.mjs";
import { ROLES, REGIONS } from "../job-ingest/config.mjs";

const base=Deno.env.get('SUPABASE_URL')??'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
async function rpc(name:string,args:Record<string,unknown>) {
  if(!base||!serviceKey)throw Error('backend_not_configured');
  const response=await fetch(`${base}/rest/v1/rpc/${name}`,{
    method:'POST',headers:{'content-type':'application/json',apikey:serviceKey,authorization:`Bearer ${serviceKey}`},
    body:JSON.stringify(args),signal:AbortSignal.timeout(10_000),
  });
  if(!response.ok)throw Error('backend_unavailable');
  return response.json();
}

// Claude's registry bridge must return {source,revision} and be service_role
// only. Missing registry RPC -> 503 before any provider call. This worker only
// stages; it intentionally has no catalogue publication or closure RPC.
const handler=createEmployerFeedHandler({
  secret:Deno.env.get('INGEST_SECRET')??'',
  enabled:Deno.env.get('EMPLOYER_FEED_ENABLED')==='true',
  roles:compileRoles(ROLES),idx:regionIndex(REGIONS),
  loadSource:(id:string)=>rpc('employer_feed_source_snapshot',{p_source_id:id}),
  store:{
    begin:(id:string,revision:number,snapshot:unknown)=>rpc('employer_feed_run_begin',{p_source_id:id,p_revision:revision,p_snapshot:snapshot}),
    stage:(id:string,token:string,revision:number,rows:unknown,summary:unknown)=>rpc('employer_feed_run_stage',{
      p_run_id:id,p_token:token,p_revision:revision,p_rows:rows,p_summary:summary}),
    fail:(id:string,token:string,reason:string)=>rpc('employer_feed_run_fail',{p_run_id:id,p_token:token,p_reason:reason}),
  },
});
Deno.serve(handler);
