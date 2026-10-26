(function(root){
  'use strict';
  const states=typeof module==='object'&&module.exports?require('./guest-resume.js').states:root.FJGuestResume.states;
  const normalize=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().trim();
  const entries=Object.entries(states).map(([code,name])=>({code,name,admin1:name,country:'United States',country_code:'US',scope:'region',kind:code==='DC'?'District':'State'}));
  const countries={us:'United States',ca:'Canada',gb:'United Kingdom',in:'India',au:'Australia',nz:'New Zealand',ie:'Ireland',de:'Germany',fr:'France',nl:'Netherlands',es:'Spain',it:'Italy',ch:'Switzerland',be:'Belgium',se:'Sweden',pl:'Poland',ae:'United Arab Emirates',sa:'Saudi Arabia',qa:'Qatar',sg:'Singapore',my:'Malaysia',ph:'Philippines',jp:'Japan',hk:'Hong Kong',za:'South Africa',ng:'Nigeria',mx:'Mexico',br:'Brazil',ar:'Argentina'};
  function countryExact(query){
    const q=normalize(query);
    const aliases={usa:'us',us:'us','united states of america':'us',uk:'gb'};
    const code=aliases[q]||Object.keys(countries).find(key=>q===normalize(countries[key]));
    return code?{name:countries[code],country:countries[code],country_code:code,scope:'country'}:null;
  }
  function suggestions(query,country=''){
    const q=normalize(query).split(',')[0].trim();
    if(q.length<2 || (country && country.toLowerCase()!=='us'))return [];
    return entries.filter(r=>normalize(r.name).startsWith(q)||r.code.toLowerCase()===q).sort((a,b)=>(normalize(a.name)===q?-1:0)-(normalize(b.name)===q?-1:0)||a.name.localeCompare(b.name)).slice(0,8);
  }
  function exact(query,country=''){
    const q=normalize(query).split(',')[0].trim();
    return suggestions(query,country).find(r=>normalize(r.name)===q||r.code.toLowerCase()===q)||null;
  }
  const api={suggestions,exact,countryExact};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FJRegions=api;
})(typeof window==='object'?window:globalThis);
