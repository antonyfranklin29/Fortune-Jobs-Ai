// In-memory stand-in for the parts of supabase-js the account pages use.
// Records every call so tests can assert exactly what is sent.
export function fakeSupabase({ user = null, tables = {}, rpc = {}, auth = {} } = {}) {
  const calls = [];
  let currentUser = user;
  const listeners = new Set();
  const query = (table) => {
    const q = { table, ops: [] };
    const result = () => {
      const handler = tables[table];
      const out = typeof handler === 'function' ? handler(q) : handler;
      return Promise.resolve(out || { data: [], error: null });
    };
    const chain = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => result().then(res, rej);
        return (...args) => { q.ops.push([prop, ...args]); if (prop === 'single' || prop === 'maybeSingle') calls.push(['from', table, q.ops]); return chain; };
      },
    });
    return chain;
  };
  const sb = {
    calls,
    from(table) { const c = query(table); return c; },
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      const h = rpc[name];
      if (typeof h === 'function') return h(args);
      if (h) return h;
      return { data: null, error: { message: 'missing fake ' + name } };
    },
    storage: { from: (bucket) => ({
      upload: async (path) => { calls.push(['upload', bucket, path]); return { error: null }; },
      remove: async (paths) => { calls.push(['remove', bucket, paths]); return { error: null }; },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
      createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/file' }, error: null }),
    }) },
    auth: {
      getSession: async () => ({ data: { session: currentUser ? { user: currentUser, access_token: 'token-fixture' } : null }, error: null }),
      onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
      signInWithPassword: async (a) => { calls.push(['signInWithPassword', a]); return auth.signInWithPassword ? auth.signInWithPassword(a) : { error: null }; },
      signUp: async (a) => { calls.push(['signUp', a]); return auth.signUp ? auth.signUp(a) : { data: { user: { identities: [{}] }, session: null }, error: null }; },
      resetPasswordForEmail: async (e, o) => { calls.push(['resetPasswordForEmail', e, o]); return { error: null }; },
      updateUser: async (a) => { calls.push(['updateUser', a]); return { error: null }; },
      signInWithOAuth: async (a) => { calls.push(['signInWithOAuth', a]); return { error: null }; },
      signOut: async (a) => { calls.push(['signOut', a]); return { error: null }; },
    },
    setUser(u) { currentUser = u; },
    emit(event) { for (const fn of [...listeners]) fn(event); },
  };
  return sb;
}

export const CONFIG = { url: 'https://project.supabase.co', key: 'public-anon-fixture' };

export function fakeLocation(href = 'https://fortunejobsai.com/login.html') {
  const u = new URL(href);
  return { href: u.href, search: u.search, hash: u.hash, replaced: [], assigned: [], replace(url) { this.replaced.push(url); } };
}
