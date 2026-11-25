import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Unzip, UnzipInflate } from "npm:fflate@0.8.2";
import { SaxesParser } from "npm:saxes@6.0.0";
import { createIngestHandler } from "./handler.mjs";
import { ROLES, REGIONS } from "./config.mjs";
import { compileRoles, classifyRole } from "./core.mjs";
import { cleanText } from "../_shared/live-job-partner.mjs";
const roles=compileRoles(ROLES);
const stateIndex=new Map(REGIONS.regions.flatMap((r: {code:string;name:string})=>[[r.code,r.code],[r.name.toLowerCase(),r.code]]));
const rpc=async(name:string,args:unknown)=>{
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
 const response=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/'+name,{
  method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},
  body:JSON.stringify(args),signal:AbortSignal.timeout(20_000)
 });
 if(!response.ok){
  // Surface only our own raise codes (never row data) so failed runs can be diagnosed.
  const body=await response.json().catch(()=>({}));
  const code=/^(invalid_job|invalid_batch|lease_lost|snapshot_incomplete|unpublished_jobs)$/.test(body?.message)?body.message:body?.code==='23505'?'duplicate_job':'database_write_failed';
  throw new Error(code);
 }
 const text=await response.text();return text ? JSON.parse(text) : null;
};
Deno.serve(createIngestHandler({getEnv:(name:string)=>Deno.env.get(name),rpc,
 zip:{Unzip,UnzipInflate,SaxesParser},context:{stateIndex,classify:(title:string)=>classifyRole(title,roles),cleanText}}));
