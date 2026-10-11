// Read-only smoke checks. No account data, credentials, paid search or scraper runs.
const fs=require('node:fs');
const pages=['index.html','find-jobs.html','results.html','resume-search.html','profile.html','privacy.html','contact.html','data-safety.js'];
(async()=>{
 const rows=await Promise.all(pages.map(async page=>{
   const start=Date.now();
   try{const response=await fetch('https://fortunejobsai.com/'+page+'?health=20261011',{signal:AbortSignal.timeout(10000)});const text=await response.text();return{page,status:response.status,ms:Date.now()-start,ok:response.ok&&text.length>100};}
   catch(error){return{page,ok:false,error:error.name};}
 }));
 const report={checked_at:new Date().toISOString(),scope:'Public asset availability only; excludes authentication, database health, scraper and payments.',rows};
 if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));if(rows.some(r=>!r.ok))process.exitCode=1;
})();
