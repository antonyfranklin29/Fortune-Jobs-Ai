const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../data-safety.js');
test('links reject scripts, credential URLs and control characters',()=>{
 for(const u of ['javascript:alert(1)','data:text/html,test','https://user:pass@example.com/a','https://example.com/\nnext','//example.com/a'])assert.equal(S.httpUrl(u),'');
 assert.equal(S.httpUrl('https://example.com/a?b="x"'),'https://example.com/a?b=%22x%22');
});
test('avatars require the configured bucket, host and current owner',()=>{
 const base='https://project.supabase.co',url=base+'/storage/v1/object/public/avatars/u/avatar.png';
 assert.equal(S.avatarPath(url,base,'u'),'u/avatar.png');
 for(const value of [url.replace('/u/','/other/'),url.replace('project.supabase.co','example.com'),url.replace('/avatars/','/resumes/'),url.replace('avatar.png','nested/avatar.png')])assert.equal(S.avatarPath(value,base,'u'),'');
 assert.equal(S.ownedPath('u/../other/file.pdf','u'),false);
});
function harness(options={}){
 const calls=[];let count=0;
 const sb={from(){return{update(fields){calls.push(['update',fields]);return{eq(k,v){calls.push(['eq',k,v]);return this},is(k,v){calls.push(['is',k,v]);return this},select(){return this},async maybeSingle(){count++;return count===1?options.clear||{data:{resume_path:null}}:options.restore||{data:{resume_path:'u/old.pdf'}}}}}}},storage:{from(){return{async remove(paths){calls.push(['remove',paths]);if(options.throwStorage)throw Error('network');return options.storage||{}}}}}};
 return{sb,calls};
}
test('database failure never deletes the resume',async()=>{
 const h=harness({clear:{error:true}});await assert.rejects(S.removeResume(h.sb,'u',{resume_path:'u/old.pdf'}),/was not removed/);assert.equal(h.calls.some(c=>c[0]==='remove'),false);
});
test('concurrent profile replacement prevents stale deletion',async()=>{
 const h=harness({clear:{data:null}});await assert.rejects(S.removeResume(h.sb,'u',{resume_path:'u/old.pdf'}));assert.equal(h.calls.some(c=>c[0]==='remove'),false);
});
test('successful removal clears profile then deletes only its owned file',async()=>{
 const h=harness();const r=await S.removeResume(h.sb,'u',{resume_path:'u/old.pdf'});assert.equal(r.resume_path,null);assert.equal(h.calls.filter(c=>c[0]==='update').length,1);assert.deepEqual(h.calls.find(c=>c[0]==='remove')[1],['u/old.pdf']);
});
test('storage failure conditionally restores details without overwriting a new upload',async()=>{
 const h=harness({throwStorage:true});await assert.rejects(S.removeResume(h.sb,'u',{resume_path:'u/old.pdf',resume_text:'synthetic'}),/were restored/);assert.ok(h.calls.some(c=>c[0]==='is'&&c[1]==='resume_path'&&c[2]===null));
 const other=harness({storage:{error:true},restore:{data:null}});await assert.rejects(S.removeResume(other.sb,'u',{resume_path:'u/old.pdf'}),/latest profile was not overwritten/);
});
test('foreign file paths cannot trigger storage or profile mutations',async()=>{
 const h=harness();await assert.rejects(S.removeResume(h.sb,'u',{resume_path:'other/old.pdf'}),/does not belong/);assert.equal(h.calls.length,0);
});
test('account export scopes all reads to the owner and includes paginated history',async()=>{
 const scopes=[],ranges=[];
 const sb={from(table){return{select(){return this},eq(k,v){scopes.push([table,k,v]);return this},async single(){return{data:{id:'u',resume_text:'synthetic'}}},async maybeSingle(){return{data:{user_id:'u',subscribed:false}}},order(){return this},async range(a,b){ranges.push([table,a,b]);return{data:table==='search_history'&&a===0?Array.from({length:100},(_,id)=>({id})):[{id:100}]}}}}};
 const result=await S.exportAccount(sb,'u');assert.equal(result.search_history.length,101);assert.equal(result.profile.resume_text,'synthetic');assert.equal(result.newsletter_preferences.user_id,'u');assert.ok(scopes.every(c=>c[2]==='u'));assert.deepEqual(ranges.filter(c=>c[0]==='search_history').map(c=>c[1]),[0,100]);
});
test('account export does not return a misleading partial copy after an error',async()=>{
 const sb={from(){return{select(){return this},eq(){return this},async single(){return{data:{id:'u'}}},async maybeSingle(){return{error:true}},order(){return this},async range(){return{error:true}}}}};
 await assert.rejects(S.exportAccount(sb,'u'),/no partial file/);await assert.rejects(S.exportAccount(sb,''),/Sign in/);
});

test('Adzuna attribution uses a fixed safe link and detects saved source URLs',()=>{
 assert.ok(S.adzunaAttribution({source:'adzuna',apply_url:'https://example.com'}).includes('https://www.adzuna.com/'));
 assert.ok(S.adzunaAttribution({apply_url:'https://www.adzuna.com/land/ad/1'}).includes('min-width:116px'));
 assert.equal(S.adzunaAttribution({apply_url:'https://adzuna.com.evil.example'}),'');
 assert.equal(S.adzunaAttribution({apply_url:'javascript:alert(1)'}),'');
});
