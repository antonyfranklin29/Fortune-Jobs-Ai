import test from 'node:test';
import assert from 'node:assert/strict';
import {runRefresh} from '../scripts/employer-refresh.mjs';
const endpoint='https://fixture.supabase.test/functions/v1/employer-refresh';
test('disabled monitoring makes no provider-refresh request; endpoint redirects are refused',async()=>{
  const calls=[];
  const report=await runRefresh({url:endpoint,secret:'fixture-secret',publishableKey:'fixture-public',fetchImpl:async(url,init)=>{
    calls.push(JSON.parse(init.body).action);assert.equal(init.redirect,'error');
    assert.equal(init.headers['x-ingest-secret'],'fixture-secret');assert.equal(init.headers.authorization,'Bearer fixture-public');return Response.json({enabled:false});}});
  assert.equal(report.status,'disabled');assert.deepEqual(calls,['health']);
});
test('one due-source refresh is followed by actionable health monitoring',async()=>{
  for(const failed of [false,true]){
    const calls=[];const result=await runRefresh({url:endpoint,secret:'fixture-secret',fetchImpl:async(url,init)=>{
      const action=JSON.parse(init.body).action;calls.push(action);
      return Response.json(action==='health'?{enabled:true,failed_24h:failed?1:0,overdue_sources:0,degraded_24h:0}:{status:'complete',published:3});}});
    assert.equal(result.status,failed?'attention_required':'healthy');assert.deepEqual(calls,['health','refresh','health']);
  }
});
test('runner refuses credential URLs and handles HTTP failures without echoing secrets',async()=>{
  await assert.rejects(runRefresh({url:'https://user:secret@example.com',secret:'fixture'}),/invalid_refresh_endpoint/);
  await assert.rejects(runRefresh({url:endpoint,secret:'fixture',fetchImpl:async()=>new Response('private details',{status:503})}),/refresh_endpoint_failed/);
});
