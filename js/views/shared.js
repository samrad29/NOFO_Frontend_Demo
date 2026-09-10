// Grant rows come back from several routes (team grants, goal matches, saved
// grants) with the same joined columns, so they render the same way.

import { h, tag, fmtMoney, idCell, shorten, miniButton } from '../dom.js';
import { setCtx } from '../store.js';

export function deadlineCell(row) {
  const state = row.deadline_state || '—';
  const days = row.days_until_deadline;
  const parts = [tag(state, state === 'open')];
  if (days !== null && days !== undefined) {
    parts.push(h('span', { class: 'result-meta', style: 'margin-left:5px', text: `${days}d` }));
  }
  return h('span', {}, parts);
}

export function awardCell(row) {
  const floor = row.award_floor;
  const ceiling = row.award_ceiling;
  if (!floor && !ceiling) return '—';
  if (floor && ceiling) return `${fmtMoney(floor)} – ${fmtMoney(ceiling)}`;
  return fmtMoney(ceiling || floor);
}

/** The columns shared by every grant-shaped row. */
export function grantColumns() {
  return [
    {
      label: 'opportunity',
      render: (r) => h('div', {},
        h('div', { class: 'clip', title: r.opportunity_title || '', text: r.opportunity_title || '—' }),
        h('div', { class: 'result-meta', style: 'font-family:var(--mono);font-size:10.5px',
          text: [r.opportunity_number, r.top_level_agency_name].filter(Boolean).join(' · ') || '—' }),
      ),
    },
    { label: 'deadline', render: deadlineCell },
    { label: 'award', cls: 'mono', render: awardCell },
    {
      label: 'eligibility',
      render: (r) => h('span', {},
        r.eligibility_verdict ? tag(r.eligibility_verdict) : '—',
        r.is_tribal_only ? tag('tribal only') : null,
        r.is_cost_sharing ? tag('cost share') : null,
      ),
    },
    {
      label: 'opportunity_id',
      cls: 'mono',
      render: (r) => idCell(r.opportunity_id, 'opportunityId', shorten(r.opportunity_id, 8)),
    },
  ];
}

export function verdictCell(row) {
  const v = row.verdict;
  return h('span', {},
    v ? tag(v, v === 'strong') : '—',
    row.similarity !== null && row.similarity !== undefined
      ? h('span', { class: 'result-meta', style: 'margin-left:5px;font-family:var(--mono)',
        text: Number(row.similarity).toFixed(3) })
      : null,
  );
}

/** Open the Grant tab on this opportunity. Reloads if that tab is already showing. */
export function openGrant(opportunityId) {
  if (!opportunityId) return;
  setCtx('opportunityId', opportunityId);
  if ((location.hash || '').slice(1) !== 'grant') location.hash = '#grant';
}

export function viewGrantButton(row) {
  return miniButton('view', () => openGrant(row.opportunity_id));
}

/** Category slugs are sent as an array but are far easier to type as a list. */
export function parseList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
