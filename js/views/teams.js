import { h, viewHead, sectionLabel, note, card, table, tag, toast, idCell, stats, miniButton } from '../dom.js';
import { setCtx, getToken } from '../store.js';
import * as api from '../api.js';
import { grantColumns, parseList } from './shared.js';

export function render(root) {
  root.append(viewHead(
    'Teams',
    'A team is a workspace. Most other routes hang off a team_id, so pick an active team here first.',
  ));

  root.append(note(
    'Clicking a <b>team_id</b> in the table sets the active team, shown in the sidebar. Every other tab ' +
    'defaults its <code>team_id</code> field to that value.',
  ));

  /* ---------------- list ---------------- */

  root.append(sectionLabel('Your workspaces'));

  const listCard = card({
    method: 'GET',
    path: '/api/teams',
    title: 'teams you belong to, with your role on each',
    open: true,
    action: 'Load teams',
    run: async (_v, result) => {
      const res = await api.get('/api/teams');
      if (!res.ok) { result.render(res); return; }
      const rows = res.data || [];

      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${rows.length} team(s) · ${res.ms} ms` })),
        rows.length === 0
          ? h('div', { class: 'note', html: 'You are in no workspaces yet. Create one below — you become its owner.' })
          : table([
            { label: 'team_id', cls: 'mono', render: (r) => idCell(r.team_id, 'teamId') },
            { label: 'name', render: (r) => h('div', {},
              h('div', { text: r.name || '—' }),
              r.description && h('div', { class: 'result-meta', text: r.description })) },
            { label: 'my role', render: (r) => tag(r.my_role || '—', r.my_role === 'owner') },
            { label: 'members', cls: 'num', key: 'member_count' },
            { label: 'lead time', cls: 'num', render: (r) => `${r.min_days_to_deadline ?? '—'}d` },
            { label: 'categories', render: (r) => h('span', {},
              (r.categories || []).length
                ? (r.categories || []).map((c) => tag(c))
                : h('span', { class: 'result-meta', text: 'none set' })) },
            { label: '', render: (r) => miniButton('edit', () => {
              setCtx('teamId', r.team_id);
              editCard.cardApi.field('name').set(r.name || '');
              editCard.cardApi.field('description').set(r.description || '');
              editCard.cardApi.field('min_days_to_deadline').set(r.min_days_to_deadline ?? '');
              editCard.cardApi.field('categories').set((r.categories || []).join(', '));
              editCard.cardApi.open();
              editCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }) },
          ], rows),
      );
    },
  });
  root.append(listCard);

  /* ---------------- create ---------------- */

  root.append(sectionLabel('Create'));

  root.append(card({
    method: 'POST',
    path: '/api/teams',
    title: 'create a workspace and own it',
    desc: 'Only a name is required. Categories decide which grants the workspace surfaces, so a team with none set will look empty.',
    action: 'Create team',
    fields: [
      { name: 'name', label: 'name', required: true, placeholder: 'Housing team' },
      { name: 'min_days_to_deadline', label: 'min_days_to_deadline', type: 'number', value: 30, hint: 'Lead time filter. Defaults to 30.' },
      { name: 'description', label: 'description', wide: true },
      { name: 'categories', label: 'categories', wide: true, placeholder: 'housing, community_development',
        hint: 'Comma-separated slugs from the Reference data tab.' },
    ],
    run: async (v, result) => {
      if (!v.name.trim()) { result.message('name is required.', true); return; }
      const body = { name: v.name.trim() };
      if (v.description.trim()) body.description = v.description.trim();
      if (v.min_days_to_deadline !== '') body.min_days_to_deadline = Number(v.min_days_to_deadline);
      const categories = parseList(v.categories);
      if (categories.length) body.categories = categories;

      const res = await api.post('/api/teams', body);
      result.render(res);
      if (res.ok && res.data?.team_id) {
        setCtx('teamId', res.data.team_id);
        toast(`Team ${res.data.team_id} created — now the active team`);
        listCard.cardApi.trigger();
      }
    },
  }));

  /* ---------------- edit ---------------- */

  root.append(sectionLabel('Edit'));

  const editCard = card({
    method: 'PATCH',
    path: '/api/teams/:team_id',
    title: 'rename, retime, or replace categories',
    desc: 'Admins and owners only. Sending categories replaces the whole set rather than adding to it. Blank fields are left alone.',
    action: 'Save changes',
    fields: [
      { name: 'team_id', label: 'team_id', type: 'number', required: true, ctxKey: 'teamId' },
      { name: 'name', label: 'name' },
      { name: 'min_days_to_deadline', label: 'min_days_to_deadline', type: 'number' },
      { name: 'description', label: 'description', wide: true },
      { name: 'categories', label: 'categories', wide: true, placeholder: 'housing, energy',
        hint: 'Replaces every category on the team. Leave blank to keep them as they are.' },
    ],
    run: async (v, result) => {
      if (!v.team_id) { result.message('team_id is required.', true); return; }
      const body = {};
      if (v.name.trim()) body.name = v.name.trim();
      if (v.description.trim()) body.description = v.description.trim();
      if (v.min_days_to_deadline !== '') body.min_days_to_deadline = Number(v.min_days_to_deadline);
      const categories = parseList(v.categories);
      if (categories.length) body.categories = categories;
      if (Object.keys(body).length === 0) { result.message('Nothing to change — fill at least one field.', true); return; }

      const res = await api.patch(`/api/teams/${v.team_id}`, body);
      result.render(res);
      if (res.ok) toast('Team updated');
    },
  });
  root.append(editCard);

  /* ---------------- team grants ---------------- */

  root.append(sectionLabel('What this workspace can see'));

  root.append(card({
    method: 'GET',
    path: '/api/teams/:team_id/grants',
    title: 'open grants in the team’s categories',
    desc: 'Driven entirely by the team’s categories and lead time. An empty result usually means no categories are set — the response says so via needs_categories.',
    action: 'Load grants',
    fields: [
      { name: 'team_id', label: 'team_id', type: 'number', required: true, ctxKey: 'teamId' },
      { name: 'limit', label: 'limit', type: 'number', value: 20 },
    ],
    run: async (v, result) => {
      if (!v.team_id) { result.message('team_id is required.', true); return; }
      const res = await api.get(`/api/teams/${v.team_id}/grants`, { limit: v.limit });
      if (!res.ok) { result.render(res); return; }
      const d = res.data || {};
      const grants = d.grants || [];
      const closing = d.closing_soon || [];

      const nodes = [
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${res.ms} ms` }),
          d.needs_categories ? tag('needs categories', true) : null),
        stats([['grants', grants.length], ['closing soon', closing.length], ['lead time', `${d.lead_time_days ?? '—'}d`]]),
      ];

      if (d.needs_categories) {
        nodes.push(h('div', { class: 'note', html:
          'The backend flagged <code>needs_categories</code>: this team has no funding areas, so there is nothing to show. ' +
          'Set some in the team editor above.' }));
      }

      nodes.push(h('div', { class: 'section-label', text: 'Grants' }));
      nodes.push(table(grantColumns(), grants, { empty: 'No open grants for these categories.' }));

      if (closing.length) {
        nodes.push(h('div', { class: 'section-label', text: 'Closing soon' }));
        nodes.push(table(grantColumns(), closing));
      }

      result.custom(...nodes);
    },
  }));

  // The team list anchors every other panel, so fetch it on arrival.
  if (getToken()) requestAnimationFrame(() => listCard.cardApi.trigger());
}
