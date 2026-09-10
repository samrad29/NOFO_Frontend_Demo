import { h, viewHead, sectionLabel, note, card, table, tag, jsonBlock, stats, fmtMoney } from '../dom.js';
import { getCtx, getToken, on, setCtx } from '../store.js';
import * as api from '../api.js';
import { grantColumns, viewGrantButton } from './shared.js';

// Keys a real grant-detail page would need. The rest of the record is useful
// but these are the ones whose absence would make the page feel unfinished.
const NEEDED = [
  ['opportunity_title', 'title'],
  ['opportunity_number', 'opportunity number'],
  ['top_level_agency_name', 'agency'],
  ['summary_description', 'summary'],
  ['deadline', 'a deadline or close-date note'],
  ['eligibility', 'applicant types or eligibility text'],
  ['award', 'award range or program funding'],
  ['listings', 'assistance listing'],
  ['link', 'additional info URL'],
];

const GROUPS = [
  {
    title: 'Identity',
    keys: [
      'opportunity_id', 'legacy_opportunity_id', 'opportunity_number',
      'opportunity_title', 'opportunity_status', 'is_forecast', 'category', 'fiscal_year',
    ],
  },
  {
    title: 'Agency',
    keys: ['top_level_agency_name', 'top_level_agency_code', 'agency_name', 'agency_code'],
  },
  {
    title: 'Dates',
    keys: [
      'deadline_state', 'days_until_deadline', 'effective_deadline', 'is_stale', 'is_new',
      'post_date', 'close_date', 'archive_date',
      'forecasted_post_date', 'forecasted_close_date', 'forecasted_award_date',
      'forecasted_project_start_date', 'close_date_description',
      'forecasted_close_date_description',
    ],
  },
  {
    title: 'Award',
    keys: [
      'award_floor', 'award_ceiling', 'estimated_total_program_funding',
      'expected_number_of_awards', 'is_cost_sharing',
    ],
  },
  {
    title: 'Eligibility & classification',
    keys: [
      'applicant_types', 'eligibility_breadth', 'is_tribal_only',
      'funding_categories', 'funding_instruments', 'funding_category_description',
    ],
  },
  {
    title: 'Contact & links',
    keys: [
      'additional_info_url', 'additional_info_url_description',
      'agency_email_address', 'agency_contact_description',
    ],
  },
  {
    title: 'Pipeline',
    keys: [
      'ingest_source', 'eligibility_verdict', 'eligibility_reason',
      'liveness_verdict', 'liveness_reason',
      'has_embedding', 'embedded_at', 'visible_in_browse',
      'version_number', 'source_created_at', 'source_updated_at',
      'ingested_at', 'updated_at', 'last_seen_at',
    ],
  },
];

const PROSE = [
  ['summary_description', 'Summary'],
  ['applicant_eligibility_description', 'Applicant eligibility'],
  ['embedding_text', 'Text that was embedded'],
];

const MONEY = new Set(['award_floor', 'award_ceiling', 'estimated_total_program_funding']);

// Flattened from the Simpler.Grants search record — keep in sync with
// pipelines/simpler/ingestion.py normalize().
const FROM_ROOT = new Set([
  'opportunity_id', 'legacy_opportunity_id', 'opportunity_number', 'opportunity_title',
  'agency_code', 'agency_name', 'top_level_agency_code', 'top_level_agency_name',
  'opportunity_status', 'category',
]);
const FROM_SUMMARY = new Set([
  'is_forecast', 'fiscal_year',
  'post_date', 'close_date', 'archive_date',
  'forecasted_post_date', 'forecasted_close_date', 'forecasted_award_date',
  'forecasted_project_start_date', 'close_date_description',
  'forecasted_close_date_description',
  'award_floor', 'award_ceiling', 'estimated_total_program_funding',
  'expected_number_of_awards', 'is_cost_sharing',
  'applicant_types', 'funding_categories', 'funding_instruments',
  'applicant_eligibility_description', 'funding_category_description',
  'summary_description', 'additional_info_url', 'additional_info_url_description',
  'agency_contact_description', 'agency_email_address',
  'version_number', 'created_at', 'updated_at',
]);
const ROOT_IGNORED = new Set(['summary', 'opportunity_assistance_listings', 'created_at', 'updated_at', 'agency']);

