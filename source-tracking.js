(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.FJSourceTracking = api; api.capture(root.location.search); }
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
    await fetch(config.url + '/rest/v1/rpc/log_partner_click', {
      method: 'POST', credentials: 'omit', keepalive: true,
      headers: { apikey: config.key, Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_partner: job.source, p_source: attribution.source, p_method: method,
        p_campaign: attribution.campaign, p_job_key: job_key, p_country_hint: /^[a-z]{2}$/i.test(job.country || '') ? job.country.toLowerCase() : null }),
    });
  }
  return { capture, clean, appendJobg8, methodFor, navigate };
});
