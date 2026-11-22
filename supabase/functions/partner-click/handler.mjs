import { isObviousBot } from '../_shared/partner-protection.mjs';
import { isIP } from 'node:net';
const origins=new Set(['https://fortunejobsai.com','https://www.fortunejobsai.com']);
export function createClickHandler({admit,log}) {
 return async req=>{
  const origin=req.headers.get('origin'),headers={'Vary':'Origin','Cache-Control':'no-store'};
  if(!origins.has(origin)) return new Response(null,{status:403,headers});
  headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Methods']='POST, OPTIONS';headers['Access-Control-Allow-Headers']='content-type, apikey, authorization';
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(req.method!=='POST') return new Response(null,{status:405,headers});
  try {
   const ip=req.headers.get('x-forwarded-for')?.split(',')[0].trim();
   if(!ip || !isIP(ip) || !req.headers.get('user-agent') || isObviousBot(req.headers.get('user-agent'))) return new Response(null,{status:204,headers});
   if(Number(req.headers.get('content-length'))>2048) return new Response(null,{status:413,headers});
   const text=await req.text();if(text.length>2048) return new Response(null,{status:413,headers});
   const body=JSON.parse(text);
   if(body.p_partner==='jobg8' && await admit(ip)) await log(body);
  } catch { /* Click navigation already happened; no errors/visitor data in responses. */ }
  return new Response(null,{status:204,headers});
 };
}
