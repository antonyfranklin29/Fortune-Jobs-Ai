const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../resume-matching.js'),A=require('../search-accuracy.js');
test('suggestions only use explicit evidence and distinguish Java from JavaScript',()=>{
 const p=R.suggest('Current title: Data Analyst\n5 years of experience\nSQL, JavaScript, Power BI');
 assert.equal(p.current_title,'Data Analyst');assert.equal(p.years_experience,5);assert.ok(p.skills.includes('JavaScript'));assert.ok(!p.skills.includes('Java'));assert.ok(p.skills.includes('Power BI'));
 assert.equal(R.suggest('Worked 2020–2025').years_experience,null);assert.equal(R.suggest('Alex Test\nSoftware engineer').current_title,'Software engineer');
});
test('confirmed skills rank original listing evidence and explain experience gaps',()=>{
 const jobs=[{job_title:'Software Engineer',apply_url:'https://example.com/a',job_description:'Java; requires 8 years of experience',match_reason:'Relevant title.'},{job_title:'Software Engineer',apply_url:'https://example.com/b',job_description:'Python and SQL',match_reason:'Relevant title.'}];
 const ranked=R.rank(jobs,{skills:['Python','SQL'],years_experience:2},A.metadata);
 assert.equal(ranked[0].apply_url,'https://example.com/b');assert.match(ranked[0].match_reason,/Python, SQL/);assert.match(ranked[1].match_reason,/8\+ years/);assert.equal(jobs[0].match_reason,'Relevant title.');
});
test('profile matching never introduces jobs excluded by search filters',()=>{
 const jobs=[{job_title:'Software Engineer',company:'A',location:'London',country:'gb',apply_url:'https://example.com/uk',job_description:'Python SQL'},{job_title:'Software Engineer',company:'B',location:'New York',country:'us',apply_url:'https://example.com/us',job_description:'Java'}];
 const result=R.rank(A.filterJobs(jobs,'software engineer',{country:'us'}),{skills:['Python']},A.metadata);
 assert.equal(result.length,1);assert.equal(result[0].country,'us');assert.doesNotMatch(result[0].match_reason||'',/profile skills/);
});
test('live source metadata supports skill evidence and profiles without skills preserve ranking',()=>{
 const jobs=[{job_title:'Engineer',source_metadata:JSON.stringify({snippet:'React TypeScript'})}];
 assert.match(R.rank(jobs,{skills:['React']},A.metadata)[0].match_reason,/React/);assert.equal(R.rank(jobs,null,A.metadata),jobs);
});
const html=fs.readFileSync('profile.html','utf8');
function source(name){return html.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^}', 'm'))[0];}
test('all profile inline scripts parse',()=>{for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);});
test('save preserves fractional experience and reviewed fields before replacing old file',async()=>{
 const calls=[],fields={reviewTitle:{value:'Data Analyst'},reviewYears:{value:'4.5'},reviewSkills:{value:'Python, SQL, Python'},reviewText:{value:'Reviewed synthetic resume text'},saveResumeReview:{isConnected:true},cancelResumeReview:{},resumeSlot:{insertAdjacentHTML(){}}};
 const c={resumeSaving:false,resumeDraft:{file:{name:'fixture.docx'},ext:'docx'},profile:{resume_path:'user/old.pdf'},user:{id:'user'},crypto:require('node:crypto'),$:id=>fields[id],hideMsg(){},showMsg(id,text){throw Error(text)},cancelResumeReview(){},fillForm(){},renderHero(){},toast(){},encodeURIComponent,
 FJ:{sb:{storage:{from(){return {async upload(path){calls.push(['upload',path]);return{}},async remove(paths){calls.push(['remove',paths]);return{}}}}},from(){return {update(p){calls.push(['update',p]);return{eq(){return{select(){return{async single(){return{data:p,error:null}}}}}}}}}}}}};
 vm.createContext(c);vm.runInContext(source('saveResumeReview'),c);await c.saveResumeReview();
 assert.deepEqual(calls.map(x=>x[0]),['upload','update','remove']);assert.notEqual(calls[0][1],'user/old.pdf');assert.equal(calls[1][1].current_title,'Data Analyst');assert.equal(calls[1][1].years_experience,4.5);assert.deepEqual(Array.from(calls[1][1].skills),['Python','SQL']);
});
test('raw resume text and identity are not sent to live search',()=>{const h=fs.readFileSync('index.html','utf8');const fn=h.match(/^function accountPayload[^\n]+/m)[0];const c={};vm.createContext(c);vm.runInContext(fn,c);assert.equal(Object.keys(c.accountPayload()).length,0);assert.doesNotMatch(h,/Data Analyst with resume:/);});

test('failed profile save removes only the new upload and keeps the previous resume',async()=>{
 const calls=[],fields={reviewTitle:{value:'Data Analyst'},reviewYears:{value:'4'},reviewSkills:{value:'Python, SQL, Python'},reviewText:{value:'Reviewed synthetic resume text'},saveResumeReview:{isConnected:true},cancelResumeReview:{},resumeSlot:{insertAdjacentHTML(){}}};
 const c={resumeDraft:{file:{name:'fixture.docx'},ext:'docx'},profile:{resume_path:'user/old.pdf'},user:{id:'user'},crypto:require('node:crypto'),$:id=>fields[id],hideMsg(){},showMsg(id,text){calls.push(['error',text])},cancelResumeReview(){},fillForm(){},renderHero(){},toast(){},encodeURIComponent,
 FJ:{sb:{storage:{from(){return {async upload(path){calls.push(['upload',path]);return{}},async remove(paths){calls.push(['remove',paths]);return{}}}}},from(){return {update(p){calls.push(['update',p]);return{eq(){return{select(){return{async single(){return{data:null,error:{message:"database failure"}}}}}}}}}}}}}};
 vm.createContext(c);vm.runInContext(source('saveResumeReview'),c);await c.saveResumeReview();
 assert.deepEqual(calls.map(x=>x[0]),['upload','update','remove','error']);assert.equal(c.profile.resume_path,'user/old.pdf');assert.equal(calls[2][1][0],calls[0][1]);assert.notEqual(calls[0][1],'user/old.pdf');assert.equal(calls[1][1].current_title,'Data Analyst');assert.equal(calls[1][1].years_experience,4);assert.deepEqual(Array.from(calls[1][1].skills),['Python','SQL']);
});
