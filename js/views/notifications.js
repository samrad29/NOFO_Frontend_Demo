import { h, viewHead, sectionLabel, note, card, table, tag, toast, idCell, miniButton, stats, fmtDate, jsonBlock } from '../dom.js';
import { getCtx, getToken } from '../store.js';
import * as api from '../api.js';
import { viewGrantButton } from './shared.js';

export function render(root) {
  root.append(viewHead(
    'Notifications',
    'Your personal inbox, plus the shared activity feed for a workspace.',
  ));

  root.append(note(
    'There is no websocket or push channel — the inbox is <b>polled</b>. Events themselves are written by the ' +
    'nightly pipeline and by actions in the app, so a brand new account will have an empty inbox until a goal ' +
    'match or a grant change happens. Kinds you will see: <code>goal_match</code>, <code>grant_changed</code>, ' +
    '<code>program_reopened</code>, <code>program_new_opportunity</code>.',
  ));

  /* ---------------- unread count ---------------- */

  root.append(sectionLabel('Unread'));

  root.append(card({
    method: 'GET',
    path: '/api/notifications/unread-count',
    title: 'the badge number',
    open: true,
    action: 'Get count',
    run: async (_v, result) => {
      const res = await api.get('/api/notifications/unread-count');
      if (!res.ok) { result.render(res); return; }
      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${res.ms} ms` })),
        stats([['unread', res.data?.count ?? 0]]),
      );
    },
  }));

  /* ---------------- inbox ---------------- */

  root.append(sectionLabel('Inbox'));

  const inboxCard = card({
    method: 'GET',
    path: '/api/notifications',
    title: 'personal inbox, newest first',
    desc: 'Deliveries addressed to you, from the goals and saved grants you follow.',
    open: true,
    action: 'Load inbox',
    fields: [
      { name: 'unread_only', label: 'unread_only', type: 'checkbox' },
      { name: 'limit', label: 'limit', type: 'number', value: 50, hint: 'Capped at 200 by the backend.' },
    ],
    buttons: [{
      label: 'Mark all read',
      run: async (_v, result) => {
        const res = await api.post('/api/notifications/read-all');
        result.render(res);
        if (res.ok) {
          toast(`${res.data?.updated ?? 0} marked read`);
          inboxCard.cardApi.trigger();
        }
      },
    }],
    run: async (v, result) => {
      const query = { limit: v.limit };
      if (v.unread_only) query.unread_only = '1';
      const res = await api.get('/api/notifications', query);
      if (!res.ok) { result.render(res); return; }

      const rows = res.data || [];
      const unread = rows.filter((r) => !r.read_at).length;
      const reload = () => inboxCard.cardApi.trigger();

      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${rows.length} delivery(s) · ${res.ms} ms` })),
        stats([['shown', rows.length], ['unread', unread]]),
        table([
          { label: 'delivery_id', cls: 'mono', render: (r) => idCell(r.delivery_id, 'deliveryId') },
          { label: '', render: (r) => (r.read_at ? tag('read') : tag('new', true)) },
          { label: 'kind', render: (r) => tag(r.kind || '—') },
          { label: 'notification', render: (r) => h('div', {},
            h('div', { text: r.title || '—' }),
            r.body && h('div', { class: 'result-meta clip', title: r.body, text: r.body })) },
          { label: 'links', cls: 'mono', render: (r) => h('div', { class: 'cell-actions' },
            r.team_id ? idCell(r.team_id, 'teamId', `team ${r.team_id}`) : null,
            r.goal_id ? idCell(r.goal_id, 'goalId', `goal ${r.goal_id}`) : null,
            r.saved_grant_id ? idCell(r.saved_grant_id, 'savedId', `saved ${r.saved_grant_id}`) : null,
            r.opportunity_id ? idCell(r.opportunity_id, 'opportunityId', 'opportunity') : null,
            r.opportunity_id ? viewGrantButton(r) : null,
          ) },
          { label: 'delivered', cls: 'mono', render: (r) => fmtDate(r.delivered_at) },
          { label: '', render: (r) => h('div', { class: 'cell-actions' },
            miniButton(r.read_at ? 'unread' : 'read', async () => {
              const out = await api.patch(`/api/notifications/${r.delivery_id}`, { read: !r.read_at });
              toast(out.ok ? (r.read_at ? 'Marked unread' : 'Marked read') : out.error, !out.ok);
              if (out.ok) reload();
            }),
            miniButton('metadata', () => {
              const box = h('div', {},
                h('div', { class: 'section-label', text: `delivery ${r.delivery_id} · event ${r.event_id}` }),
                jsonBlock(r));
              result.setBody(box);
            }),
          ) },
        ], rows, {
          rowClass: (r) => (r.read_at ? '' : 'unread'),
          empty: v.unread_only ? 'Nothing unread.' : 'Inbox is empty. Follow a goal and let the matcher run.',
        }),
      );
    },
  });
  root.append(inboxCard);

  /* ---------------- single delivery ---------------- */

  root.append(sectionLabel('Mark read'));

  root.append(card({
    method: 'PATCH',
    path: '/api/notifications/:delivery_id',
    title: 'flip one delivery',
    desc: 'Body is {read: true|false}, defaulting to true when omitted.',
    action: 'Mark read',
    fields: [{ name: 'delivery_id', label: 'delivery_id', type: 'number', required: true, ctxKey: 'deliveryId' }],
    buttons: [{
      label: 'Mark unread',
      run: async (v, result) => {
        if (!v.delivery_id) { result.message('delivery_id is required.', true); return; }
        const res = await api.patch(`/api/notifications/${v.delivery_id}`, { read: false });
        result.render(res);
        if (res.ok) toast('Marked unread');
      },
    }],
    run: async (v, result) => {
      if (!v.delivery_id) { result.message('delivery_id is required.', true); return; }
      const res = await api.patch(`/api/notifications/${v.delivery_id}`, { read: true });
      result.render(res);
      if (res.ok) toast('Marked read');
    },
  }));

  root.append(card({
    method: 'POST',
    path: '/api/notifications/read-all',
    title: 'mark the whole inbox read',
    action: 'Mark all read',
    run: async (_v, result) => {
      const res = await api.post('/api/notifications/read-all');
      result.render(res);
      if (res.ok) toast(`${res.data?.updated ?? 0} marked read`);
    },
  }));

  /* ---------------- team events ---------------- */

  root.append(sectionLabel('Workspace activity'));

  const eventsCard = card({
    method: 'GET',
    path: '/api/teams/:team_id/events',
    title: 'shared feed, regardless of what you follow',
    desc: 'The team-wide event log. Unlike the inbox this is not per-user, so it shows activity you never subscribed to.',
    fields: [
      { name: 'team_id', label: 'team_id', type: 'number', required: true, ctxKey: 'teamId' },
      { name: 'limit', label: 'limit', type: 'number', value: 50 },
    ],
    action: 'Load events',
    run: async (v, result) => {
      if (!v.team_id) { result.message('team_id is required.', true); return; }
      const res = await api.get(`/api/teams/${v.team_id}/events`, { limit: v.limit });
      if (!res.ok) { result.render(res); return; }
      const rows = res.data || [];
      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${rows.length} event(s) · ${res.ms} ms` })),
        table([
          { label: 'event_id', cls: 'mono', key: 'event_id' },
          { label: 'kind', render: (r) => tag(r.kind || '—') },
          { label: 'event', render: (r) => h('div', {},
            h('div', { text: r.title || '—' }),
            r.body && h('div', { class: 'result-meta clip', title: r.body, text: r.body })) },
          { label: 'links', cls: 'mono', render: (r) => h('div', { class: 'cell-actions' },
            r.goal_id ? idCell(r.goal_id, 'goalId', `goal ${r.goal_id}`) : null,
            r.saved_grant_id ? idCell(r.saved_grant_id, 'savedId', `saved ${r.saved_grant_id}`) : null,
            r.opportunity_id ? idCell(r.opportunity_id, 'opportunityId', 'opportunity') : null,
            r.opportunity_id ? viewGrantButton(r) : null,
          ) },
          { label: 'created', cls: 'mono', render: (r) => fmtDate(r.created_at) },
        ], rows, { empty: 'No activity for this workspace yet.' }),
      );
    },
  });
  root.append(eventsCard);

  if (getToken()) {
    requestAnimationFrame(() => {
      inboxCard.cardApi.trigger();
      if (getCtx('teamId')) eventsCard.cardApi.trigger();
    });
  }
}