function present(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function neededState(d) {
  const deadline = present(d.close_date) || present(d.forecasted_close_date)
    || present(d.close_date_description) || present(d.forecasted_close_date_description)
    || d.deadline_state === 'no_deadline' || d.deadline_state === 'dormant';
  const eligibility = present(d.applicant_types) || present(d.applicant_eligibility_description);
  const award = present(d.award_floor) || present(d.award_ceiling)
    || present(d.estimated_total_program_funding);
  const listings = (d.assistance_listings || []).length > 0;
  const checks = {
    opportunity_title: present(d.opportunity_title),
    opportunity_number: present(d.opportunity_number),
    top_level_agency_name: present(d.top_level_agency_name),
    summary_description: present(d.summary_description),
    deadline,
    eligibility,
    award,
    listings,
    link: present(d.additional_info_url),
  };
  return checks;
}

function fmtCell(key, value) {
  if (!present(value)) return h('span', { class: 'empty-val', text: '—' });
  if (Array.isArray(value)) {
    return h('span', {}, value.map((v) => tag(String(v))));
  }
  if (typeof value === 'boolean') return tag(value ? 'true' : 'false', value);
  if (MONEY.has(key)) return h('span', { class: 'mono', text: fmtMoney(value) });
  if (key === 'additional_info_url' || key === 'agency_email_address') {
    const href = key === 'agency_email_address' && !String(value).includes('://')
      ? 'mailto:' + value
      : String(value);
    return h('a', { href, target: '_blank', rel: 'noopener', text: String(value) });
  }
  return String(value);
}

function claims(entries) {
  const nodes = [];
  for (const [key, value] of entries) {
    nodes.push(h('dt', { text: key }));
    nodes.push(h('dd', {}, fmtCell(key, value)));
  }
  return h('dl', { class: 'claims wide' }, nodes);
}

function unmappedKeys(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { root: [], summary: [] };
  }
  const root = Object.keys(raw).filter((k) => !FROM_ROOT.has(k) && !ROOT_IGNORED.has(k) && present(raw[k]));
  const summary = raw.summary && typeof raw.summary === 'object'
    ? Object.keys(raw.summary).filter((k) => !FROM_SUMMARY.has(k) && present(raw.summary[k]))
    : [];
  return { root, summary };
}

function renderGrant(d, res) {
  const checks = neededState(d);
  const missing = NEEDED.filter(([key]) => !checks[key]);
  const filled = NEEDED.length - missing.length;

  const groupedKeys = new Set(GROUPS.flatMap((g) => g.keys).concat(PROSE.map(([k]) => k)));
  const extra = Object.keys(d).filter((k) => !groupedKeys.has(k) && k !== 'raw' && k !== 'assistance_listings' && k !== 'embedding_text');

  const listings = d.assistance_listings || [];
  const gaps = unmappedKeys(d.raw);

  return [
    h('div', { class: 'result-head' },
      h('span', { class: 'status ok', text: res.status }),
      h('span', { class: 'result-meta', text: `${res.ms} ms` }),
      d.deadline_state ? tag(d.deadline_state, d.deadline_state === 'open') : null,
      d.ingest_source ? tag(d.ingest_source) : null,
      d.visible_in_browse ? tag('in browse', true) : tag('hidden from browse'),
      d.is_stale ? tag('stale', true) : null,
      d.has_embedding ? tag('embedded') : tag('no embedding'),
    ),
    stats([
      ['detail fields', `${filled}/${NEEDED.length}`],
      ['listings', listings.length],
      ['raw keys unused', gaps.root.length + gaps.summary.length],
    ]),
    missing.length
      ? h('div', { class: 'note', html:
          'Empty on this record, and a detail page would notice: <code>' +
          missing.map(([, label]) => label).join('</code>, <code>') +
          '</code>.' })
      : h('div', { class: 'note', html: 'Every field a grant-detail page needs is present on this record.' }),

    ...GROUPS.map((group) => [
      h('div', { class: 'section-label', text: group.title }),
      claims(group.keys.map((k) => [k, d[k]])),
    ]).flat(),

    ...PROSE.map(([key, label]) => [
      h('div', { class: 'section-label', text: label }),
      present(d[key])
        ? h('div', { class: 'prose', text: d[key] })
        : h('div', { class: 'empty-val', text: '—' }),
    ]).flat(),

    h('div', { class: 'section-label', text: `Assistance listings (${listings.length})` }),
    table([
      { label: 'number', cls: 'mono', key: 'assistance_listing_number' },
      { label: 'program title', key: 'program_title' },
    ], listings, { empty: 'No assistance listings stored for this grant.' }),

    extra.length
      ? [
        h('div', { class: 'section-label', text: 'Other columns' }),
        claims(extra.map((k) => [k, d[k]])),
      ]
      : [],

    h('div', { class: 'section-label', text: 'Source payload vs flatten' }),
    (gaps.root.length || gaps.summary.length)
      ? h('div', { class: 'note', html:
          'Keys present on <code>raw</code> that ingestion does not copy onto the grant row. ' +
          'If any of these belong on a detail page, they need a column.' })
      : h('div', { class: 'note', html:
          'No leftover keys on <code>raw</code> — ingestion is flattening everything the source sent, aside from listings (their own table) and timestamps (stored as <code>source_created_at</code> / <code>source_updated_at</code>).' }),
    gaps.root.length
      ? h('div', {}, h('div', { class: 'result-meta', text: 'raw (top level)' }),
        h('span', {}, gaps.root.map((k) => tag(k, true))))
      : null,
    gaps.summary.length
      ? h('div', { style: 'margin-top:6px' }, h('div', { class: 'result-meta', text: 'raw.summary' }),
        h('span', {}, gaps.summary.map((k) => tag(k, true))))
      : null,

    h('div', { class: 'section-label', text: 'Raw JSON' }),
    jsonBlock(d),
  ].flat();
}

