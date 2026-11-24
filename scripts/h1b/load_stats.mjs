import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const payload=JSON.parse(await readFile(process.argv[2],'utf8'));
if(payload.metadata?.test_fixture || payload.metadata?.source!=='https://www.dol.gov/agencies/eta/foreign-labor/performance' || !payload.rows?.length)throw Error('Only a nonempty official DOL aggregate may be loaded');
const window={};runInNewContext(await readFile(new URL('../../config.js',import.meta.url),'utf8'),{window});
const url=process.env.SUPABASE_URL || window.FJ_CONFIG.url,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!key)throw Error('Required service credential is not configured');
async function rpc(name,args){const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('H-1B upload failed with HTTP '+response.status);return response.json();}
const token=await rpc('h1b_import_start',{p_metadata:payload.metadata,p_count:payload.rows.length});
for(let i=0;i<payload.rows.length;i+=500)await rpc('h1b_stage',{p_token:token,p_rows:payload.rows.slice(i,i+500)});
const count=await rpc('h1b_import_finish',{p_token:token});
console.log('Loaded '+count+' employer-level aggregates; badges stay off until the public pages are reviewed and marked ready.');
