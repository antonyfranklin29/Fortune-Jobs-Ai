const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const G=require('../guest-resume.js'),R=require('../resume-matching.js'),A=require('../search-accuracy.js');
const catalog={titles:['Data Analyst','Data Engineer','Software Engineer'],skills:['Python','SQL','Power BI']};
const now=new Date('2026-10-11T12:00:00Z');
const detect=t=>G.detect(t,catalog,R,now);
function storage(){const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),m};}
test('Edison home header triggers Data Analyst matching across New Jersey',()=>{
 const p=detect('Synthetic Applicant\nEdison, NJ 08817\nProfessional Experience\nData Analyst\nJanuary 2020 - January 2024\nSkills\nPython, SQL, Power BI');
 assert.equal(p.current_title,'Data Analyst');assert.equal(p.city,'Edison');assert.equal(p.region,'New Jersey');assert.equal(p.country,'us');assert.equal(p.years_experience,4);
 const q=G.params({...p,scope:'region'},'live');assert.equal(q.get('location'),'New Jersey');assert.equal(q.get('region'),'New Jersey');assert.equal(q.get('location_scope'),'region');assert.equal(q.get('resume'),'1');assert.equal(q.has('resume_text'),false);assert.equal(q.has('skills'),false);
});
test('overlapping work dates are counted once; explicit years take precedence',()=>{
 const text='Edison, New Jersey\nWork Experience\nData Analyst\nJan 2020 - Jan 2024\nData Engineer\nJan 2022 - Jan 2025\nEducation\n2010 - 2018';
 assert.equal(detect(text).years_experience,5);assert.equal(detect(text).current_title,'Data Engineer');assert.equal(detect('7 years of experience\n'+text).years_experience,7);
});
test('employer and education addresses do not become a home address',()=>{
 const p=detect('Synthetic Applicant\nWork Experience\nData Analyst\nAcme Company\nEdison, NJ 08817\nJan 2020 - Jan 2024\nEducation\nBoston, MA');assert.equal(p.city,'');assert.equal(p.locationUncertain,true);
 assert.equal(detect('Location: Toronto, Ontario, Canada\nData Analyst').country,'ca');
 assert.equal(detect('test@example.invalid | Edison, NJ\nData Analyst').city,'Edison');
});
test('unknown experience stays unknown and future employment is not counted',()=>{assert.equal(detect('Data Analyst\nSkills\nSQL').years_experience,null);assert.equal(detect('Experience\nData Analyst\nJan 2027 - Jan 2030').years_experience,null);});
test('temporary storage excludes full résumé, expires, and can be cleared',()=>{
 const s=storage();const p={current_title:'Data Analyst',skills:['SQL'],city:'Edison',region:'New Jersey',country:'us',resume_text:'PRIVATE SENTINEL',email:'private@example.invalid'};G.save(s,p,1000);assert.equal(JSON.stringify([...s.m.values()]).includes('PRIVATE SENTINEL'),false);assert.equal(JSON.stringify([...s.m.values()]).includes('private@example.invalid'),false);assert.ok(G.load(s,2000));assert.equal(G.load(s,1000+G.TTL),null);G.save(s,p);G.clear(s);assert.equal(G.load(s),null);
});
test('malformed temporary profiles are rejected without changing account profiles',()=>{const s=storage();assert.throws(()=>G.save(s,{current_title:'Data Analyst',years_experience:-1}));s.setItem(G.KEY,'not json');assert.equal(G.load(s),null);assert.equal(G.clean({current_title:''}),null);});
test('state search accepts verified NJ towns and rejects NY or unknown regions',()=>{
 const filters={location:'New Jersey',region:'New Jersey',location_scope:'region',country:'us'};
 const jobs=[{job_title:'Data Analyst',company:'Test',location:'Newark, NJ',country:'us',apply_url:'https://example.com/nj'},{job_title:'Data Analyst',company:'Test',location:'New York, NY',country:'us',apply_url:'https://example.com/ny'},{job_title:'Data Analyst',company:'Test',location:'Remote',country:'us',apply_url:'https://example.com/remote'}];assert.deepEqual(A.filterJobs(jobs,'Data Analyst',filters).map(j=>j.apply_url),['https://example.com/nj']);
 assert.equal(A.matches({...jobs[0],source_metadata:{location:{city:'Trenton',state:'NJ',country:'US'}}},'Data Analyst',filters),true);
 assert.equal(A.matches(jobs[0],'Data Analyst',{location:'Edison',region:'New Jersey',country:'us'}),false);
});
test('guest page and entry point contain no account or résumé-storage requirement',()=>{
 const page=fs.readFileSync('resume-search.html','utf8'),code=fs.readFileSync('guest-resume-page.js','utf8');assert.doesNotMatch(page,/auth.js|config.js|login.html/);assert.doesNotMatch(code,/FJ\.sb|storage\.from|resume_text/);const home=fs.readFileSync('index.html','utf8');assert.match(home,/function goUploadResume\(\) \{\s*location.href = 'resume-search.html'/);assert.match(home,/guest\s*\|\|\s*\(resumeChoice/);
});

test('an older results link cannot pick up a different newly uploaded résumé',()=>{const s=storage();const a=G.save(s,{current_title:'Data Analyst',skills:['SQL']},1000);const b=G.save(s,{current_title:'Software Engineer',skills:['Java']},1100);assert.notEqual(a.match_id,b.match_id);assert.equal(G.load(s,1200,a.match_id),null);assert.equal(G.load(s,1200,b.match_id).current_title,'Software Engineer');assert.equal(G.params(b).get('resume_id'),b.match_id);});

test('DOCX upload asks for review before saving temporary job fit details',async()=>{
 const vm=require('node:vm'),elements=new Map(),s=storage();let navigated;const navigation=new Promise(resolve=>navigated=resolve);
 const node=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,options:[],listeners:{},addEventListener(event,fn){this.listeners[event]=fn;},replaceChildren(){},append(){},scrollIntoView(){},reportValidity(){return true;}});return elements.get(id);};
 node('guestCountry').options=[{value:'us',textContent:'🇺🇸 United States'},{value:'ca',textContent:'🇨🇦 Canada'}];
 const location={search:''};Object.defineProperty(location,'href',{set(value){navigated(value);}});
 const mammoth=require('../vendor/mammoth.browser.js');
 const c={document:{getElementById:node,createElement(){return{};}},window:{JOB_SUGGESTIONS:catalog,mammoth},mammoth,FJGuestResume:G,FJResume:R,sessionStorage:s,location,URLSearchParams,console};
 vm.createContext(c);vm.runInContext(fs.readFileSync('guest-resume-page.js','utf8'),c);
 const bytes=fs.readFileSync(require('node:path').join(__dirname,'fixtures/guest-edison.docx'));node('guestResumeFile').files=[{name:'guest-edison.docx',size:bytes.length,arrayBuffer:async()=>new Uint8Array(bytes).buffer}];
 node('guestResumeFile').listeners.change();
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(node('guestReview').hidden,false);assert.equal(G.load(s),null);assert.equal(node('guestRole').value,'Data Analyst');
 node('guestYears').value=String(node('guestYears').value);
 node('guestReview').listeners.submit({preventDefault(){}});
 const url=await Promise.race([navigation,new Promise((_,reject)=>setTimeout(()=>reject(Error('Guest review did not continue')),2000))]);
 const params=new URL(url,'https://example.invalid/').searchParams;assert.equal(params.get('resume'),'1');assert.ok(params.get('resume_id'));assert.equal(G.load(s).years_experience,4);assert.doesNotMatch(JSON.stringify([...s.m.values()]),/Synthetic Guest Applicant|Built reporting dashboards/);
});
test('manual experience entry needs no résumé file or location',()=>{
 const vm=require('node:vm'),elements=new Map(),s=storage();let destination='';
 const node=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,options:[],listeners:{},addEventListener(event,fn){this.listeners[event]=fn;},replaceChildren(){},append(){},scrollIntoView(){},reportValidity(){return true;},click(){this.listeners.click?.();}});return elements.get(id);};
 node('guestCountry').options=[];
 const location={search:'?manual=1'};Object.defineProperty(location,'href',{set(value){destination=value;}});
 const c={document:{getElementById:node,createElement(){return{};}},window:{},FJGuestResume:G,FJResume:R,sessionStorage:s,location,URLSearchParams,console};
 vm.createContext(c);vm.runInContext(fs.readFileSync('guest-resume-page.js','utf8'),c);
 assert.equal(node('guestReview').hidden,false);
 node('guestRole').value='Data Analyst';node('guestSkills').value='SQL, Python';
 node('guestReview').listeners.submit({preventDefault(){}});
 assert.match(destination,/find-jobs\.html\?resume=1&resume_id=/);assert.deepEqual(G.load(s).skills,['SQL','Python']);assert.equal(G.load(s).country,'');
});
