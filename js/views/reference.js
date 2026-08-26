import { h, viewHead, sectionLabel, card, table, tag } from '../dom.js';
import * as api from '../api.js';

export function render(root) {
  root.append(viewHead(
    'Reference data',
    'The lookup tables the rest of the app builds on. Both routes require a token.',
  ));

  root.append(sectionLabel('Funding categories'));

  root.append(card({
    method: 'GET',
    path: '/api/categories',
    title: 'funding areas with live grant counts',
    desc: 'These category slugs are what a team subscribes to. Copy one into the team editor to change what a workspace sees.',
    open: true,
    action: 'Load categories',
    run: async (_v, result) => {
      const res = await api.get('/api/categories');
      if (!res.ok) { result.render(res); return; }
      const rows = res.data || [];
      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${rows.length} categories · ${res.ms} ms` })),
        table([
          { label: 'category', cls: 'mono', key: 'category' },
          { label: 'label', key: 'label' },
          { label: 'grants', cls: 'num', render: (r) => Number(r.grant_count ?? 0).toLocaleString() },
          { label: 'sort', cls: 'num', key: 'sort_order' },
        ], rows, { empty: 'No categories returned.' }),
      );
    },
  }));

  root.append(sectionLabel('Organizations'));

  root.append(card({
    method: 'GET',
    path: '/api/organizations?q=',
    title: 'type-ahead over recognised entities',
    desc: 'Fewer than two characters returns an empty array rather than an error. Capped at twenty results.',
    action: 'Search',
    fields: [{ name: 'q', label: 'q', placeholder: 'nav' }],
    run: async (v, result) => {
      const res = await api.get('/api/organizations', { q: v.q.trim() });
      if (!res.ok) { result.render(res); return; }
      const rows = res.data || [];
      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${rows.length} match(es) · ${res.ms} ms` }),
          v.q.trim().length < 2 && tag('query under 2 chars')),
        table([
          { label: 'org_id', cls: 'mono', key: 'org_id' },
          { label: 'name', key: 'name' },
          { label: 'kind', render: (r) => tag(r.kind || '—') },
          { label: 'region', key: 'region' },
          { label: 'also known as', render: (r) => h('span', { class: 'clip', text: r.also_known_as || '—' }) },
        ], rows, { empty: 'No organisations matched.' }),
      );
    },
  }));
}
