(function(root){
  'use strict';
  const states=typeof module==='object'&&module.exports?require('./guest-resume.js').states:root.FJGuestResume.states;
  const normalize=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().trim();
  const entries=Object.entries(states).map(([code,name])=>({code,name,admin1:name,country:'United States',country_code:'US',scope:'region',kind:code==='DC'?'District':'State'}));
  function suggestions(query,country=''){
    const q=normalize(query).split(',')[0].trim();
    if(q.length<2 || (country && country.toLowerCase()!=='us'))return [];
    return entries.filter(r=>normalize(r.name).startsWith(q)||r.code.toLowerCase()===q).sort((a,b)=>(normalize(a.name)===q?-1:0)-(normalize(b.name)===q?-1:0)||a.name.localeCompare(b.name)).slice(0,8);
  }
  function exact(query,country=''){
    const q=normalize(query).split(',')[0].trim();
    return suggestions(query,country).find(r=>normalize(r.name)===q||r.code.toLowerCase()===q)||null;
  }
  const api={suggestions,exact};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FJRegions=api;
})(typeof window==='object'?window:globalThis);
