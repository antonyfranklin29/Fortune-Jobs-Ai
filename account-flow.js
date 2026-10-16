(function(root){
 'use strict';
 const pages=new Set(['index.html','find-jobs.html','results.html','profile.html','resume-search.html','about.html','contact.html','privacy.html','email-preferences.html','employers.html']);
 function next(value,fallback='profile.html'){
  if(typeof value!=='string'||value.length>1800||/[\\\s\u0000-\u001f\u007f]/.test(value))return fallback;
  const pathname=value.split(/[?#]/)[0];
  return pages.has(pathname)?value:fallback;
 }
 function callbackError(search,hash){
  const query=new URLSearchParams(search),fragment=new URLSearchParams(String(hash||'').replace(/^#/,''));
  const code=query.get('error_code')||fragment.get('error_code')||query.get('error')||fragment.get('error');
  if(!code)return '';
  return /expired|otp_expired/i.test(code)?'This email link has expired or was already used. Request a new link.':/access_denied/i.test(code)?'Sign-in was cancelled or the link could not be verified. Please try again.':'Sign-in could not be completed. Please try again or use email.';
 }
 function providers(settings){return {google:settings?.external?.google===true};}
 function isEmployerNext(value){return next(value,'').split(/[?#]/)[0]==='employers.html';}
 function employerNext(value){return isEmployerNext(value)?value:'employers.html';}
 const api={next,callbackError,providers,isEmployerNext,employerNext};if(typeof module==='object'&&module.exports)module.exports=api;else root.FJAccountFlow=api;
})(typeof window==='object'?window:globalThis);
