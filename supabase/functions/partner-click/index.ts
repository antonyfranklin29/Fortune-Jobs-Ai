import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createPartnerAdmission } from "../_shared/partner-protection.mjs";
import { createClickHandler } from "./handler.mjs";
const getEnv=(name:string)=>Deno.env.get(name);
Deno.serve(createClickHandler({admit:createPartnerAdmission({getEnv}),log:async(body:Record<string,unknown>)=>{
 const key=getEnv('SUPABASE_SERVICE_ROLE_KEY') || '';
 // Whitelist fields: no identifiers, IPs or agents can be passed into the click table.
 const args=Object.fromEntries(['p_partner','p_source','p_method','p_campaign','p_job_key','p_country_hint'].map(k=>[k,body[k]??null]));
 await fetch(getEnv('SUPABASE_URL')+'/rest/v1/rpc/log_partner_click',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(3000)});
}}));
