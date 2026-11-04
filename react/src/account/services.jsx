// Account services shared by the account and employer pages.
//
// The pages never create their own Supabase client. The app shell passes one in
// (the same persisted session used everywhere: persistSession, autoRefreshToken,
// detectSessionInUrl), so auth state and storage keys match the legacy pages.
import { createContext, useContext } from 'react';
import { avatarPath } from './lib/dataSafety.js';

const AccountServicesContext = createContext(null);

/**
 * @param {object} opts
 * @param {object} opts.sb       supabase-js v2 client (pinned to 2.117.3 on the legacy pages)
 * @param {{url:string,key:string}} opts.config  public project URL and anon key (config.js)
 * @param {Location} [opts.location]   defaults to window.location
 * @param {(url:string)=>void} [opts.navigate]  full-page navigation; defaults to location.href = url
 * @param {(url:string)=>void} [opts.replace]   defaults to location.replace(url)
 * @param {typeof fetch} [opts.fetch]
 * @param {object} [opts.resumeTools]  { suggest(text,catalog), pdfToText(file), docxToText(file), catalog() }
 */
export function createAccountServices({ sb, config, location, navigate, replace, fetch: fetchFn, resumeTools } = {}) {
  const loc = location || (typeof window === 'object' ? window.location : null);
  const doFetch = fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const services = {
    sb,
    config,
    resumeTools: resumeTools || null,
    fetch: doFetch,
    search: () => (loc ? loc.search : ''),
    hash: () => (loc ? loc.hash : ''),
    navigate: navigate || ((url) => { loc.href = url; }),
    replace: replace || ((url) => { loc.replace(url); }),

    // Base folder of the site, e.g. https://fortunejobsai.com/
    baseUrl() { return loc.href.split(/[?#]/)[0].replace(/[^/]*$/, ''); },

    async user() {
      const { data } = await sb.auth.getSession();
      return data && data.session ? data.session.user : null;
    },

    async profile(userId) {
      const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (error) { console.error('profile load failed', error); return null; }
      return data;
    },

    loginUrl(nextPage) {
      const employer = typeof nextPage === 'string' && nextPage.split(/[?#]/)[0] === 'employers.html';
      return (employer ? 'employer-login.html' : 'login.html') + (nextPage ? '?next=' + encodeURIComponent(nextPage) : '');
    },

    async signOut() {
      await sb.auth.signOut();
      services.navigate('index.html');
    },

    initials(name, email) {
      const src = (name || '').trim() || (email || '').split('@')[0] || '?';
      const parts = src.split(/[\s._-]+/).filter(Boolean);
      return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    },

    // Only a photo stored in this project's own avatars bucket, under this user's folder, is shown.
    safeAvatarUrl(profile, user) {
      const candidate = (profile && profile.avatar_url) || '';
      return candidate && avatarPath(candidate, config.url, user && user.id) ? candidate : '';
    },
  };
  return services;
}

export function AccountServicesProvider({ services, children }) {
  return <AccountServicesContext.Provider value={services}>{children}</AccountServicesContext.Provider>;
}

export function useAccountServices() {
  const value = useContext(AccountServicesContext);
  if (!value) throw new Error('Wrap account and employer pages in <AccountServicesProvider>.');
  return value;
}
