// Shared account helpers for every Fortune Jobs AI page.
// Needs: supabase-js (CDN) + config.js loaded first.
(function () {
  if (!window.supabase || !window.FJ_CONFIG) { console.warn('Accounts unavailable: supabase-js or config.js missing'); return; }

  const sb = window.supabase.createClient(window.FJ_CONFIG.url, window.FJ_CONFIG.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const FJ = {
    sb,
    esc,

    // Base folder of the site, e.g. https://user.github.io/Fortune-Jobs-Ai/
    baseUrl() { return location.href.split(/[?#]/)[0].replace(/[^/]*$/, ''); },

    async user() {
      const { data } = await sb.auth.getSession();
      return data && data.session ? data.session.user : null;
    },

    async profile(userId) {
      const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (error) { console.error('profile load failed', error); return null; }
      return data;
    },

    // Stable id for a job so the same listing is only saved once per person
    jobKey(j) {
      return [j.job_title, j.company, j.apply_url].map(s => String(s || '').trim().toLowerCase()).join('|').slice(0, 600);
    },

    loginUrl(next) { return 'login.html' + (next ? '?next=' + encodeURIComponent(next) : ''); },

    async signOut() {
      await sb.auth.signOut();
      location.href = 'index.html';
    },

    initials(name, email) {
      const src = (name || '').trim() || (email || '').split('@')[0] || '?';
      const parts = src.split(/[\s._-]+/).filter(Boolean);
      return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    },

    avatarHtml(profile, user, cls) {
      const name = (profile && profile.full_name) || '';
      const url = (profile && profile.avatar_url) || '';
      return url
        ? `<img class="${cls}" src="${esc(url)}" alt="" referrerpolicy="no-referrer">`
        : `<span class="${cls}" aria-hidden="true">${esc(FJ.initials(name, user && user.email))}</span>`;
    }
  };

  window.FJ = FJ;
})();
