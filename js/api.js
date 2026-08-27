// The client for the Flask backend. Every call returns the same envelope so a
// view never has to think about transport, and every call lands in the request
// log so you can see exactly what went over the wire.

import { getConfig, getToken, pushLog, getSession } from './store.js';
import { refreshSession } from './auth.js';

/**
 * @typedef {object} ApiResult
 * @property {boolean} ok
 * @property {number} status   0 when the request never reached the server.
 * @property {*} data          Parsed JSON, or raw text under `.raw`.
 * @property {string} [error]  Human-readable failure.
 * @property {number} ms
 */

function buildUrl(path, query) {
  const { apiBase } = getConfig();
  const url = new URL(apiBase + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, v);
  }
  return url.toString();
}

function authHeaders(needsAuth) {
  const headers = {};
  if (needsAuth) {
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
  }
  return headers;
}

/**
 * @param {string} method
 * @param {string} path    Path only, e.g. '/api/teams'.
 * @param {object} [opts]  {query, body, auth=true, _retried}
 * @returns {Promise<ApiResult>}
 */
export async function request(method, path, opts = {}) {
  const { query, body, auth = true } = opts;
  const url = buildUrl(path, query);
  const started = performance.now();

  const headers = authHeaders(auth);
  let payload;
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  if (auth && !getToken()) {
    const res = {
      ok: false, status: 0, data: null, ms: 0, method, path,
      error: 'Not signed in. This endpoint requires a bearer token — sign in on the Authentication tab first.',
    };
    pushLog({ method, path, status: 0, ms: 0, ok: false, request: body, response: res.error });
    return res;
  }

  let response;
  try {
    response = await fetch(url, { method, headers, body: payload, mode: 'cors' });
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    const error =
      `Could not reach ${url} — ${err.message}. ` +
      'Check that the Flask app is running, that the API base URL is right, and that this ' +
      "page's origin is listed in the backend's CORS_ORIGINS.";
    pushLog({ method, path, status: 0, ms, ok: false, request: body, response: error });
    return { ok: false, status: 0, data: null, ms, method, path, error };
  }

  const ms = Math.round(performance.now() - started);
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }

  // A stale access token is the single most common failure here. Trade the
  // refresh token in and replay the request once, quietly.
  if (response.status === 401 && auth && !opts._retried && getSession()?.refresh_token) {
    const refreshed = await refreshSession();
    if (refreshed.ok) {
      return request(method, path, { ...opts, _retried: true });
    }
  }

  const result = {
    ok: response.ok,
    status: response.status,
    data,
    ms,
    method,
    path,
    error: response.ok ? undefined : (data?.error || `HTTP ${response.status}`),
  };

  pushLog({
    method, path, status: response.status, ms, ok: response.ok,
    request: body, response: data ?? text,
  });

  return result;
}

export const get = (path, query) => request('GET', path, { query });
export const post = (path, body, query) => request('POST', path, { body, query });
export const patch = (path, body) => request('PATCH', path, { body });
export const put = (path, body) => request('PUT', path, { body });
export const del = (path, body) => request('DELETE', path, { body });

/** GET /health — the one route that needs no token. */
export const health = () => request('GET', '/health', { auth: false });

/**
 * POST /api/goals streams server-sent events, because matching takes a few
 * seconds and the backend reports each stage as it finishes. EventSource can
 * only issue GETs and cannot set an Authorization header, so this reads the
 * fetch body by hand.
 *
 * @param {object} body            {title, description, team_id?, department?}
 * @param {(event: object) => void} onEvent  Called per `data:` frame.
 * @returns {Promise<ApiResult>}   `data.events` holds everything received.
 */
