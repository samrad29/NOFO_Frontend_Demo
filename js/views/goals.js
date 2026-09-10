import { h, viewHead, sectionLabel, note, card, table, tag, toast, idCell, miniButton, clear, stats } from '../dom.js';
import { setCtx, getToken } from '../store.js';
import * as api from '../api.js';
import { grantColumns, verdictCell, viewGrantButton } from './shared.js';

const STAGE_LABELS = {
  created: 'goal written',
  reading: 'reading the description',
  searching: 'searching',
  comparing: 'reranking',
  judging: 'judging candidates',
  done: 'finished',
  results: 'results returned',
  error: 'failed',
};

export function render(root) {
  root.append(viewHead(
    'Goals',
    'A goal is a description of what you are trying to fund. Creating one runs the matcher immediately.',
  ));

  root.append(note(
    'Creating a goal is the one route that streams: it answers with <b>server-sent events</b> and reports each ' +
    'stage as it finishes, over roughly three to eight seconds. Leave <code>team_id</code> blank for a personal ' +
    'goal, or set it to share the goal with a workspace.',
  ));

  /* ---------------- create (SSE) ---------------- */

  root.append(sectionLabel('Create'));

  const stream = h('div', { class: 'stream' });

  const createCard = card({
    method: 'POST',
    path: '/api/goals',
    title: 'write a goal and match it (streaming)',
    open: true,
    action: 'Create & match',
    fields: [
      { name: 'title', label: 'title', required: true, wide: true, placeholder: 'Replace aging water mains' },
      {
        name: 'description',
        label: 'description',
        type: 'textarea',
        wide: true,
        required: true,
        rows: 4,
        placeholder: 'We need to replace roughly four miles of aging cast-iron water main serving the older part '
          + 'of the community, including hydrant replacement and service line inspection.',
        hint: 'Forty characters minimum — the backend rejects anything shorter because it will not match well.',
      },
      { name: 'team_id', label: 'team_id', type: 'number', ctxKey: 'teamId', hint: 'Blank for a personal goal.' },
      { name: 'department', label: 'department', placeholder: 'Public Works' },
    ],
    extra: (body) => body.append(stream),
    run: async (v, result) => {
      const title = v.title.trim();
      const description = v.description.trim();

      if (!title) { result.message('title is required.', true); return; }
      if (description.length < 40) {
        result.message(`description is ${description.length} characters; the backend requires at least 40.`, true);
        return;
      }

      const body = { title, description };
      if (v.team_id !== '') body.team_id = Number(v.team_id);
      if (v.department.trim()) body.department = v.department.trim();

      clear(stream);
      stream.classList.add('show');
      result.clear();

      const started = performance.now();
      const addRow = (stage, message, isError = false) => {
        stream.append(h('div', { class: 'stream-row' + (isError ? ' is-error' : '') },
          h('span', { class: 'stream-stage', text: stage }),
          h('span', { class: 'stream-msg', text: message }),
          h('span', { class: 'grow' }),
          h('span', { class: 'result-meta', text: `${Math.round(performance.now() - started)} ms` })));
        stream.scrollTop = stream.scrollHeight;
      };

      const res = await api.streamGoal(body, (event) => {
        const label = STAGE_LABELS[event.stage] || event.stage;
        let detail = event.message || '';
        if (event.stage === 'created') detail = `goal_id ${event.goal_id}`;
        if (event.stage === 'judging' && event.total) {
          detail = `${event.done ?? 0}/${event.total} judged` + (event.found ? ` · ${event.found} found` : '');
        }
        if (event.stage === 'done') {
          detail = `${event.matched ?? 0} matched · ${event.strong ?? 0} strong · ${event.partial ?? 0} partial`;
        }
        if (event.stage === 'results') detail = `${(event.grants || []).length} grant(s)`;
        addRow(label, detail, event.stage === 'error');

        if (event.stage === 'created' && event.goal_id) setCtx('goalId', event.goal_id);
      });

      const events = res.data?.events || [];
      const results = events.find((e) => e.stage === 'results');
      const summary = events.find((e) => e.stage === 'done');

      if (!res.ok && events.length === 0) {
        result.render(res);
        return;
      }

      const nodes = [
        h('div', { class: 'result-head' },
          h('span', { class: 'status ' + (res.ok ? 'ok' : 'bad'), text: res.status }),
          h('span', { class: 'result-meta', text: `${events.length} SSE event(s) · ${res.ms} ms` }),
          res.error ? tag('stream error') : null),
      ];

      if (res.error) nodes.push(h('pre', { class: 'json err', text: res.error }));

      if (summary) {
        nodes.push(stats([
          ['matched', summary.matched ?? 0],
          ['strong', summary.strong ?? 0],
          ['partial', summary.partial ?? 0],
        ]));
      }

      if (results) {
        nodes.push(h('div', { class: 'section-label', text: 'Matched grants' }));
        nodes.push(table([
          { label: 'verdict', render: verdictCell },
          ...grantColumns(),
          { label: 'reason', render: (r) => h('span', { class: 'clip', title: r.reason || '', text: r.reason || '—' }) },
          { label: '', render: viewGrantButton },
        ], results.grants || [], { empty: 'The matcher found nothing for this goal.' }));
        toast(`Goal ${results.goal_id} matched ${(results.grants || []).length} grant(s)`);
        listCard.cardApi.trigger();
      }

      result.custom(...nodes);
    },
  });
  root.append(createCard);

  /* ---------------- personal goals ---------------- */

  root.append(sectionLabel('Your goals'));

  const listCard = card({
    method: 'GET',
    path: '/api/goals',
    title: 'personal goals (no team)',
    desc: 'Active goals you own that belong to no workspace.',
    open: true,
    action: 'Load personal goals',
    run: async (_v, result) => {
      const res = await api.get('/api/goals');
      if (!res.ok) { result.render(res); return; }
      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${(res.data || []).length} goal(s) · ${res.ms} ms` })),
        goalTable(res.data || [], () => listCard.cardApi.trigger(), true),
      );
    },
  });
  root.append(listCard);

  const teamGoalsCard = card({
    method: 'GET',
    path: '/api/teams/:team_id/goals',
    title: 'a workspace’s goals',
    desc: 'Shared goals, with how many grants each has matched and whether you follow it.',
    fields: [{ name: 'team_id', label: 'team_id', type: 'number', required: true, ctxKey: 'teamId' }],
    action: 'Load team goals',
    run: async (v, result) => {
      if (!v.team_id) { result.message('team_id is required.', true); return; }
      const res = await api.get(`/api/teams/${v.team_id}/goals`);
      if (!res.ok) { result.render(res); return; }
      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${(res.data || []).length} goal(s) · ${res.ms} ms` })),
        goalTable(res.data || [], () => teamGoalsCard.cardApi.trigger(), false),
      );
    },
  });
  root.append(teamGoalsCard);

  /* ---------------- subscriptions & archive ---------------- */

  root.append(sectionLabel('Following & archiving'));

  root.append(card({
    method: 'PUT',
    path: '/api/goals/:goal_id/subscription',
    title: 'follow a goal',
    desc: 'Following controls whether new matches on this goal reach your notification inbox.',
    action: 'Follow',
    fields: [{ name: 'goal_id', label: 'goal_id', type: 'number', required: true, ctxKey: 'goalId' }],
    buttons: [{
      label: 'Unfollow',
      run: async (v, result) => {
        if (!v.goal_id) { result.message('goal_id is required.', true); return; }
        const res = await api.del(`/api/goals/${v.goal_id}/subscription`);
        result.render(res);
        if (res.status === 400) {
          result.setBody(h('div', { class: 'note', html:
            'The backend refuses to unfollow a <b>personal</b> goal — you always follow your own. ' +
            'Try a team goal instead.' }));
        } else if (res.ok) toast('Unfollowed');
      },
    }],
    run: async (v, result) => {
      if (!v.goal_id) { result.message('goal_id is required.', true); return; }
      const res = await api.put(`/api/goals/${v.goal_id}/subscription`);
      result.render(res);
      if (res.ok) toast('Following goal ' + v.goal_id);
    },
  }));

  root.append(card({
    method: 'DELETE',
    path: '/api/goals/:goal_id',
    title: 'archive a goal',
    desc: 'A soft delete: is_active flips to false so the matches it produced survive.',
    action: 'Archive',
    fields: [{ name: 'goal_id', label: 'goal_id', type: 'number', required: true, ctxKey: 'goalId' }],
    run: async (v, result) => {
      if (!v.goal_id) { result.message('goal_id is required.', true); return; }
      if (!confirm(`Archive goal ${v.goal_id}?`)) return;
      const res = await api.del(`/api/goals/${v.goal_id}`);
      result.render(res);
      if (res.ok) { toast('Goal archived'); listCard.cardApi.trigger(); }
    },
  }));

  if (getToken()) requestAnimationFrame(() => listCard.cardApi.trigger());

  /* ---------------- helpers ---------------- */

  function goalTable(rows, reload, personal) {
    return table([
      { label: 'goal_id', cls: 'mono', render: (r) => idCell(r.goal_id, 'goalId') },
      { label: 'title', render: (r) => h('div', {},
        h('div', { text: r.title || '—' }),
        h('div', { class: 'result-meta clip', title: r.description || '', text: r.description || '' })) },
      { label: 'department', key: 'department' },
      { label: 'matches', cls: 'num', render: (r) => `${r.match_count ?? 0}` },
      { label: 'strong', cls: 'num', render: (r) => `${r.strong_count ?? 0}` },
      { label: 'following', render: (r) => (r.following ? tag('yes', true) : tag('no')) },
      { label: 'created', cls: 'mono', render: (r) => (r.created_at ? String(r.created_at).slice(0, 10) : '—') },
      { label: '', render: (r) => h('div', { class: 'cell-actions' },
        miniButton('matches', () => {
          setCtx('goalId', r.goal_id);
          toast(`goal_id = ${r.goal_id} — open the Matches tab`);
        }),
        personal ? null : miniButton(r.following ? 'unfollow' : 'follow', async () => {
          const res = r.following
            ? await api.del(`/api/goals/${r.goal_id}/subscription`)
            : await api.put(`/api/goals/${r.goal_id}/subscription`);
          toast(res.ok ? (r.following ? 'Unfollowed' : 'Following') : res.error, !res.ok);
          if (res.ok) reload();
        }),
        miniButton('archive', async () => {
          if (!confirm(`Archive goal ${r.goal_id} — "${r.title}"?`)) return;
          const res = await api.del(`/api/goals/${r.goal_id}`);
          toast(res.ok ? 'Archived' : res.error, !res.ok);
          if (res.ok) reload();
        }),
      ) },
    ], rows, { empty: personal ? 'No personal goals yet. Create one above.' : 'This workspace has no goals yet.' });
  }
}
