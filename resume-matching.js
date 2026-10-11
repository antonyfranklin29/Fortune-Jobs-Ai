(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FJResume=api;})(typeof globalThis==='object'?globalThis:this,function(){
  const skills=['JavaScript','TypeScript','Python','Java','C++','C#','SQL','React','Angular','Vue','Node.js','Django','Flask','Spring','AWS','Azure','Google Cloud','Docker','Kubernetes','Git','Power BI','Tableau','Excel','Figma','Salesforce','SAP','HTML','CSS','PostgreSQL','MongoDB','Machine Learning','Data Analysis','Project Management','Customer Service','Nursing','Accounting'];
  function contains(text,term){const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(^|[^a-z0-9])'+escaped+'(?=$|[^a-z0-9])','i').test(text);}
  function suggest(text,catalog={}){
    const lines=String(text||'').split(/\n/).map(s=>s.trim()).filter(Boolean);
    const listedRole=lines.slice(0,8).find(line=>(catalog.titles||['Software Engineer','Data Analyst','Product Manager','Registered Nurse','Accountant','Marketing Manager','UX Designer']).some(title=>title.toLowerCase()===line.toLowerCase()));
    const role=lines.find(s=>/^(?:current (?:job )?title|job title|target role|professional title)\s*:/i.test(s));
    const years=String(text).match(/\b(\d{1,2}(?:\.\d)?)\+?\s+years?\s+(?:of\s+)?(?:professional\s+|relevant\s+)?experience\b/i);
    return {current_title:role?role.replace(/^[^:]+:\s*/,'').slice(0,120):(listedRole||''),years_experience:years&&Number(years[1])<=60?Number(years[1]):null,skills:[...new Set([...skills,...(catalog.skills||[])])].filter(s=>contains(text,s))};
  }
  function rank(jobs,profile,metadata){
    if(!profile||(!(profile.skills||[]).length&&profile.years_experience==null))return jobs;
    return jobs.map((job,index)=>{
      const m=metadata?metadata(job):{};
      const text=[job.job_title,job.job_description,m.snippet,JSON.stringify(m.classification||{}),JSON.stringify(m.requirements||{})].filter(Boolean).join(' ');
      const hits=(profile.skills||[]).filter(s=>typeof s==='string'&&s.trim()&&contains(text,s.trim()));
      const requirements=text.match(/\b(\d{1,2})\+?\s*(?:-|to)\s*\d{1,2}\s+years?\b/i)||text.match(/\b(\d{1,2})\+?\s+years?\s+(?:of\s+)?experience\b/i);
      const years=profile.years_experience==null?null:Number(profile.years_experience);
      const shortfall=requirements&&Number.isFinite(years)?Math.max(0,Number(requirements[1])-years):0;
      const evidence=hits.length?'Your profile skills listed in this job: '+hits.slice(0,5).join(', ')+'.':'';
      const caution=shortfall?' Listing asks for '+requirements[1]+'+ years of experience; review this requirement.':'';
      return {job:{...job,match_reason:[job.match_reason,evidence].filter(Boolean).join(' ')+caution},rank:hits.length*10-shortfall*3,index};
    }).sort((a,b)=>b.rank-a.rank||a.index-b.index).map(x=>x.job);
  }
  return {suggest,rank,contains};
});