export function render(root) {
  root.append(viewHead(
    'Grant',
    'The full record for one opportunity. Use this to check that a detail page would have title, summary, dates, eligibility, listings, and a link.',
  ));

  root.append(note(
    'This reads <code>GET /api/grants/&lt;opportunity_id&gt;</code>, which returns every flattened column plus assistance listings and the original Simpler.Grants payload under <code>raw</code>. ' +
    'Closed and dormant grants are included. <b>Find similar</b> loads live neighbors of that grant (stored embedding, no model call), split into enough lead time vs closing soon.',
  ));

  root.append(sectionLabel('Load a grant'));

  let last = getCtx('opportunityId');

  const loadCard = card({
    method: 'GET',
    path: '/api/grants/:opportunity_id',
    title: 'full record, including closed grants',
    open: true,
    action: 'Load grant',
    fields: [{
      name: 'opportunity_id',
      label: 'opportunity_id',
      required: true,
      wide: true,
      ctxKey: 'opportunityId',
      placeholder: 'uuid',
    }],
    run: async (v, result) => {
      const id = v.opportunity_id.trim();
      if (!id) { result.message('opportunity_id is required.', true); return; }
      const res = await api.get(`/api/grants/${encodeURIComponent(id)}`);
      if (!res.ok) { result.render(res); return; }
      const d = res.data || {};
      if (d.opportunity_id) {
        last = String(d.opportunity_id);
        setCtx('opportunityId', d.opportunity_id);
      }
      result.custom(...renderGrant(d, res));
    },
  });
  root.append(loadCard);

  root.append(sectionLabel('Find similar'));

  const similarCard = card({
    method: 'GET',
    path: '/api/grants/:opportunity_id/similar',
    title: 'live neighbors, split by lead time',
    desc: 'Uses the stored embedding — no model call. Neighbors are live even if this grant has closed. Closing-soon is a second list, not a filter. Pass team_id to use that workspace’s lead time; otherwise min_days_to_deadline defaults to 30.',
    open: true,
    action: 'Find similar',
    fields: [
      {
        name: 'opportunity_id',
        label: 'opportunity_id',
        required: true,
        wide: true,
        ctxKey: 'opportunityId',
        placeholder: 'uuid',
      },
      { name: 'team_id', label: 'team_id', type: 'number', ctxKey: 'teamId', hint: 'Optional. Uses the team’s min_days_to_deadline when set.' },
      { name: 'min_days_to_deadline', label: 'min_days_to_deadline', type: 'number', value: 30 },
      { name: 'limit', label: 'limit', type: 'number', value: 20 },
    ],
    run: async (v, result) => {
      const id = v.opportunity_id.trim();
      if (!id) { result.message('opportunity_id is required.', true); return; }

      const query = {};
      if (v.limit !== '') query.limit = v.limit;
      if (v.team_id !== '') query.team_id = v.team_id;
      else if (v.min_days_to_deadline !== '') query.min_days_to_deadline = v.min_days_to_deadline;

      const res = await api.get(`/api/grants/${encodeURIComponent(id)}/similar`, query);
      if (!res.ok) { result.render(res); return; }

      const d = res.data || {};
      const similar = d.similar || [];
      const closing = d.closing_soon || [];

      const simCol = {
        label: 'similarity',
        cls: 'mono',
        render: (r) => (r.similarity == null ? '—' : Number(r.similarity).toFixed(3)),
      };

      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${res.ms} ms` }),
          h('span', { class: 'result-meta', text: `lead time ${d.lead_time_days ?? '—'}d` }),
          d.team_id ? tag(`team ${d.team_id}`) : null),
        stats([
          ['similar', similar.length],
          ['closing soon', closing.length],
        ]),
        h('div', { class: 'section-label', text: 'Similar' }),
        table([
          simCol,
          ...grantColumns(),
          { label: '', render: viewGrantButton },
        ], similar, { empty: 'No live neighbors above the similarity floor with enough lead time.' }),
        h('div', { class: 'section-label', text: 'Closing soon' }),
        table([
          simCol,
          ...grantColumns(),
          { label: '', render: viewGrantButton },
        ], closing, { empty: 'None of the neighbors close sooner than the lead time.' }),
      );
    },
  });
  root.append(similarCard);

  if (getToken() && last) {
    requestAnimationFrame(() => {
      loadCard.cardApi.trigger();
      similarCard.cardApi.trigger();
    });
  }

  const off = on('ctx', () => {
    if (!root.isConnected) { off(); return; }
    const id = getCtx('opportunityId');
    if (id === last) return;
    last = id;
    if (id && getToken()) {
      loadCard.cardApi.trigger();
      similarCard.cardApi.trigger();
    }
  });
  root.addEventListener('view:teardown', off);
}
