(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FJResumeBuilder=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const clean=value=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
  const lines=value=>String(value||'').split(/\r?\n/).map(clean).filter(Boolean).slice(0,20);
  function draft(input){
    const data={name:clean(input.name).slice(0,120),email:clean(input.email).slice(0,200),phone:clean(input.phone).slice(0,80),location:clean(input.location).slice(0,120),link:clean(input.link).slice(0,300),target:clean(input.target).slice(0,120),summary:clean(input.summary).slice(0,1000),skills:lines(input.skills).slice(0,30),experience:lines(input.experience),education:lines(input.education),projects:lines(input.projects)};
    // No generated credentials, dates, achievements, employers, or skills.
    return data;
  }
  function advice(data){
    const items=[];
    if(!data.name)items.push('Add your name before exporting.');
    if(!data.email&&!data.phone)items.push('Add a contact method you want employers to use.');
    if(!data.target)items.push('Name the role you are targeting.');
    if(!data.experience.length&&!data.projects.length)items.push('Add real work or project evidence for this role.');
    if(!data.skills.length)items.push('Add only skills you can discuss in an interview.');
    if(data.experience.some(line=>/^\s*(responsible for|worked on)\b/i.test(line)))items.push('Consider describing what you did and the outcome; include numbers only if you can verify them.');
    return items;
  }
  return {draft,advice};
});
