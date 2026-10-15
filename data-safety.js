(function(root){
  'use strict';
  function httpUrl(value){
    try {
      if(typeof value!=='string'||value.length>4000||/[\u0000-\u001f\u007f]/.test(value))return '';
      const u=new URL(value);
      return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';
    }catch{return '';}
  }
  function adzunaAttribution(job){
    let isAdzuna=job?.source==='adzuna';
    try{isAdzuna=isAdzuna||/(^|\.)adzuna\.(com|co\.uk)$/.test(new URL(httpUrl(job?.apply_url)).hostname);}catch{}
    return isAdzuna?'<div class="job-source" style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid #e5e7eb;color:#596575"><span style="font-size:11px;line-height:1.4">Job source</span><a href="https://www.adzuna.com/" target="_blank" rel="noopener" style="display:inline-block;min-width:116px;min-height:23px;font:normal 23px/23px Arial,sans-serif;color:inherit;text-decoration:none" aria-label="Jobs supplied by Adzuna">Adzuna</a></div>':'';
  }
  function ownedPath(path,userId){
    return typeof path==='string'&&typeof userId==='string'&&path.startsWith(userId+'/')&&!path.includes('..')&&!path.includes('\\')&&path.split('/').length===2;
  }
  function avatarPath(url,base,userId){
    try{
      const u=new URL(url),b=new URL(base),prefix='/storage/v1/object/public/avatars/';
      if(u.protocol!=='https:'||u.origin!==b.origin||!u.pathname.startsWith(prefix))return '';
      const p=decodeURIComponent(u.pathname.slice(prefix.length));return ownedPath(p,userId)?p:'';
    }catch{return '';}
  }
  async function removeResume(sb,userId,profile){
    const path=profile.resume_path;
    if(!ownedPath(path,userId))throw Error('This resume does not belong to the current account. Reload your profile.');
    const previous={resume_path:path,resume_name:profile.resume_name,resume_text:profile.resume_text,resume_updated_at:profile.resume_updated_at};
    // Detach conditionally first: a failed database write never deletes the file.
    const cleared=await sb.from('profiles').update({resume_path:null,resume_name:null,resume_text:null,resume_updated_at:null}).eq('id',userId).eq('resume_path',path).select().maybeSingle();
    if(cleared.error||!cleared.data)throw Error('Could not update your profile. Your resume was not removed; reload and retry.');
    let removed;
    try{removed=await sb.storage.from('resumes').remove([path]);}catch{removed={error:true};}
    if(removed.error){
      // Never overwrite a different resume saved concurrently in another tab.
      const restored=await sb.from('profiles').update(previous).eq('id',userId).is('resume_path',null).select().maybeSingle();
      throw Error(restored.data&&!restored.error?'Could not delete the file. Your resume details were restored; please retry.':'The file could not be deleted. Contact support for cleanup; your latest profile was not overwritten.');
    }
    return cleared.data;
  }
  async function exportAccount(sb,userId){
    if(!userId)throw Error('Sign in before exporting your account.');
    const profile=await sb.from('profiles').select('*').eq('id',userId).single();
    if(profile.error||!profile.data)throw Error('Could not read your profile. No export was created.');
    async function rows(table){
      const all=[];
      for(let page=0;page<100;page++){
        const response=await sb.from(table).select('*').eq('user_id',userId).order('id').range(page*100,page*100+99);
        if(response.error)throw Error('Could not finish your export. Please retry; no partial file was created.');
        all.push(...response.data);
        if(response.data.length<100)return all;
      }
      throw Error('Your export is too large for this tool. Contact support for a complete export.');
    }
    const [saved,history]=await Promise.all([rows('saved_jobs'),rows('search_history')]);
    return {exported_at:new Date().toISOString(),profile:profile.data,saved_jobs:saved,search_history:history,note:'Includes saved profile and extracted resume text. Original resume and avatar files are not included.'};
  }
  const api={adzunaAttribution,httpUrl,ownedPath,avatarPath,removeResume,exportAccount};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FJDataSafety=api;
})(typeof globalThis!=='undefined'?globalThis:this);
