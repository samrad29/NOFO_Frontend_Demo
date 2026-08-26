import { h, viewHead, sectionLabel, note, card, table, tag, toast, idCell, miniButton, stats, fmtDate } from '../dom.js';
import { setCtx, getCtx, getToken } from '../store.js';
import * as api from '../api.js';
import { grantColumns, verdictCell } from './shared.js';

export function render(root) {
  root.append(viewHead(
    'Matches',
    'What the matcher found for a goal. Matches are produced when a goal is created and again by the nightly job.',
  ));

  root.append(note(
    'Only <b>strong</b> and <b>partial</b> verdicts surface here — weaker ones are stored but not fed back. ' +
    'Dismissing a match hides it from these feeds without deleting it.',
  ));

  /* ---------------- by goal ---------------- */

  root.append(sectionLabel('By goal'));

  const goalCard = card({
    method: 'GET',
    path: '/api/goals/:goal_id/matched',
    title: 'one goal’s matches',
    open: true,
    action: 'Load matches',
    fields: [{ name: 'goal_id', label: 'goal_id', type: 'number', required: true, ctxKey: 'goalId' }],
    run: async (v, result) => {
      if (!v.goal_id) { result.message('goal_id is required.', true); return; }
      const res = await api.get(`/api/goals/${v.goal_id}/matched`);
      renderMatches(res, result, () => goalCard.cardApi.trigger());
    },
  });
  root.append(goalCard);

  /* ---------------- by team ---------------- */

  root.append(sectionLabel('By workspace'));

  const teamCard = card({
    method: 'GET',
    path: '/api/teams/:team_id/matched',
    title: 'every goal in a workspace',
    desc: 'The combined feed across all of a team’s goals.',
    fields: [
      { name: 'team_id', label: 'team_id', type: 'number', required: true, ctxKey: 'teamId' },
      { name: 'limit', label: 'limit', type: 'number', value: 40 },
    ],
    action: 'Load matches',
    run: async (v, result) => {
      if (!v.team_id) { result.message('team_id is required.', true); return; }
      const res = await api.get(`/api/teams/${v.team_id}/matched`, { limit: v.limit });
      renderMatches(res, result, () => teamCard.cardApi.trigger(), true);
    },
  });
  root.append(teamCard);

  /* ---------------- dismiss ---------------- */

  root.append(sectionLabel('Dismiss'));

  root.append(card({
    method: 'POST',
    path: '/api/matches/:match_id/dismiss',
    title: 'hide a match',
    desc: 'Sets dismissed on the match row. The match_id is the `id` field on a match, not the opportunity_id.',
    action: 'Dismiss',
    fields: [{ name: 'match_id', label: 'match_id', type: 'number', required: true, ctxKey: 'matchId' }],
    run: async (v, result) => {
      if (!v.match_id) { result.message('match_id is required.', true); return; }
      const res = await api.post(`/api/matches/${v.match_id}/dismiss`);
      result.render(res);
      if (res.ok) toast('Match dismissed');
    },
  }));

  if (getToken() && getCtx('goalId')) requestAnimationFrame(() => goalCard.cardApi.trigger());

  /* ---------------- helpers ---------------- */

  function renderMatches(res, result, reload, showGoal = false) {
    if (!res.ok) { result.render(res); return; }
    const rows = res.data || [];
    const strong = rows.filter((r) => r.verdict === 'strong').length;
    const dismissed = rows.filter((r) => r.dismissed).length;

    result.custom(
      h('div', { class: 'result-head' },
        h('span', { class: 'status ok', text: res.status }),
        h('span', { class: 'result-meta', text: `${rows.length} match(es) · ${res.ms} ms` })),
      stats([['matches', rows.length], ['strong', strong], ['partial', rows.length - strong], ['dismissed', dismissed]]),
      table([
        { label: 'match_id', cls: 'mono', render: (r) => idCell(r.id, 'matchId') },
        showGoal
          ? { label: 'goal', render: (r) => h('div', {},
            h('div', { class: 'clip', text: r.goal_title || '—' }),
            idCell(r.goal_id, 'goalId', `goal ${r.goal_id}`)) }
          : null,
        { label: 'verdict', render: verdictCell },
        ...grantColumns(),
        { label: 'reason', render: (r) => h('span', { class: 'clip', title: r.reason || '', text: r.reason || '—' }) },
        { label: 'matched', cls: 'mono', render: (r) => fmtDate(r.matched_at) },
        { label: '', render: (r) => h('div', { class: 'cell-actions' },
          miniButton('save', () => {
            setCtx('opportunityId', r.opportunity_id);
            toast('opportunity_id set — open the Saved grants tab');
          }),
          r.dismissed ? tag('dismissed') : miniButton('dismiss', async () => {
            const out = await api.post(`/api/matches/${r.id}/dismiss`);
            toast(out.ok ? 'Dismissed' : out.error, !out.ok);
            if (out.ok) reload();
          }),
        ) },
      ].filter(Boolean), rows, { empty: 'No matches. Create a goal, or wait for the nightly job.' }),
    );
  }
}
