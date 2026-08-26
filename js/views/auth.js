import { h, viewHead, sectionLabel, note, card, toast, jsonBlock, clear, fmtDuration } from '../dom.js';
import { getSession, getConfig, secondsLeft, isExpired, on } from '../store.js';
import * as auth from '../auth.js';
import * as api from '../api.js';

export function render(root) {
  root.append(viewHead(
    'Authentication',
    'Supabase Auth issues the token; the Flask backend only verifies it. Sign in here, then every other tab ' +
    'sends the access token as a bearer.',
  ));

  if (!getConfig().anonKey) {
    root.append(note(
      'No Supabase anon key saved yet, so sign-in will fail. Add it on the <b>Setup</b> tab. ' +
      'If you already have a token from elsewhere, use <b>Use an existing token</b> below instead.',
    ));
  }

  /* ---------------- current session ---------------- */

  root.append(sectionLabel('Current session'));

  const sessionBox = h('div', { class: 'card open' });
  root.append(sessionBox);

  function paintSession() {
    clear(sessionBox);
    const s = getSession();
    const body = h('div', { class: 'card-body' });

    if (!s) {
      body.append(h('div', { class: 'empty', text: 'Signed out. No bearer token is being sent.' }));
      sessionBox.append(body);
      return;
    }

    const decoded = auth.decodeJwt(s.access_token);
    const left = secondsLeft();
    const claims = decoded?.payload || {};

    body.append(h('dl', { class: 'claims' },
      h('dt', { text: 'user id (sub)' }), h('dd', { text: claims.sub || s.user?.id || '—' }),
      h('dt', { text: 'email' }), h('dd', { text: claims.email || s.user?.email || '—' }),
      h('dt', { text: 'role' }), h('dd', { text: claims.role || '—' }),
      h('dt', { text: 'audience' }), h('dd', { text: claims.aud || '—' }),
      h('dt', { text: 'algorithm' }), h('dd', { text: decoded?.header?.alg || '—' }),
      h('dt', { text: 'expires' }), h('dd', {
        text: left === null ? '—' : left > 0 ? 'in ' + fmtDuration(left) : fmtDuration(left) + ' ago',
      }),
      h('dt', { text: 'refresh token' }), h('dd', { text: s.refresh_token ? 'stored' : 'none' }),
    ));

    if (isExpired()) {
      body.append(h('div', { class: 'note', style: 'margin-top:11px', html:
        'This access token has expired. The backend will answer <code>401 token expired</code>. ' +
        'Hit <b>Refresh</b> in the top bar — requests also retry once automatically after refreshing.' }));
    }

    body.append(h('div', { class: 'section-label', text: 'Full claims' }));
    body.append(jsonBlock(decoded || { error: 'Token did not parse as a JWT.' }));
    sessionBox.append(body);
  }

  paintSession();
  const stop = on('session', paintSession);
  root.addEventListener('view:teardown', stop);

  /* ---------------- sign in ---------------- */

  root.append(sectionLabel('Sign in'));

  root.append(card({
    method: 'POST',
    path: '/auth/v1/token?grant_type=password',
    title: 'email + password',
    desc: 'Exchanges credentials for an access token and a refresh token. Both are kept in localStorage.',
    open: true,
    action: 'Sign in',
    fields: [
      { name: 'email', label: 'email', type: 'email', required: true, placeholder: 'you@example.com' },
      { name: 'password', label: 'password', type: 'password', required: true },
    ],
    run: async (v, result) => {
      if (!v.email || !v.password) { result.message('Email and password are both required.', true); return; }
      const res = await auth.signIn(v.email.trim(), v.password);
      if (res.ok) {
        toast('Signed in as ' + (res.data?.user?.email || v.email));
        // Prove the token works against the backend, which is the actual point.
        const me = await api.get('/api/me');
        result.custom(
          h('div', { class: 'result-head' },
            h('span', { class: 'status ok', text: res.status }),
            h('span', { class: 'result-meta', text: 'signed in' })),
          jsonBlock({
            signed_in_as: res.data?.user?.email,
            user_id: res.data?.user?.id,
            expires_in_seconds: res.data?.expires_in,
            backend_check: { path: 'GET /api/me', status: me.status, ok: me.ok, body: me.data ?? me.error },
          }),
        );
      } else {
        result.render({ ...res, method: 'POST', path: '/auth/v1/token' });
      }
    },
  }));

  root.append(card({
    method: 'POST',
    path: '/auth/v1/signup',
    title: 'create an account',
    desc: 'If the project requires email confirmation you get a user but no session, and you must confirm before signing in.',
    action: 'Sign up',
    fields: [
      { name: 'email', label: 'email', type: 'email', required: true },
      { name: 'password', label: 'password', type: 'password', required: true, hint: 'Six characters minimum by default.' },
    ],
    run: async (v, result) => {
      if (!v.email || !v.password) { result.message('Email and password are both required.', true); return; }
      const res = await auth.signUp(v.email.trim(), v.password);
      result.render({ ...res, method: 'POST', path: '/auth/v1/signup' });
      if (res.ok) {
        toast(res.data?.access_token ? 'Account created and signed in' : 'Account created — confirm your email');
      }
    },
  }));

  root.append(card({
    method: 'POST',
    path: '/auth/v1/token?grant_type=refresh_token',
    title: 'refresh the access token',
    desc: 'Access tokens are short-lived. This trades the refresh token for a new pair.',
    action: 'Refresh',
    run: async (_v, result) => {
      const res = await auth.refreshSession();
      result.render({ ...res, method: 'POST', path: '/auth/v1/token' });
      if (res.ok) toast('Token refreshed');
    },
  }));

  root.append(card({
    method: 'GET',
    path: '/auth/v1/user',
    title: 'who Supabase thinks you are',
    desc: 'Asks Supabase to validate the token itself. Useful for telling a bad token apart from a backend problem.',
    action: 'Fetch user',
    run: async (_v, result) => {
      const res = await auth.fetchSupabaseUser();
      result.render({ ...res, method: 'GET', path: '/auth/v1/user' });
    },
  }));

  root.append(card({
    method: 'POST',
    path: '/auth/v1/logout',
    title: 'sign out',
    desc: 'Revokes the session at Supabase and clears it here. The local token is dropped either way.',
    action: 'Sign out',
    run: async (_v, result) => {
      const res = await auth.signOut();
      result.render({ ...res, method: 'POST', path: '/auth/v1/logout' });
      toast('Signed out');
    },
  }));

  /* ---------------- recovery ---------------- */

  root.append(sectionLabel('Recovery'));

  root.append(card({
    method: 'POST',
    path: '/auth/v1/recover',
    title: 'send a password reset email',
    fields: [{ name: 'email', label: 'email', type: 'email', required: true }],
    action: 'Send reset email',
    run: async (v, result) => {
      if (!v.email) { result.message('Email is required.', true); return; }
      const res = await auth.recover(v.email.trim());
      result.render({ ...res, method: 'POST', path: '/auth/v1/recover' });
    },
  }));

  root.append(card({
    method: 'POST',
    path: '/auth/v1/resend',
    title: 'resend the confirmation email',
    fields: [{ name: 'email', label: 'email', type: 'email', required: true }],
    action: 'Resend',
    run: async (v, result) => {
      if (!v.email) { result.message('Email is required.', true); return; }
      const res = await auth.resendConfirmation(v.email.trim());
      result.render({ ...res, method: 'POST', path: '/auth/v1/resend' });
    },
  }));

  /* ---------------- manual token ---------------- */

  root.append(sectionLabel('Escape hatch'));

  root.append(card({
    method: 'PUT',
    path: '(local) bearer token',
    title: 'use an existing token',
    desc: 'Paste an access token captured from another client. Nothing is sent anywhere; it is just stored and used as the bearer.',
    fields: [
      { name: 'access_token', label: 'access_token', type: 'textarea', wide: true, required: true, rows: 3 },
      { name: 'refresh_token', label: 'refresh_token', type: 'text', wide: true, hint: 'Optional. Without it, no automatic refresh.' },
    ],
    action: 'Use this token',
    run: async (v, result) => {
      if (!v.access_token.trim()) { result.message('Paste a token first.', true); return; }
      const decoded = auth.adoptToken(v.access_token, v.refresh_token);
      const me = await api.get('/api/me');
      result.custom(jsonBlock({
        adopted: { sub: decoded.payload.sub, email: decoded.payload.email, exp: decoded.payload.exp },
        backend_check: { path: 'GET /api/me', status: me.status, ok: me.ok, body: me.data ?? me.error },
      }));
      toast('Token adopted');
    },
  }));

  root.append(card({
    method: 'GET',
    path: '/api/me',
    title: 'does the backend accept this token',
    desc: 'The end-to-end check: a Supabase-signed token verified by the Flask app against the project JWKS.',
    action: 'Verify against backend',
    run: async (_v, result) => {
      const res = await api.get('/api/me');
      result.render(res);
      if (res.ok) toast('Backend accepted the token');
    },
  }));
}
