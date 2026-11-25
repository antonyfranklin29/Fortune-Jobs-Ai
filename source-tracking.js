(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.FJSourceTracking = api; api.capture(root.location.search); api.captureLanding();
    root.document?.addEventListener('DOMContentLoaded', () => { api.logFunnel('landing'); });
    root.document?.addEventListener('click', event => {
      const button = event.target.closest?.('[data-partner-job]');
      if (!button) return;
      try { const job = JSON.parse(button.dataset.partnerJob); if (job.source === 'jobg8') api.navigate(job); } catch { /* Invalid listing data is inert. */ }
    });
  }
})(typeof window === 'object' ? window : null, function () {
  let memory;
  const clean = value => String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  const storage = () => { try { return window.sessionStorage; } catch { return null; } };
  function capture(search = '', store = storage()) {
    try {
      const existing = JSON.parse(store?.getItem('fj_src') || 'null');
      if (existing?.source) return { source: clean(existing.source) || 'organic', medium: clean(existing.medium), campaign: clean(existing.campaign) };
    } catch { /* Storage and malformed values must never prevent navigation. */ }
    if (!store && memory) return memory;
    const params = new URLSearchParams(search);
    const value = { source: clean(params.get('utm_source')) || clean(params.get('ref')) || 'organic',
      medium: clean(params.get('utm_medium')), campaign: clean(params.get('utm_campaign')) };
    try { store?.setItem('fj_src', JSON.stringify(value)); } catch { /* Private browsing can disable storage. */ }
    memory = value;
    return value;
  }
  function appendJobg8(original, source, method) {
    const parsed = new URL(original);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Invalid application URL');
    const additions = Object.entries({ source: clean(source.source) || 'organic', method: clean(method) || 'search', campaign: clean(source.campaign) })
      .filter(([key, value]) => value && !parsed.searchParams.has(key)).map(([key, value]) => key + '=' + encodeURIComponent(value));
    if (!additions.length) return original;
    const hash = original.indexOf('#'), head = hash < 0 ? original : original.slice(0, hash), tail = hash < 0 ? '' : original.slice(hash);
    return head + (/[?&]$/.test(head) ? '' : head.includes('?') ? '&' : '?') + additions.join('&') + tail;
  }
  function methodFor(location) {
    const params = new URLSearchParams(location.search);
    if (location.pathname.startsWith('/jobs/')) return 'jobpage';
    if (params.get('utm_medium') === 'alert') return 'alert';
    return params.get('mode') === 'live' ? 'live' : params.get('resume') === '1' ? 'match' : 'search';
  }
  function navigate(job, { method = methodFor(window.location), open = url => window.open(url, '_blank', 'noopener,noreferrer'), log = logClick } = {}) {
    const attribution = capture(typeof window === 'object' ? window.location.search : '');
    const url = job.source === 'jobg8' ? appendJobg8(job.apply_url, attribution, method) : job.apply_url;
    // Open synchronously within the click event, before any asynchronous logging.
    open(url);
    try { Promise.resolve(log(job, attribution, method)).catch(() => {}); } catch { /* Navigation has already happened. */ }
    return url;
  }
  async function logClick(job, attribution, method) {
    const config = window.FJ_CONFIG;
    if (!config) return;
    const identity = [job.job_title, job.company, job.apply_url].join('|');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const job_key = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    await fetch(config.url + (job.source === 'jobg8' ? '/functions/v1/partner-click' : '/rest/v1/rpc/log_partner_click'), {
      method: 'POST', credentials: 'omit', keepalive: true,
      headers: { apikey: config.key, Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_partner: job.source, p_source: attribution.source, p_method: method,
        p_campaign: attribution.campaign, p_job_key: job_key, p_country_hint: /^[a-z]{2}$/i.test(job.country || '') ? job.country.toLowerCase() : null }),
    });
  }

  // Tab-session attribution only. Never retain a query string, fragment, raw
  // referrer URL, email, resume text or search text in funnel storage.
  const roleIds=new Set(["data-analyst", "business-analyst", "business-intelligence-developer", "power-bi-developer", "tableau-developer", "sql-developer", "data-engineer", "data-scientist", "machine-learning-engineer", "software-engineer", "full-stack-developer", "devops-engineer", "cloud-engineer", "qa-engineer", "cybersecurity-analyst", "servicenow-developer", "salesforce-developer", "anaplan-model-builder", "product-manager", "project-manager", "registered-nurse", "accountant", "marketing-manager", "human-resources-manager", "sales-representative", "customer-service-representative", "licensed-practical-nurse", "certified-nursing-assistant", "medical-assistant", "pharmacy-technician", "physical-therapist", "respiratory-therapist", "home-health-aide", "cdl-truck-driver", "delivery-driver", "warehouse-associate", "forklift-operator", "dispatcher", "logistics-coordinator"]), locations=new Set(["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new-hampshire", "new-jersey", "new-mexico", "new-york", "north-carolina", "north-dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode-island", "south-carolina", "south-dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west-virginia", "wisconsin", "wyoming", "district-of-columbia", "raleigh-nc", "chicago-il", "new-york-ny", "austin-tx", "seattle-wa", "san-francisco-ca", "dallas-tx", "houston-tx", "charlotte-nc", "atlanta-ga", "boston-ma", "washington-dc", "jersey-city-nj", "newark-nj", "arlington-va", "los-angeles-ca", "san-jose-ca", "denver-co", "phoenix-az"]);
  const publicPages=new Set(['/', '/index.html','/find-jobs.html','/resume-search.html','/resume-builder.html','/application-tracker.html','/about.html','/contact.html','/privacy.html','/terms.html','/results.html','/login.html','/employer-login.html']);
  function safePath(value) {
    let path;try{path=new URL(String(value||'/'),'https://fortunejobsai.com').pathname;}catch{return '/other';}
    if(path==='/index.html')return '/';if(publicPages.has(path))return path;
    if(!/^\/(jobs|salaries|h1b)\/(?:[a-z-]+\/)*$/.test(path))return '/other';
    const [section,first,second,third,...rest]=path.split('/').filter(Boolean);
    if(rest.length)return '/other';if(!first)return path;
    if(section==='jobs' && ['tech','healthcare','transport'].includes(first) && !second)return path;
    if(section==='jobs' && ['remote','entry-level'].includes(first))return (!second || roleIds.has(second) && (!third || first==='entry-level' && locations.has(third)))?path:'/other';
    return roleIds.has(first) && (!second || locations.has(second)) && !third?path:'/other';
  }
  const refDomains=['google.com','google.co.uk','bing.com','duckduckgo.com','yahoo.com','linkedin.com','instagram.com','facebook.com','reddit.com','t.co','threads.net','youtube.com','fortunejobsai.com'];
  function referrerBucket(value){try{const host=new URL(value).hostname.toLowerCase();return refDomains.find(d=>host===d||host.endsWith('.'+d))||'other';}catch{return 'direct';}}
  const allowed=env=>!(env?.navigator?.globalPrivacyControl || ['1','yes'].includes(env?.navigator?.doNotTrack));
  function captureLanding(store=storage(), env=typeof window==='object'?window:null){
    if(!env || !allowed(env))return null;
    try{const old=JSON.parse(store?.getItem('fj_first_landing')||'null');if(old && /^[a-f0-9-]{36}$/.test(old.id) && old.path===safePath(old.path) && Date.now()-old.started<7*86400000)return old;}catch{}
    if(!env.crypto?.randomUUID)return null;
    const item={id:env.crypto.randomUUID(),path:safePath(env.location?.pathname),referrer:referrerBucket(env.document?.referrer),started:Date.now(),...capture(env.location?.search||'',store)};
    try{store?.setItem('fj_first_landing',JSON.stringify(item));}catch{return null;}return item;
  }
  function signupContext(){const item=captureLanding();return item?{id:item.id,path:item.path,referrer:item.referrer,source:item.source,medium:item.medium,campaign:item.campaign}:null;}
  async function logFunnel(kind,eventId=null){
    try{const context=signupContext(),config=window.FJ_CONFIG;if(!context || !config || !['landing','search'].includes(kind))return;
      await fetch(config.url+'/rest/v1/rpc/seo_log_funnel',{method:'POST',credentials:'omit',keepalive:true,headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':'application/json'},body:JSON.stringify({p_context:context,p_event:kind,p_event_id:eventId})});
    }catch{/* Analytics never blocks a search or signup. */}
  }
  async function recordSearch(){
    try{if(!signupContext())return;const params=new URLSearchParams(window.location.search);if(!(params.get('q')||'').trim())return;
      const pairs=[...params].filter(([k])=>['q','mode','location','country','category','date','work_mode','experience','job_type','salary_min','industry','company','sponsorship','posted'].includes(k)).sort(([a],[b])=>a.localeCompare(b));
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(pairs)));
      const key='fj_search_'+Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');const store=storage();if(!store)return;
      const id=store.getItem(key)||crypto.randomUUID();store.setItem(key,id);await logFunnel('search',id);
    }catch{}
  }

  return { capture, clean, appendJobg8, methodFor, navigate, safePath, referrerBucket, captureLanding, signupContext, logFunnel, recordSearch };
});
