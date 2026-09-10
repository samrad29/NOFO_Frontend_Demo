import { h, viewHead, sectionLabel, note, card, table, tag, toast, miniButton, stats } from '../dom.js';
import { setCtx } from '../store.js';
import * as api from '../api.js';
import { grantColumns, viewGrantButton } from './shared.js';

const EXAMPLES = [
  ['tribal broadband', 'hybrid: full-text plus embedding'],
  ['broadband', 'one word: full-text only'],
  ['HRSA-27-021', 'opportunity number'],
  ['14.867', 'assistance listing'],
  ['362729', 'Grants.gov legacy id'],
];

function fmtScore(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isNaN(n) ? String(value) : n.toFixed(3);
}

function routeTags(row) {
  const routes = row.routes || [];
  if (!routes.length) return '—';
  return h('span', {}, routes.map((r) => tag(r, r === 'exact')));
}

function scoreCell(row) {
  return h('div', {},
    h('div', { class: 'mono', text: fmtScore(row.score) }),
    row.semantic_score !== null && row.semantic_score !== undefined
      ? h('div', { class: 'result-meta', text: 'sem ' + fmtScore(row.semantic_score) })
      : null,
  );
}

export function render(root) {
  root.append(viewHead(
    'Search',
    'Corpus-wide grant search. The backend classifies the query, then routes it to an exact lookup or hybrid retrieval.',
  ));

  root.append(note(
    'An opportunity number (<code>HRSA-27-021</code>), assistance listing (<code>14.867</code>), or Grants.gov ' +
    'legacy id (<code>362729</code>) is an exact match — closed grants are included and flagged <code>is_stale</code>. ' +
    'Anything else is hybrid: title-weighted full-text first, then (for two or more words) a semantic neighbor search. ' +
    'One-word queries skip embeddings. This is not scoped to a team’s categories.',
  ));

  root.append(sectionLabel('Find grants'));

  const searchCard = card({
    method: 'GET',
    path: '/api/grants/search',
    title: 'identifier, keywords, or a natural-language need',
    open: true,
    action: 'Search',
    fields: [
      {
        name: 'q',
        label: 'q',
        required: true,
        wide: true,
        placeholder: 'tribal broadband',
        hint: 'Required. Limit is clamped to 1–50 on the server (default 20). Multi-word text search needs OPENROUTER_EMBEDDING_KEY.',
      },
      { name: 'limit', label: 'limit', type: 'number', value: 20 },
    ],
    extra: (body, apiCard) => {
      const qInput = apiCard.field('q')?.input;
      if (qInput) {
        qInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apiCard.trigger();
          }
        });
      }

      body.append(h('div', { class: 'btn-row' },
        h('span', { class: 'result-meta', text: 'try' }),
        ...EXAMPLES.map(([q, title]) => miniButton(q, () => {
          apiCard.field('q').set(q);
          apiCard.trigger();
        }, title)),
      ));
    },
    run: async (v, result) => {
      const q = v.q.trim();
      if (!q) { result.message('q is required.', true); return; }

      const query = { q };
      if (v.limit !== '') query.limit = v.limit;

      const res = await api.get('/api/grants/search', query);
      if (!res.ok) { result.render(res); return; }

      const d = res.data || {};
      const rows = (d.results || []).map((r, i) => ({ ...r, _rank: i + 1 }));
      const kind = d.kind || '—';
      const fulltext = rows.filter((r) => (r.routes || []).includes('fulltext')).length;
      const semantic = rows.filter((r) => (r.routes || []).includes('semantic')).length;
      const exact = rows.filter((r) => (r.routes || []).includes('exact')).length;
      const stale = rows.filter((r) => r.is_stale).length;
      const titled = rows.filter((r) => r.title_match).length;

      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${rows.length} result(s) · ${res.ms} ms` }),
          tag(kind, kind !== 'text'),
          d.query ? h('span', { class: 'result-meta', text: `q = ${d.query}` }) : null),
        stats([
          ['results', rows.length],
          ['full-text', fulltext],
          ['semantic', semantic],
          ['exact', exact],
          ['title hit', titled],
          ['stale', stale],
        ]),
        table([
          { label: '#', cls: 'num', key: '_rank' },
          { label: 'routes', render: routeTags },
          { label: 'score', cls: 'mono', render: scoreCell },
          {
            label: 'flags',
            render: (r) => h('span', {},
              r.title_match ? tag('title', true) : null,
              r.is_stale ? tag('stale', true) : null,
              r.ingest_source ? tag(r.ingest_source) : null,
              !r.title_match && !r.is_stale && !r.ingest_source ? '—' : null,
            ),
          },
          ...grantColumns(),
          {
            label: '',
            render: (r) => h('div', { class: 'cell-actions' },
              viewGrantButton(r),
              miniButton('save', () => {
                setCtx('opportunityId', r.opportunity_id);
                toast('opportunity_id set — open the Saved grants tab');
              }),
            ),
          },
        ], rows, { empty: 'No grants matched this query.' }),
      );
    },
  });
  root.append(searchCard);
}
