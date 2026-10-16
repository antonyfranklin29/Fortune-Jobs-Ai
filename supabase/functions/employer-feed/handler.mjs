import { approvedSource } from './lib.mjs';
import { collectEmployerFeed } from './collect.mjs';

const json = (body,status=200) => new Response(JSON.stringify(body), {status,headers:{'content-type':'application/json','cache-control':'no-store'}});
function secretEqual(a,b) {
  if(!a || !b || a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function smallJson(request) {
  if(Number(request.headers.get('content-length'))>4096 || !request.body)throw Error('invalid_body');
  const reader=request.body.getReader(), chunks=[];let length=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;
      if(length>4096)throw Error('invalid_body');chunks.push(value);}
  } catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

// Factory keeps credentials/environment outside the core and lets tests use
// real private staging SQL with a synthetic registry/provider, never production.
/**
 * @param {{secret?:string, enabled?:boolean,
 * loadSource?:(id:string)=>Promise<any>,
 * store?:{begin:(id:string,revision:number,snapshot:any)=>Promise<any>,
 * stage:(id:string,token:string,revision:number,rows:any,summary:any)=>Promise<any>,
 * fail:(id:string,token:string,reason:string)=>Promise<any>},
 * roles?:any[], idx?:any, now?:()=>Date,
 * fetchPage?:(source:any,options:any)=>Promise<any>}} [options]
 * @returns {(request:Request)=>Promise<Response>}
 */
export function createEmployerFeedHandler({secret,enabled=false,loadSource,store,roles,idx,now=()=>new Date(),fetchPage}={}) {
  return async request => {
    if(request.method!=='POST')return json({status:'rejected',reason:'method_not_allowed'},405);
    if(!secret)return json({status:'unavailable',reason:'worker_not_configured'},503);
    if(!secretEqual(request.headers.get('x-ingest-secret')||'',secret))return json({status:'rejected',reason:'unauthorised'},401);
    if(!enabled)return json({status:'unavailable',reason:'employer_feed_disabled'},503);
    let body;
    try{body=await smallJson(request);}catch{return json({status:'rejected',reason:'invalid_body'},400);}
    if(!body || typeof body!=='object' || Array.isArray(body) ||
      Object.keys(body).some(k=>!['source_id','max_requests','dry_run'].includes(k)) ||
      typeof body.source_id!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.source_id) ||
      (body.dry_run!==undefined && typeof body.dry_run!=='boolean') ||
      (body.max_requests!==undefined && (!Number.isInteger(body.max_requests)||body.max_requests<1||body.max_requests>6)))
      return json({status:'rejected',reason:'invalid_body'},400);
    const dryRun=body.dry_run!==false;
    if(typeof loadSource!=='function' || (!dryRun && !store))return json({status:'unavailable',reason:'backend_not_configured'},503);
    let initial;
    try{initial=await loadSource(body.source_id);}catch{return json({status:'unavailable',reason:'registry_unavailable'},503);}
    if(!initial)return json({status:'rejected',reason:'source_not_found'},404);
    try{
      if(initial.source?.id!==body.source_id || !Number.isSafeInteger(initial.revision)||initial.revision<1)throw Error();
      approvedSource(initial.source,now());
      initial=JSON.parse(JSON.stringify(initial));
    }catch{return json({status:'rejected',reason:'source_not_approved'},403);}
    let lease;
    if(!dryRun){
      try{lease=await store.begin(body.source_id,initial.revision,initial.source);}
      catch{return json({status:'unavailable',reason:'staging_unavailable'},503);}
      if(lease?.status==='busy')return json({status:'busy',reason:'source_busy'},409);
      if(lease?.status!=='claimed'||!lease.run_id||!lease.lease_token)return json({status:'unavailable',reason:'staging_unavailable'},503);
    }
    const failRun=async reason=>{
      if(!lease)return;
      try{await store.fail(lease.run_id,lease.lease_token,reason);}catch{/* bounded lease expires if cleanup fails */}
    };
    let collected;
    try{
      collected=await collectEmployerFeed(body.source_id,{
        loadSource:async id=>{
          const current=await loadSource(id);
          if(!current || current.revision!==initial.revision || JSON.stringify(current.source)!==JSON.stringify(initial.source))throw Error('source_changed');
          return current;
        },roles,idx,now,fetchPage,maxRequests:body.max_requests??2,
      });
    }catch{await failRun('collection_failed');return json({status:'failed',reason:'collection_failed',published:0},503);}
    const summary={source_id:body.source_id,source_revision:collected.source_revision,
      requests_used:collected.requests_used,received:collected.received,accepted:collected.rows.length,
      rejected:collected.rejected,enumeration_complete:collected.enumeration_complete,published:0};
    if(collected.status==='failed'){
      await failRun(collected.reason);
      return json({...summary,status:'failed',reason:collected.reason},503);
    }
    if(dryRun)return json({...summary,status:collected.status,dry_run:true,reason:collected.reason});
    let staged;
    try{staged=await store.stage(lease.run_id,lease.lease_token,initial.revision,collected.rows,summary);}
    catch{await failRun('staging_failed');return json({...summary,status:'failed',reason:'staging_failed'},503);}
    if(!['staged','partial','already_staged'].includes(staged?.status)){
      await failRun('stale_lease');
      return json({...summary,status:'failed',reason:'staging_rejected'},409);
    }
    return json({...summary,status:staged.status,run_id:lease.run_id,candidates_promoted:staged.candidates_promoted??0,dry_run:false});
  };
}
