(function(root) {
  'use strict';
  const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, ' ').replace(/\bpower\s+bi\b/g,'powerbi').replace(/\b(front|back)\s+end\b/g,'$1end').trim();
  const words = value => normalize(value).split(/\s+/).filter(Boolean);
  const ignored = new Set(['a','an','and','the','of','for','to','in','on','at','with','or','job','jobs','role','roles','position','positions']);
  const countryCode = value => ({uk:'gb',usa:'us','united states':'us','united states of america':'us','united kingdom':'gb',india:'in',canada:'ca',australia:'au'})[normalize(value)] || normalize(value);
  const cityName = value => ({'new york city':'new york',nyc:'new york',bangalore:'bengaluru','saint louis':'st louis'})[normalize(value)] || normalize(value);
  const stem = word => ({engineers:'engineer',developers:'developer',analysts:'analyst',managers:'manager',mgr:'manager',designers:'designer',sr:'senior',jr:'junior'})[word] || word;
  function metadata(job) {
    let value = job.source_metadata;
    for (let i=0; i<2 && typeof value==='string'; i++) { try { value=JSON.parse(value); } catch { return {}; } }
    return value && typeof value==='object' && !Array.isArray(value) ? value : {};
  }
  function titleMatches(title, query) {
    const wanted = words(query).filter(w=>!ignored.has(w)).map(stem);
    const actual = new Set(words(title).map(stem));
    if (!wanted.length || !actual.size) return false;
    // Explicit role equivalents, bounded to software roles rather than all engineers.
    if (wanted.includes('software') && wanted.some(w=>w==='engineer'||w==='developer')) {
      const role = actual.has('engineer') || actual.has('developer');
      const domain = ['software','backend','frontend','fullstack','web','android','ios'].some(w=>actual.has(w)) || (actual.has('full')&&actual.has('stack'));
      return role && domain && wanted.filter(w=>w!=='software'&&w!=='engineer'&&w!=='developer').every(w=>actual.has(w));
    }
    return wanted.every(w=>actual.has(w));
  }
  function canonicalUrl(value) {
    try {
      const url=new URL(value);
      if (!['https:','http:'].includes(url.protocol) || url.username || url.password) return '';
      const jobKey=url.searchParams.get('jk');
      if (/(^|\.)indeed\.com$/.test(url.hostname) && jobKey) return 'indeed:'+jobKey;
      for (const key of [...url.searchParams.keys()]) if (/^(utm_|xkcb|from$|source$|ref$|referrer$|tracking)/i.test(key)) url.searchParams.delete(key);
      url.searchParams.sort();
      return url.hostname.toLowerCase()+url.pathname.replace(/\/$/,'')+'?'+url.searchParams.toString()+url.hash;
    } catch { return ''; }
  }
  function employment(value) {
    return normalize(value).replace(/\s/g,'').replace(/^fulltime.*$/,'fulltime').replace(/^parttime.*$/,'parttime');
  }
  function workMode(job, data) {
    const declared=normalize(job.work_mode || data.workArrangement?.locationType || data.workArrangement?.remoteWorkType);
    const settings=(data.meta?.workSetting || []).map(v=>typeof v==='string'?v:v.label || v.text || '').map(normalize);
    const evidence=[declared,...settings,...(data.workArrangement?.remoteAttributes || []).map(v=>normalize(typeof v==='string'?v:v.label || v.text))].join(' ');
    if (/\bhybrid\b/.test(evidence)) return 'hybrid';
    if (job.is_remote===true || data.workArrangement?.isRemote===true || /\bremote\b/.test(evidence)) return 'remote';
    if (/\bon site\b|\bonsite\b/.test(evidence)) return 'onsite';
    // A false remote flag does not establish that a job is fully on-site.
    return '';
  }
  function experience(job, data) {
    const explicit=normalize(data.requirements?.experienceLevel || job.experience_level);
    const title=normalize(job.job_title);
    if (/\bintern(ship)?\b/.test(explicit+' '+title)) return 'internship';
    if (/\bexecutive\b|\bchief\b|\bvice president\b/.test(explicit+' '+title)) return 'executive';
    if (/\bdirector\b/.test(explicit+' '+title)) return 'director';
    if (/\bentry\b|\bjunior\b|\bjr\b/.test(explicit+' '+title)) return 'entry';
    if (/\bassociate\b/.test(explicit+' '+title)) return 'associate';
    if (/\bmid\b|\bsenior\b|\bsr\b|\blead\b|\bprincipal\b|\bstaff\b/.test(explicit+' '+title)) return 'mid_senior';
    return '';
  }
  function locationMatches(job, filters, data) {
    const wanted=cityName(filters.city || String(filters.location || '').split(',')[0]);
    if (!wanted) return true;
    const actual=cityName(data.location?.city || String(job.location || '').split(',')[0].replace(/\s+\d{5}(?:-\d{4})?\s*$/, '').replace(/\s+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i,''));
    if (wanted!==actual) return false;
    const regionName=value=>normalize(value).replace(/\s+(state|province)$/,'');
    if (filters.region && data.location?.stateName && regionName(filters.region)!==regionName(data.location.stateName) && regionName(filters.region)!==regionName(data.location.state)) return false;
    if (filters.region && !data.location?.stateName) {
      const region=String(job.location || '').split(',')[1] || '';
      if(regionName(filters.region)!==regionName(region)) return false;
    }
    return true;
  }
  function matchReason(job, query, filters={}) {
    const evidence=[`Relevant to your "${query}" search`];
    if(filters.location || filters.city) evidence.push(`in ${job.location}`);
    if(filters.work_mode) evidence.push(`${filters.work_mode} work arrangement`);
    if(filters.job_type) evidence.push(`matches your job type filter`);
    if(filters.date_posted) evidence.push(`posted within ${filters.date_posted} days`);
    return evidence.slice(0,3).join('; ')+'.';
  }
  function matches(job, query, filters={}, now=Date.now()) {
    const data=metadata(job);
    if (!titleMatches(job.job_title,query) || !canonicalUrl(job.apply_url)) return false;
    if (!locationMatches(job,filters,data)) return false;
    if (filters.country && countryCode(job.country || data.location?.country)!==countryCode(filters.country)) return false;
    if (filters.company && !normalize(job.company).includes(normalize(filters.company))) return false;
    if (filters.work_mode && workMode(job,data)!==normalize(filters.work_mode)) return false;
    if (filters.job_type) {
      const types=[job.employment_type,...(Array.isArray(data.classification?.jobType)?data.classification.jobType:[])].filter(Boolean).map(v=>employment(typeof v==='string'?v:v.label || v.text));
      if (!types.includes(employment(filters.job_type))) return false;
    }
    if (filters.experience && experience(job,data)!==filters.experience) return false;
    const expiry=Date.parse(data.dates?.validThrough);
    if (data.meta?.isExpired===true || (Number.isFinite(expiry)&&expiry<now)) return false;
    if (filters.date_posted) {
      // Use the original posting date, never the scrape/storage date.
      const posted=Date.parse(job.posted_at || data.dates?.posted);
      const days=Number(filters.date_posted);
      if (!Number.isFinite(posted) || !Number.isFinite(days) || days<=0 || posted>now || posted<now-days*86400000) return false;
    }
    return true;
  }
  function filterJobs(rows, query, filters={}, now=Date.now()) {
    const urls=new Set(), ids=new Set();
    return rows.filter(job=> {
      if (!matches(job,query,filters,now)) return false;
      const data=metadata(job), url=canonicalUrl(job.apply_url), id=data.id ? String(data.id) : '';
      if (urls.has(url) || (id && ids.has(id))) return false;
      urls.add(url); if(id) ids.add(id); return true;
    });
  }
  const api={normalize,metadata,titleMatches,canonicalUrl,workMode,experience,locationMatches,matches,filterJobs,matchReason};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.FJAccuracy=api;
})(typeof window!=='undefined'?window:this);
