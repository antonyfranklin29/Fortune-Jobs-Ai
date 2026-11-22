export const isObviousBot = value => /headless|curl\b|python-requests|wget\b|spider|crawler|\bbot\b|googlebot|bingbot|httpclient|playwright|puppeteer|node-fetch/i.test(value || '');

export function createPartnerAdmission({ getEnv, fetchImpl = fetch }) {
  return async ip => {
    const url = getEnv('SUPABASE_URL'), service = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const salt = getEnv('CLIENT_HASH_SALT') || service;
    if (!url || !service || !salt) return false;
    try {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('partner-search-v1:' + ip)));
      const hash = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
      const response = await fetchImpl(url + '/rest/v1/rpc/partner_search_admit', {
        method: 'POST', signal: AbortSignal.timeout(3000),
        headers: { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_hash: hash }),
      });
      return response.ok && (await response.json()) === true;
    } catch { return false; }
  };
}