export async function streamGoal(body, onEvent) {
  const url = buildUrl('/api/goals');
  const started = performance.now();
  const events = [];

  if (!getToken()) {
    const error = 'Not signed in. Sign in on the Authentication tab first.';
    pushLog({ method: 'POST', path: '/api/goals', status: 0, ms: 0, ok: false, request: body, response: error });
    return { ok: false, status: 0, data: null, ms: 0, method: 'POST', path: '/api/goals', error };
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { ...authHeaders(true), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      mode: 'cors',
    });
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    const error = `Could not reach ${url} — ${err.message}.`;
    pushLog({ method: 'POST', path: '/api/goals', status: 0, ms, ok: false, request: body, response: error });
    return { ok: false, status: 0, data: null, ms, method: 'POST', path: '/api/goals', error };
  }

  const type = response.headers.get('content-type') || '';

  // Validation failures and the membership check come back as ordinary JSON.
  if (!response.ok || !type.includes('text/event-stream')) {
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    const ms = Math.round(performance.now() - started);
    pushLog({ method: 'POST', path: '/api/goals', status: response.status, ms, ok: response.ok, request: body, response: data });
    return {
      ok: response.ok, status: response.status, data, ms,
      method: 'POST', path: '/api/goals',
      error: response.ok ? undefined : (data?.error || `HTTP ${response.status}`),
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const drain = (chunk) => {
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      let event;
      try { event = JSON.parse(raw); } catch { event = { stage: 'raw', message: raw }; }
      events.push(event);
      try { onEvent?.(event); } catch (e) { console.error(e); }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        drain(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
      }
    }
    if (buffer.trim()) drain(buffer);
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    const error = `Stream broke after ${events.length} event(s) — ${err.message}`;
    pushLog({ method: 'POST', path: '/api/goals', status: response.status, ms, ok: false, request: body, response: { error, events } });
    return { ok: false, status: response.status, data: { events }, ms, method: 'POST', path: '/api/goals', error };
  }

  const ms = Math.round(performance.now() - started);
  const failed = events.find((e) => e.stage === 'error');

  pushLog({
    method: 'POST', path: '/api/goals', status: response.status, ms,
    ok: !failed, request: body, response: { events },
  });

  return {
    ok: !failed,
    status: response.status,
    data: { events },
    ms,
    method: 'POST',
    path: '/api/goals',
    error: failed ? failed.message : undefined,
  };
}

/**
 * POST /api/jobs/nightly streams server-sent events as each pipeline step runs.
 * The full nightly can take several minutes — individual steps are safer on
 * a short server timeout.
 *
 * @param {object} body            {steps?: string[]}
 * @param {(event: object) => void} onEvent
 * @returns {Promise<ApiResult>}
 */
export async function streamNightly(body, onEvent) {
  const url = buildUrl('/api/jobs/nightly');
  const started = performance.now();
  const events = [];

  if (!getToken()) {
    const error = 'Not signed in. Sign in on the Authentication tab first.';
    pushLog({ method: 'POST', path: '/api/jobs/nightly', status: 0, ms: 0, ok: false, request: body, response: error });
    return { ok: false, status: 0, data: null, ms: 0, method: 'POST', path: '/api/jobs/nightly', error };
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { ...authHeaders(true), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      mode: 'cors',
    });
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    const error = `Could not reach ${url} — ${err.message}.`;
    pushLog({ method: 'POST', path: '/api/jobs/nightly', status: 0, ms, ok: false, request: body, response: error });
    return { ok: false, status: 0, data: null, ms, method: 'POST', path: '/api/jobs/nightly', error };
  }

  const type = response.headers.get('content-type') || '';

  if (!response.ok || !type.includes('text/event-stream')) {
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    const ms = Math.round(performance.now() - started);
    pushLog({ method: 'POST', path: '/api/jobs/nightly', status: response.status, ms, ok: response.ok, request: body, response: data });
    return {
      ok: response.ok, status: response.status, data, ms,
      method: 'POST', path: '/api/jobs/nightly',
      error: response.ok ? undefined : (data?.error || `HTTP ${response.status}`),
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const drain = (chunk) => {
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      let event;
      try { event = JSON.parse(raw); } catch { event = { stage: 'raw', message: raw }; }
      events.push(event);
      try { onEvent?.(event); } catch (e) { console.error(e); }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        drain(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
      }
    }
    if (buffer.trim()) drain(buffer);
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    const error = `Stream broke after ${events.length} event(s) — ${err.message}`;
    pushLog({ method: 'POST', path: '/api/jobs/nightly', status: response.status, ms, ok: false, request: body, response: { error, events } });
    return { ok: false, status: response.status, data: { events }, ms, method: 'POST', path: '/api/jobs/nightly', error };
  }

  const ms = Math.round(performance.now() - started);
  const failed = events.find((e) => e.stage === 'error');

  pushLog({
    method: 'POST', path: '/api/jobs/nightly', status: response.status, ms,
    ok: !failed, request: body, response: { events },
  });

  return {
    ok: !failed,
    status: response.status,
    data: { events },
    ms,
    method: 'POST',
    path: '/api/jobs/nightly',
    error: failed ? failed.message : undefined,
  };
}
