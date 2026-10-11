(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FJGuestResume=api;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
const KEY='fj_guest_resume_v1',TTL=2*60*60*1000;
const states={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function detect(text,catalog,resumeApi,now=new Date()){
 const lines=String(text||'').split(/\n/).map(s=>s.trim()).filter(Boolean);
 const base=resumeApi.suggest(text,catalog);
 const titles=[...new Set(catalog.titles||['Data Analyst','Data Engineer','Software Engineer','Product Manager'])].sort((a,b)=>b.length-a.length);
 const roles=[],intervals=[],latestRole=new Map();let employment=false,recentRole='',roleAt=-99;
 const months={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
 const datePart='(?:(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+)?((?:19|20)\\d{2})';
 const range=new RegExp(datePart+'\\s*(?:[-–—]|to)\\s*(?:'+datePart+'|(Present|Current|Now))','i');
 lines.forEach((line,i)=>{
  if(/^(?:professional |work |employment |relevant )?experience\b|^employment history\b|^work history\b/i.test(line)){employment=true;recentRole='';}
  if(/^(education|certifications?|projects?|skills|technical skills|references)\s*:?$/i.test(line)){employment=false;recentRole='';}
  const found=titles.find(t=>resumeApi.contains(line,t));
  if(found&&(employment||i<8)&&line.length<240){recentRole=found;roleAt=i;if(!roles.includes(found))roles.push(found);}
  const m=line.match(range);
  if(m&&employment&&recentRole&&i-roleAt<=4){
   const start=Number(m[2])*12+(m[1]?months[m[1].slice(0,3).toLowerCase()]:0);
   const end=m[5]?now.getFullYear()*12+now.getMonth():Number(m[4])*12+(m[3]?months[m[3].slice(0,3).toLowerCase()]:0);
   if(start<=end&&end<=now.getFullYear()*12+now.getMonth()&&start>=(now.getFullYear()-60)*12){intervals.push([start,end]);latestRole.set(recentRole,Math.max(end,latestRole.get(recentRole)||0));}
  }
 });
 intervals.sort((a,b)=>a[0]-b[0]);let duration=0,last=null;
 for(const interval of intervals){if(last&&interval[0]<=last[1])last[1]=Math.max(last[1],interval[1]);else{if(last)duration+=last[1]-last[0];last=interval.slice();}}if(last)duration+=last[1]-last[0];
 roles.sort((a,b)=>(latestRole.get(b)||0)-(latestRole.get(a)||0));
 let header=[];for(const line of lines.slice(0,14)){if(/^(?:professional |work |employment |relevant )?experience\b|^education\b|^employment history\b|^work history\b/i.test(line))break;header.push(line);}
 const statePattern=Object.values(states).sort((a,b)=>b.length-a.length).map(escape).join('|');
 const locPattern=new RegExp('(?:^|[,|•;])\\s*(?:Location|Address|Based in|Lives in|Home)?\\s*:?\\s*([A-Za-z][A-Za-z .\'-]{1,45}?)\\s*,?\\s+('+statePattern+'|'+Object.keys(states).join('|')+')(?:\\s+\\d{5}(?:-\\d{4})?)?(?:$|\\s*[,|•;])');
 let city='',region='',country='',locationUncertain=true;
 for(const line of header.flatMap(line=>line.split(/[|•;]/))){if(/@|https?:|university|college|school|employer|company|office|worked|\binc\b|\bllc\b|\bltd\b/i.test(line)||titles.some(t=>resumeApi.contains(line,t)))continue;const m=line.match(locPattern);if(m&&!/\bstreet\b|\bst\b|\bavenue\b|\broad\b/i.test(m[1])){city=m[1].trim();region=states[m[2]]||m[2];country='us';locationUncertain=false;break;}}
 // Explicit international header locations remain editable; never use an employer address.
 if(!city){const countries=catalog.countries||{'India':'in','United Kingdom':'gb','Canada':'ca','Australia':'au'};const pattern=new RegExp('^(?:(?:Location|Address|Based in|Lives in|Home)\\s*:\\s*)?([^,|]+)(?:,\\s*([^,|]+))?,\\s*('+Object.keys(countries).map(escape).join('|')+')\\s*$','i');for(const line of header.flatMap(line=>line.split(/[|•;]/))){if(/@|https?:|university|college|school|employer|company|office|worked/i.test(line)||titles.some(t=>resumeApi.contains(line,t)))continue;const m=line.match(pattern);if(m){city=m[1].trim();region=m[2]||'';country=countries[Object.keys(countries).find(c=>c.toLowerCase()===m[3].toLowerCase())];locationUncertain=false;break;}}}
 const explicitTitle=lines.find(line=>/^(?:current (?:job )?title|job title|target role|professional title)\s*:/i.test(line));
 const headerTitle=resumeApi.suggest(header.join('\n'),catalog).current_title;
 return {...base,current_title:explicitTitle?base.current_title:(headerTitle||roles[0]||''),roles,years_experience:base.years_experience==null?(duration?Math.round(duration/12*10)/10:null):base.years_experience,experienceEstimated:base.years_experience==null&&duration>0,city,region,country,locationUncertain};
}
function clean(profile){
 if(!profile||typeof profile.current_title!=='string'||profile.current_title.length>120||!profile.current_title.trim())return null;
 const years=profile.years_experience==null||profile.years_experience===''?null:Number(profile.years_experience);
 if(years!==null&&(!Number.isFinite(years)||years<0||years>60))return null;
 const skills=Array.isArray(profile.skills)?profile.skills.filter(s=>typeof s==='string'&&s.trim()).map(s=>s.trim().slice(0,80)).slice(0,30):[];
 return {match_id:/^[a-f0-9-]{36}$/.test(profile.match_id||'')?profile.match_id:'',current_title:profile.current_title.trim(),years_experience:years,skills,roles:Array.isArray(profile.roles)?profile.roles.filter(s=>typeof s==='string').map(s=>s.slice(0,120)).slice(0,20):[],city:String(profile.city||'').slice(0,80),region:String(profile.region||'').slice(0,80),country:/^[a-z]{2}$/.test(profile.country||'')?profile.country:'',scope:profile.scope==='region'&&profile.region?'region':'city',experienceEstimated:!!profile.experienceEstimated};
}
function save(storage,profile,now=Date.now()){const value=clean(profile);if(!value)throw new Error('Check your job title and experience.');if(!value.match_id)value.match_id=crypto.randomUUID();storage.setItem(KEY,JSON.stringify({expires:now+TTL,profile:value}));return value;}
function load(storage,now=Date.now(),expectedId=null){try{const value=JSON.parse(storage.getItem(KEY));if(!value||!Number.isFinite(value.expires)||value.expires<=now){storage.removeItem(KEY);return null;}const profile=clean(value.profile);return expectedId!==null&&profile?.match_id!==expectedId?null:profile;}catch{return null;}}
function clear(storage){storage.removeItem(KEY);}
function params(profile,mode='quick'){
 const p=clean(profile);if(!p)throw new Error('Check your profile.');
 const params=new URLSearchParams({q:p.current_title,mode:mode==='live'?'live':'quick',resume:'1'});
 if(p.match_id)params.set('resume_id',p.match_id);
 if(p.country)params.set('country',p.country);
 if(p.scope==='region'&&p.region){params.set('location',p.region);params.set('region',p.region);params.set('location_scope','region');}
 else if(p.city){params.set('location',[p.city,p.region].filter(Boolean).join(', '));params.set('city',p.city);if(p.region)params.set('region',p.region);}
 return params;
}
return {KEY,TTL,states,detect,clean,save,load,clear,params};
});
