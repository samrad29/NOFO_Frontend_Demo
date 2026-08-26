import { h, viewHead, sectionLabel, note, card, toast, jsonBlock } from '../dom.js';
import { getConfig, setConfig, resetConfig } from '../store.js';
import * as api from '../api.js';

export function render(root) {
  const cfg = getConfig();

  root.append(viewHead(
    'Setup',
    'Where this console points and how it authenticates. Saved in localStorage, so it survives a reload.',
  ));

  root.append(note(
    'The backend allows cross-origin requests only from the origins in its <code>CORS_ORIGINS</code> ' +
    'setting, which defaults to <code>http://localhost:3000</code>. Serve this page on port 3000 and open it ' +
    'as <code>http://localhost:3000</code> — not <code>127.0.0.1</code>, which the browser treats as a ' +
    'different origin.',
  ));

  /* ---------------- connection ---------------- */

  root.append(sectionLabel('Connection'));

  const apiBase = h('input', { type: 'text', value: cfg.apiBase, placeholder: 'http://localhost:5001' });
  const supabaseUrl = h('input', { type: 'text', value: cfg.supabaseUrl, placeholder: 'https://xxxx.supabase.co' });
  const anonKey = h('input', { type: 'password', value: cfg.anonKey, placeholder: 'eyJhbGciOi… or sb_publishable_…' });

  const showKey = h('input', { type: 'checkbox' });
  showKey.addEventListener('change', () => { anonKey.type = showKey.checked ? 'text' : 'password'; });

  const save = h('button', { class: 'btn', text: 'Save settings' });
  const status = h('span', { class: 'result-meta', style: 'font-family:var(--mono);font-size:11.5px' });

  save.addEventListener('click', () => {
    setConfig({ apiBase: apiBase.value.trim(), supabaseUrl: supabaseUrl.value.trim(), anonKey: anonKey.value.trim() });
    const saved = getConfig();
    apiBase.value = saved.apiBase;
    supabaseUrl.value = saved.supabaseUrl;
    status.textContent = 'Saved.';
    toast('Settings saved');
    setTimeout(() => { status.textContent = ''; }, 2500);
  });

  const reset = h('button', { class: 'btn btn-ghost', text: 'Restore defaults' });
  reset.addEventListener('click', () => {
    resetConfig();
    const d = getConfig();
    apiBase.value = d.apiBase;
    supabaseUrl.value = d.supabaseUrl;
    anonKey.value = d.anonKey;
    toast('Defaults restored');
  });

  root.append(h('div', { class: 'card open' },
    h('div', { class: 'card-body' },
      h('div', { class: 'fields' },
        h('div', { class: 'field' },
          h('label', { text: 'Backend base URL' }), apiBase,
          h('div', { class: 'hint', text: 'The Flask app. python app/main.py binds port 5001.' })),
        h('div', { class: 'field' },
          h('label', { text: 'Supabase project URL' }), supabaseUrl,
          h('div', { class: 'hint', text: 'Matches SUPABASE_URL in the backend .env. Sign-in goes here, not to Flask.' })),
        h('div', { class: 'field wide' },
          h('label', { text: 'Supabase anon / publishable key' }), anonKey,
          h('div', { class: 'hint' },
            'Supabase Dashboard → Project Settings → API Keys. This is the public client key, safe in a browser. ',
            'It is not in the backend .env because the backend never needs it — it only reads the public JWKS.'),
          h('div', { class: 'check' }, showKey, h('label', { text: 'show key' }))),
      ),
      h('div', { class: 'btn-row' }, save, reset, status),
    ),
  ));

  /* ---------------- reachability ---------------- */

  root.append(sectionLabel('Reachability'));

  root.append(card({
    method: 'GET',
    path: '/health',
    title: 'is the backend up',
    desc: 'The only route with no auth. If this fails the problem is the server, the URL, or CORS — not your login.',
    action: 'Check health',
    open: true,
    run: async (_v, result) => {
      const res = await api.health();
      result.render(res);
      if (res.ok) toast('Backend is up');
    },
  }));

  root.append(card({
    method: 'GET',
    path: '[supabase] /auth/v1/health',
    title: 'is Supabase reachable',
    desc: 'Confirms the project URL and anon key are usable before you try to sign in.',
    action: 'Check Supabase',
    run: async (_v, result) => {
      const cfg2 = getConfig();
      if (!cfg2.supabaseUrl) { result.message('Set the Supabase project URL first.', true); return; }
      const started = performance.now();
      try {
        const res = await fetch(cfg2.supabaseUrl + '/auth/v1/health', {
          headers: cfg2.anonKey ? { apikey: cfg2.anonKey } : {},
        });
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
        result.render({
          ok: res.ok, status: res.status, data,
          ms: Math.round(performance.now() - started),
          method: 'GET', path: '/auth/v1/health',
          error: res.ok ? undefined : `HTTP ${res.status}`,
        });
      } catch (err) {
        result.message('Could not reach Supabase: ' + err.message, true);
      }
    },
  }));

  /* ---------------- reference ---------------- */

  root.append(sectionLabel('What this console covers'));

  root.append(h('div', { class: 'card open' }, h('div', { class: 'card-body' },
    h('div', { class: 'card-desc', text: 'Every route the backend exposes, and the tab that exercises it.' }),
    jsonBlock({
      'Setup': ['GET /health'],
      'Authentication': ['Supabase signup / token / refresh / logout / recover / user'],
      'Me & profile': ['GET /api/me', 'POST /api/profile'],
      'Reference data': ['GET /api/organizations', 'GET /api/categories'],
      'Teams': ['GET /api/teams', 'POST /api/teams', 'PATCH /api/teams/:id', 'GET /api/teams/:id/grants'],
      'Members & invites': [
        'GET /api/teams/:id/roster', 'PATCH /api/teams/:id/members/:user_id',
        'DELETE /api/teams/:id/members/:user_id', 'POST /api/teams/:id/transfer',
        'POST /api/teams/:id/invites', 'POST /api/invites/accept', 'DELETE /api/invites/:id',
      ],
      'Goals': [
        'POST /api/goals (SSE)', 'GET /api/goals', 'GET /api/teams/:id/goals',
        'DELETE /api/goals/:id', 'PUT /api/goals/:id/subscription', 'DELETE /api/goals/:id/subscription',
      ],
      'Matches': ['GET /api/goals/:id/matched', 'GET /api/teams/:id/matched', 'POST /api/matches/:id/dismiss'],
      'Saved grants': [
        'GET /api/teams/:id/saved', 'POST /api/teams/:id/saved', 'GET /api/saved',
        'PATCH /api/saved/:id', 'DELETE /api/saved/:id',
        'PUT /api/saved/:id/subscription', 'DELETE /api/saved/:id/subscription',
      ],
      'Notifications': [
        'GET /api/notifications', 'GET /api/notifications/unread-count',
        'PATCH /api/notifications/:delivery_id', 'POST /api/notifications/read-all',
        'GET /api/teams/:id/events',
      ],
      'Raw request': ['anything else'],
    }),
  )));
}
