// Identity lives in Supabase Auth, not in the Flask backend — the backend only
// verifies the JWT's signature against the project's JWKS. So signing in means
// talking to Supabase's REST API directly and keeping the access token, which
// api.js then sends as a bearer.

import { getConfig, getSession, setSession, pushLog } from './store.js';

function base() {
  const { supabaseUrl } = getConfig();
  if (!supabaseUrl) throw new Error('Supabase URL is not set — fill it in on the Setup tab.');
  return supabaseUrl + '/auth/v1';
}

function keyOrThrow() {
  const { anonKey } = getConfig();
  if (!anonKey) {
    throw new Error(
      'Supabase anon (publishable) key is not set. Add it on the Setup tab — ' +
      'Supabase rejects auth calls without an apikey header.',
    );
  }
  return anonKey;
}

/** Pull the readable half of a JWT apart, for the token inspector. */
export function decodeJwt(token) {
  try {
    const [rawHeader, rawPayload] = token.split('.');
    const decode = (part) => {
      const padded = part.replace(/-/g, '+').replace(/_/g, '/');
      const json = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
      return JSON.parse(decodeURIComponent(escape(json)));
    };
    return { header: decode(rawHeader), payload: decode(rawPayload) };
  } catch {
    return null;
  }
}

function readableError(status, data) {
  if (!data) return `HTTP ${status}`;
  return (
    data.error_description || data.msg || data.message || data.error_code ||
    (typeof data.error === 'string' ? data.error : null) || `HTTP ${status}`
  );
}

/**
 * @param {string} path      e.g. '/token?grant_type=password'
 * @param {object} [opts]    {method, body, token}
 */
async function call(path, opts = {}) {
  const { method = 'POST', body, token } = opts;
  const url = base() + path;
  const apikey = keyOrThrow();
  const started = performance.now();

  const headers = { apikey, 'Content-Type': 'application/json' };
  // Unauthenticated calls still want a bearer; Supabase accepts the anon key.
  headers.Authorization = 'Bearer ' + (token || apikey);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      mode: 'cors',
    });
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    const error = `Could not reach Supabase at ${url} — ${err.message}. Check the Supabase URL.`;
    pushLog({ method, path: '[supabase] ' + path, status: 0, ms, ok: false, request: redact(body), response: error });
    return { ok: false, status: 0, data: null, ms, error };
  }

  const ms = Math.round(performance.now() - started);
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }

  pushLog({
    method,
    path: '[supabase] ' + path,
    status: response.status,
    ms,
    ok: response.ok,
    request: redact(body),
    response: redact(data),
  });

  return {
    ok: response.ok,
    status: response.status,
    data,
    ms,
    error: response.ok ? undefined : readableError(response.status, data),
  };
}

/** Keep passwords and full tokens out of the on-screen log. */
function redact(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = Array.isArray(value) ? [...value] : { ...value };
  for (const key of ['password', 'access_token', 'refresh_token']) {
    if (typeof copy[key] === 'string') {
      copy[key] = key === 'password' ? '••••••••' : copy[key].slice(0, 12) + '…[redacted]';
    }
  }
  return copy;
}

/* ---------------- flows ---------------- */

export async function signUp(email, password) {
  const res = await call('/signup', { body: { email, password } });
  // When email confirmation is on, Supabase returns the user with no session.
  if (res.ok && res.data?.access_token) setSession(res.data);
  return res;
}

export async function signIn(email, password) {
  const res = await call('/token?grant_type=password', { body: { email, password } });
  if (res.ok && res.data?.access_token) setSession(res.data);
  return res;
}

export async function refreshSession() {
  const session = getSession();
  if (!session?.refresh_token) {
    return { ok: false, status: 0, data: null, error: 'No refresh token stored — sign in again.' };
  }
  const res = await call('/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } });
  if (res.ok && res.data?.access_token) setSession(res.data);
  return res;
}

export async function signOut() {
  const session = getSession();
  let res = { ok: true, status: 200, data: { local_only: true } };
  if (session?.access_token) {
    res = await call('/logout', { token: session.access_token });
  }
  setSession(null);
  return res;
}

/** Email a password-reset link. */
export async function recover(email) {
  return call('/recover', { body: { email } });
}

/** Re-send the signup confirmation email. */
export async function resendConfirmation(email) {
  return call('/resend', { body: { type: 'signup', email } });
}

/** Supabase's own view of the current user — proves the token is live. */
export async function fetchSupabaseUser() {
  const session = getSession();
  if (!session?.access_token) {
    return { ok: false, status: 0, data: null, error: 'Not signed in.' };
  }
  const res = await call('/user', { method: 'GET', token: session.access_token });
  if (res.ok && res.data?.id) {
    setSession({ ...session, user: res.data });
  }
  return res;
}

/** Sign in with a token pasted from somewhere else. */
export function adoptToken(accessToken, refreshToken) {
  const decoded = decodeJwt(accessToken);
  if (!decoded) throw new Error('That does not parse as a JWT.');
  setSession({
    access_token: accessToken.trim(),
    refresh_token: (refreshToken || '').trim() || undefined,
    token_type: 'bearer',
    expires_at: decoded.payload.exp,
    user: { id: decoded.payload.sub, email: decoded.payload.email, role: decoded.payload.role },
  });
  return decoded;
}
