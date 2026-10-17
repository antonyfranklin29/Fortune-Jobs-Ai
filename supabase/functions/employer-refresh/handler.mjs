const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
function sameSecret(a,b){if(!a||!b||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
async function bodyOf(request){
  if(!request.body||Number(request.headers.get('content-length'))>1024)throw Error();
  const reader=request.body.getReader();let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024)throw Error();chunks.push(value);}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
/** Coordinates the existing tested staging worker with private database settlement.
 * No user-selected URL, publication list or closure list is accepted from HTTP.
 * @param {{secret?:string, stage?:(request:Request)=>Promise<Response>,
 * claim?:(source:string|null)=>Promise<any>, finish?:(ticket:string,run:string)=>Promise<any>,
 * fail?:(ticket:string,reason:string)=>Promise<any>, health?:()=>Promise<any>,
 * maintenancePreview?:()=>Promise<any>,maintenanceHealth?:()=>Promise<any>}} options
 */
export function createEmployerRefreshHandler({secret,stage,claim,finish,fail,health,maintenancePreview,maintenanceHealth}={}){
  return async request=>{
    if(request.method!=='POST')return json({status:'rejected',reason:'method_not_allowed'},405);
    if(!secret)return json({status:'unavailable',reason:'worker_not_configured'},503);
    if(!sameSecret(request.headers.get('x-ingest-secret')||'',secret))return json({status:'rejected',reason:'unauthorised'},401);
    let body;try{body=await bodyOf(request);}catch{return json({status:'rejected',reason:'invalid_body'},400);}
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['action','source_id'].includes(k))||
      !['refresh','health','maintenance_preview','maintenance_health'].includes(body.action)||
      (body.source_id!==undefined&&(typeof body.source_id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.source_id)))||
      (body.action!=='refresh'&&body.source_id!==undefined))return json({status:'rejected',reason:'invalid_body'},400);
    try{
      if(body.action==='health')return json(await health());
      if(body.action==='maintenance_preview')return json(await maintenancePreview());
      if(body.action==='maintenance_health')return json(await maintenanceHealth());
      const admitted=await claim(body.source_id??null);
      if(admitted?.status==='disabled')return json({status:'disabled',reason:'employer_refresh_disabled'},503);
      if(admitted?.status==='busy')return json({status:'busy'},409);
      if(admitted?.status==='idle')return json({status:'idle'});
      if(admitted?.status!=='claimed'||!admitted.ticket||!admitted.source_id||
        !Number.isInteger(admitted.max_requests)||admitted.max_requests<1||admitted.max_requests>6)throw Error();
      let staged;
      try{
        const response=await stage(new Request('https://internal.invalid/employer-feed',{
          method:'POST',headers:{'content-type':'application/json','x-ingest-secret':secret},
          body:JSON.stringify({source_id:admitted.source_id,dry_run:false,max_requests:admitted.max_requests})}));
        staged=await response.json();
        if(!response.ok||!['staged','partial','already_staged'].includes(staged?.status)||!staged.run_id){
          // Never echo provider exceptions, permission references or secret values.
          await fail(admitted.ticket,'collection_or_staging_failed');
          return json({status:'failed',reason:'collection_or_staging_failed',published:0,closed:0},503);
        }
      }catch{
        await fail(admitted.ticket,'collection_or_staging_failed');
        return json({status:'failed',reason:'collection_or_staging_failed',published:0,closed:0},503);
      }
      try{return json(await finish(admitted.ticket,staged.run_id));}
      catch{
        await fail(admitted.ticket,'settlement_failed');
        return json({status:'failed',reason:'settlement_failed',published:0,closed:0},503);
      }
    }catch{return json({status:'unavailable',reason:'backend_unavailable'},503);}
  };
}
