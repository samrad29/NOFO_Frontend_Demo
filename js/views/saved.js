import { h, viewHead, sectionLabel, note, card, table, tag, toast, idCell, miniButton, stats, fmtDate, shorten } from '../dom.js';
import { setCtx, getCtx, getToken } from '../store.js';
import * as api from '../api.js';
import { grantColumns } from './shared.js';

const STATUSES = ['saved', 'pursuing', 'submitted', 'awarded', 'declined'];

export function render(root) {
  root.append(viewHead(
    'Saved grants',
    'The watchlist. Each team has exactly one, and a saved grant moves through a status pipeline.',
  ));

  root.append(note(
    'There is no separate watchlist object to create — a team’s watchlist exists implicitly, and saving a grant ' +
    'to a team adds to it. Statuses run <code>saved → pursuing → submitted → awarded / declined</code>, and the ' +
    'read route groups them into <b>watching</b>, <b>pursuing</b>, and <b>past</b>.',
  ));

  /* ---------------- team watchlist ---------------- */

  root.append(sectionLabel('A team’s watchlist'));

  const listCard = card({
    method: 'GET',
    path: '/api/teams/:team_id/saved',
    title: 'grouped by where each grant has got to',
    open: true,
    action: 'Load watchlist',
    fields: [{ name: 'team_id', label: 'team_id', type: 'number', required: true, ctxKey: 'teamId' }],
    run: async (v, result) => {
      if (!v.team_id) { result.message('team_id is required.', true); return; }
      const res = await api.get(`/api/teams/${v.team_id}/saved`);
      if (!res.ok) { result.render(res); return; }

      const d = res.data || {};
      const counts = d.counts || {};
      const reload = () => listCard.cardApi.trigger();
      const groups = [
        ['Watching', d.watching || []],
        ['Pursuing', d.pursuing || []],
        ['Past', d.past || []],
      ];

      const nodes = [
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `team ${d.team_id} · ${res.ms} ms` })),
        stats(STATUSES.map((s) => [s, counts[s] ?? 0])),
      ];

      for (const [label, rows] of groups) {
        nodes.push(h('div', { class: 'section-label', text: `${label} (${rows.length})` }));
        nodes.push(savedTable(rows, reload));
      }

      result.custom(...nodes);
    },
  });
  root.append(listCard);

  /* ---------------- save ---------------- */

  root.append(sectionLabel('Save a grant'));

  root.append(card({
    method: 'POST',
    path: '/api/teams/:team_id/saved',
    title: 'add a grant to a team’s watchlist',
    desc: 'Needs an opportunity_id — grab one from the Matches tab or a team’s grants list, which sets it as the active id.',
    action: 'Save grant',
    fields: [
      { name: 'team_id', label: 'team_id', type: 'number', required: true, ctxKey: 'teamId' },
      { name: 'opportunity_id', label: 'opportunity_id', required: true, wide: true, ctxKey: 'opportunityId', placeholder: 'uuid' },
      { name: 'goal_id', label: 'goal_id', type: 'number', ctxKey: 'goalId', hint: 'Optional provenance: which goal this came from.' },
      { name: 'note', label: 'note', wide: true },
    ],
    run: async (v, result) => {
      if (!v.team_id || !v.opportunity_id.trim()) {
        result.message('team_id and opportunity_id are both required.', true);
        return;
      }
      const body = { opportunity_id: v.opportunity_id.trim() };
      if (v.goal_id !== '') body.goal_id = Number(v.goal_id);
      if (v.note.trim()) body.note = v.note.trim();

      const res = await api.post(`/api/teams/${v.team_id}/saved`, body);
      result.render(res);
      if (res.ok) {
        if (res.data?.id) setCtx('savedId', res.data.id);
        toast(`Saved as ${res.data?.status} (saved_id ${res.data?.id})`);
        listCard.cardApi.trigger();
      }
    },
  }));

  root.append(card({
    method: 'GET',
    path: '/api/saved?opportunity_id=',
    title: 'which of my teams already saved this',
    desc: 'Answers the "am I duplicating work" question across every team you belong to.',
    action: 'Check teams',
    fields: [{ name: 'opportunity_id', label: 'opportunity_id', wide: true, ctxKey: 'opportunityId' }],
    run: async (v, result) => {
      const res = await api.get('/api/saved', { opportunity_id: v.opportunity_id.trim() });
      if (!res.ok) { result.render(res); return; }
      const rows = res.data || [];
      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${rows.length} team(s) · ${res.ms} ms` })),
        table([
          { label: 'team_id', cls: 'mono', render: (r) => idCell(r.team_id, 'teamId') },
          { label: 'team', key: 'name' },
          { label: 'already saved', render: (r) => (r.already_saved ? tag('yes', true) : tag('no')) },
        ], rows, { empty: 'You belong to no teams.' }),
      );
    },
  }));

  /* ---------------- update ---------------- */

  root.append(sectionLabel('Move it along'));

  root.append(card({
    method: 'PATCH',
    path: '/api/saved/:saved_id',
    title: 'change status, annotate, or archive',
    desc: 'Every field is optional; send only what you want to change. archived is a boolean, not a timestamp.',
    action: 'Update',
    fields: [
      { name: 'saved_id', label: 'saved_id', type: 'number', required: true, ctxKey: 'savedId' },
      { name: 'status', label: 'status', type: 'select', options: [['', '(leave alone)'], ...STATUSES] },
      { name: 'archived', label: 'archived', type: 'select', options: [['', '(leave alone)'], ['true', 'true'], ['false', 'false']] },
      { name: 'note', label: 'note', wide: true },
    ],
    run: async (v, result) => {
      if (!v.saved_id) { result.message('saved_id is required.', true); return; }
      const body = {};
      if (v.status) body.status = v.status;
      if (v.archived !== '') body.archived = v.archived === 'true';
      if (v.note.trim()) body.note = v.note.trim();
      if (Object.keys(body).length === 0) { result.message('Nothing to change.', true); return; }

      const res = await api.patch(`/api/saved/${v.saved_id}`, body);
      result.render(res);
      if (res.ok) { toast('Updated'); listCard.cardApi.trigger(); }
    },
  }));

  root.append(card({
    method: 'PUT',
    path: '/api/saved/:saved_id/subscription',
    title: 'follow updates to a saved grant',
    desc: 'Following decides whether changes to this grant — a new deadline, a reopening — reach your inbox.',
    action: 'Follow',
    fields: [{ name: 'saved_id', label: 'saved_id', type: 'number', required: true, ctxKey: 'savedId' }],
    buttons: [{
      label: 'Unfollow',
      run: async (v, result) => {
        if (!v.saved_id) { result.message('saved_id is required.', true); return; }
        const res = await api.del(`/api/saved/${v.saved_id}/subscription`);
        result.render(res);
        if (res.ok) toast('Unfollowed');
      },
    }],
    run: async (v, result) => {
      if (!v.saved_id) { result.message('saved_id is required.', true); return; }
      const res = await api.put(`/api/saved/${v.saved_id}/subscription`);
      result.render(res);
      if (res.ok) toast('Following');
    },
  }));

  root.append(card({
    method: 'DELETE',
    path: '/api/saved/:saved_id',
    title: 'unsave entirely',
    desc: 'A hard delete, unlike archiving a goal. Use PATCH archived=true if you want to keep the row.',
    action: 'Delete',
    fields: [{ name: 'saved_id', label: 'saved_id', type: 'number', required: true, ctxKey: 'savedId' }],
    run: async (v, result) => {
      if (!v.saved_id) { result.message('saved_id is required.', true); return; }
      if (!confirm(`Permanently remove saved grant ${v.saved_id}?`)) return;
      const res = await api.del(`/api/saved/${v.saved_id}`);
      result.render(res);
      if (res.ok) { toast('Removed'); listCard.cardApi.trigger(); }
    },
  }));

  if (getToken() && getCtx('teamId')) requestAnimationFrame(() => listCard.cardApi.trigger());

  /* ---------------- helpers ---------------- */

  function savedTable(rows, reload) {
    return table([
      { label: 'saved_id', cls: 'mono', render: (r) => idCell(r.id, 'savedId') },
      { label: 'status', render: (r) => h('span', {},
        tag(r.status || '—', r.status === 'pursuing' || r.status === 'awarded'),
        r.archived_at ? tag('archived') : null,
        r.is_stale ? tag('stale') : null) },
      ...grantColumns(),
      { label: 'from goal', render: (r) => (r.from_goal
        ? h('span', { class: 'clip', title: r.from_goal, text: r.from_goal })
        : '—') },
      { label: 'note', render: (r) => h('span', { class: 'clip', title: r.note || '', text: r.note || '—' }) },
      { label: 'added', cls: 'mono', render: (r) => h('div', {},
        h('div', { text: fmtDate(r.added_at) }),
        h('div', { class: 'result-meta', text: r.added_by || shorten(r.added_by_user_id, 8) })) },
      { label: 'following', render: (r) => (r.following ? tag('yes', true) : tag('no')) },
      { label: '', render: (r) => {
        const next = {
          saved: 'pursuing', pursuing: 'submitted', submitted: 'awarded',
        }[r.status];
        return h('div', { class: 'cell-actions' },
          next ? miniButton(`→ ${next}`, async () => {
            const res = await api.patch(`/api/saved/${r.id}`, { status: next });
            toast(res.ok ? `Now ${next}` : res.error, !res.ok);
            if (res.ok) reload();
          }) : null,
          miniButton(r.following ? 'unfollow' : 'follow', async () => {
            const res = r.following
              ? await api.del(`/api/saved/${r.id}/subscription`)
              : await api.put(`/api/saved/${r.id}/subscription`);
            toast(res.ok ? (r.following ? 'Unfollowed' : 'Following') : res.error, !res.ok);
            if (res.ok) reload();
          }),
          miniButton('remove', async () => {
            if (!confirm(`Remove saved grant ${r.id}?`)) return;
            const res = await api.del(`/api/saved/${r.id}`);
            toast(res.ok ? 'Removed' : res.error, !res.ok);
            if (res.ok) reload();
          }),
        );
      } },
    ], rows, { empty: 'Nothing in this group.' });
  }
}
