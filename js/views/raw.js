import { h, viewHead, sectionLabel, note, card, toast, jsonBlock, table, miniButton } from '../dom.js';
import { getConfig, getToken } from '../store.js';
import * as api from '../api.js';
import { decodeJwt } from '../auth.js';

const ROUTES = [
  ['GET', '/health'],
  ['GET', '/api/jobs/pipeline-health'],
  ['POST', '/api/jobs/nightly'],
  ['GET', '/api/me'],
  ['POST', '/api/profile'],
  ['GET', '/api/organizations?q=nav'],
  ['GET', '/api/categories'],
  ['GET', '/api/grants/search?q=tribal+broadband&limit=20'],
  ['GET', '/api/teams'],
  ['POST', '/api/teams'],
  ['PATCH', '/api/teams/1'],
  ['GET', '/api/teams/1/roster'],
  ['GET', '/api/teams/1/grants?limit=20'],
  ['PATCH', '/api/teams/1/members/<user_id>'],
  ['DELETE', '/api/teams/1/members/<user_id>'],
  ['POST', '/api/teams/1/transfer'],
  ['POST', '/api/teams/1/invites'],
  ['POST', '/api/invites/accept'],
  ['DELETE', '/api/invites/1'],
  ['GET', '/api/goals'],
  ['POST', '/api/goals'],
  ['GET', '/api/teams/1/goals'],
  ['GET', '/api/goals/1/matched'],
  ['GET', '/api/teams/1/matched?limit=40'],
  ['DELETE', '/api/goals/1'],
  ['PUT', '/api/goals/1/subscription'],
  ['DELETE', '/api/goals/1/subscription'],
  ['POST', '/api/matches/1/dismiss'],
  ['GET', '/api/teams/1/saved'],
  ['POST', '/api/teams/1/saved'],
  ['GET', '/api/saved'],
  ['PATCH', '/api/saved/1'],
  ['DELETE', '/api/saved/1'],
  ['PUT', '/api/saved/1/subscription'],
  ['DELETE', '/api/saved/1/subscription'],
  ['GET', '/api/notifications?limit=50'],
  ['GET', '/api/notifications/unread-count'],
  ['PATCH', '/api/notifications/1'],
  ['POST', '/api/notifications/read-all'],
  ['GET', '/api/teams/1/events?limit=50'],
];

export function render(root) {
  root.append(viewHead(
    'Raw request',
    'Any method against any path, with whatever body you like. For anything the other tabs do not cover.',
  ));

  root.append(note(
    'The path is appended to the configured base URL, and the bearer token is attached unless you turn it off. ' +
    'A query string typed into the path is preserved.',
  ));

  const runner = card({
    method: 'POST',
    path: '(anything)',
    title: 'hand-rolled request',
    open: true,
    action: 'Send',
    fields: [
      { name: 'method', label: 'method', type: 'select', options: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] },
      { name: 'path', label: 'path', wide: true, value: '/api/me', placeholder: '/api/teams/1/goals' },
      { name: 'auth', label: 'send Authorization header', type: 'checkbox', value: true },
      { name: 'body', label: 'JSON body', type: 'textarea', wide: true, rows: 6,
        hint: 'Leave blank to send no body. Must be valid JSON.' },
    ],
    run: async (v, result) => {
      const path = v.path.trim();
      if (!path.startsWith('/')) { result.message('Path must start with a slash.', true); return; }

      let body;
      if (v.body.trim()) {
        try {
          body = JSON.parse(v.body);
        } catch (err) {
          result.message('Body is not valid JSON: ' + err.message, true);
          return;
        }
      }

      const res = await api.request(v.method, path, { body, auth: v.auth });
      result.render(res);
      if (!res.ok) toast(`${res.status || 'failed'} — ${res.error}`, true);
    },
  });
  root.append(runner);

  /* ---------------- route index ---------------- */

  root.append(sectionLabel('Every route on the backend'));

  root.append(h('div', { class: 'card open' }, h('div', { class: 'card-body' },
    h('div', { class: 'card-desc', text:
      'The full surface, with ids as placeholders. "load" drops one into the runner above.' }),
    table([
      { label: 'method', cls: 'mono', render: (r) => h('span', { class: 'method ' + r[0], text: r[0] }) },
      { label: 'path', cls: 'mono', render: (r) => r[1] },
      { label: '', render: (r) => miniButton('load', () => {
        runner.cardApi.field('method').set(r[0]);
        runner.cardApi.field('path').set(r[1]);
        runner.cardApi.open();
        runner.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(`${r[0]} ${r[1]} loaded`);
      }) },
    ], ROUTES),
  )));

  /* ---------------- current state ---------------- */

  root.append(sectionLabel('What this console is sending'));

  const cfg = getConfig();
  const token = getToken();
  const decoded = token ? decodeJwt(token) : null;

  root.append(h('div', { class: 'card open' }, h('div', { class: 'card-body' },
    jsonBlock({
      base_url: cfg.apiBase,
      supabase_url: cfg.supabaseUrl,
      anon_key: cfg.anonKey ? cfg.anonKey.slice(0, 10) + '…' : '(not set)',
      page_origin: location.origin,
      authorization: token ? `Bearer ${token.slice(0, 18)}…` : '(none — not signed in)',
      token_subject: decoded?.payload?.sub ?? null,
      token_expires: decoded?.payload?.exp ? new Date(decoded.payload.exp * 1000).toISOString() : null,
    }),
  )));
}
