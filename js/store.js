// Persisted state: where the backend is, who is signed in, and which ids the
// panels should default to. Everything lives in localStorage so a page reload
// does not cost you a login.

const PREFIX = 'nofo_test_ui.';

const DEFAULTS = {
  // The Flask app binds 127.0.0.1:5001, but the backend's CORS allowlist names
  // localhost, and the two are different origins to a browser. Use localhost.
  apiBase: 'http://localhost:5001',
  supabaseUrl: 'https://icofyotdpszvjmwsrxoe.supabase.co',
  anonKey: '',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* private browsing, quota -- non-fatal for a test tool */ }
}

const listeners = { config: [], session: [], ctx: [], log: [] };

function emit(channel) {
  for (const fn of listeners[channel]) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

export function on(channel, fn) {
  listeners[channel].push(fn);
  return () => {
    const i = listeners[channel].indexOf(fn);
    if (i >= 0) listeners[channel].splice(i, 1);
  };
}

/* ---------------- config ---------------- */

let config = { ...DEFAULTS, ...read('config', {}) };

export function getConfig() {
  return { ...config };
}

export function setConfig(patch) {
  config = { ...config, ...patch };
  // trailing slashes would double up when concatenated with a path
  config.apiBase = String(config.apiBase || '').replace(/\/+$/, '');
  config.supabaseUrl = String(config.supabaseUrl || '').replace(/\/+$/, '');
  write('config', config);
  emit('config');
}

export function resetConfig() {
  config = { ...DEFAULTS };
  write('config', config);
  emit('config');
}

/* ---------------- session ---------------- */

let session = read('session', null);

export function getSession() {
  return session ? { ...session } : null;
}

export function getToken() {
  return session?.access_token || null;
}

/**
 * @param {object|null} s Supabase token response, or null to clear.
 */
export function setSession(s) {
  if (!s) {
    session = null;
  } else {
    session = {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      token_type: s.token_type,
      // Supabase sends expires_at as unix seconds; fall back to expires_in.
      expires_at: s.expires_at || (s.expires_in ? Math.floor(Date.now() / 1000) + s.expires_in : null),
      user: s.user ? { id: s.user.id, email: s.user.email, role: s.user.role } : session?.user || null,
    };
  }
  write('session', session);
  emit('session');
}

export function isExpired() {
  if (!session?.expires_at) return false;
  return session.expires_at * 1000 <= Date.now();
}

export function secondsLeft() {
  if (!session?.expires_at) return null;
  return Math.round(session.expires_at - Date.now() / 1000);
}

/* ---------------- shared ids ---------------- */

const CTX_KEYS = ['teamId', 'goalId', 'savedId', 'opportunityId', 'userId', 'matchId', 'deliveryId', 'inviteId'];

let ctx = { ...read('ctx', {}) };

export function getCtx(key) {
  return key ? (ctx[key] ?? '') : { ...ctx };
}

export function setCtx(key, value) {
  const v = value === null || value === undefined ? '' : String(value);
  if (ctx[key] === v) return;
  ctx[key] = v;
  write('ctx', ctx);
  emit('ctx');
}

export function clearCtx() {
  ctx = {};
  write('ctx', ctx);
  emit('ctx');
}

export { CTX_KEYS };

/* ---------------- request log ---------------- */

const log = [];
const LOG_MAX = 120;

export function pushLog(entry) {
  log.unshift({ id: Date.now() + Math.random(), at: new Date(), ...entry });
  if (log.length > LOG_MAX) log.length = LOG_MAX;
  emit('log');
}

export function getLog() {
  return log;
}

export function clearLog() {
  log.length = 0;
  emit('log');
}
