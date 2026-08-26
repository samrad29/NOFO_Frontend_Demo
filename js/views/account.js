import { h, viewHead, sectionLabel, note, card, table, toast, jsonBlock } from '../dom.js';
import * as api from '../api.js';

export function render(root) {
  root.append(viewHead(
    'Me & profile',
    'Identity comes from the token; everything else about a user lives in the profiles table.',
  ));

  root.append(note(
    'A brand new user has no profile row, and <code>GET /api/me</code> answers ' +
    '<code>{ user_id, profile: null }</code>. Once you save a profile the same route returns the fields ' +
    'flattened onto the top level — worth knowing, since the two shapes differ.',
  ));

  root.append(sectionLabel('Read'));

  root.append(card({
    method: 'GET',
    path: '/api/me',
    title: 'current user',
    open: true,
    action: 'Load',
    run: async (_v, result) => {
      const res = await api.get('/api/me');
      if (!res.ok) { result.render(res); return; }
      const d = res.data || {};
      const hasProfile = d.profile !== null && d.display_name !== undefined;
      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `GET /api/me · ${res.ms} ms` }),
          h('span', { class: 'tag' + (hasProfile ? ' solid' : ''), text: hasProfile ? 'profile exists' : 'no profile yet' })),
        h('dl', { class: 'claims' },
          h('dt', { text: 'user_id' }), h('dd', { text: d.user_id || '—' }),
          h('dt', { text: 'display_name' }), h('dd', { text: d.display_name ?? '—' }),
          h('dt', { text: 'title' }), h('dd', { text: d.title ?? '—' }),
          h('dt', { text: 'email' }), h('dd', { text: d.email ?? '—' }),
          h('dt', { text: 'org_id' }), h('dd', { text: d.org_id ?? '—' }),
          h('dt', { text: 'org_name' }), h('dd', { text: d.org_name ?? '—' }),
          h('dt', { text: 'org_other' }), h('dd', { text: d.org_other ?? '—' }),
          h('dt', { text: 'kind' }), h('dd', { text: d.kind ?? '—' }),
        ),
        h('div', { class: 'section-label', text: 'Raw' }),
        jsonBlock(d),
      );
    },
  }));

  root.append(sectionLabel('Write'));

  const profileCard = card({
    method: 'POST',
    path: '/api/profile',
    title: 'create or update your profile',
    desc: 'Upsert. Only display_name is required; send org_id for a recognised organisation or org_other for a free-text one.',
    open: true,
    action: 'Save profile',
    fields: [
      { name: 'display_name', label: 'display_name', required: true, placeholder: 'Sam Ramirez' },
      { name: 'title', label: 'title', placeholder: 'Grants Manager' },
      { name: 'email', label: 'email', type: 'email' },
      { name: 'org_id', label: 'org_id', type: 'number', hint: 'Search below to find one.' },
      { name: 'org_other', label: 'org_other', wide: true, hint: 'Free text, when the organisation is not in the list.' },
    ],
    buttons: [{
      label: 'Prefill from /api/me',
      run: async (_v, result, cardApi) => {
        const res = await api.get('/api/me');
        if (!res.ok) { result.render(res); return; }
        const d = res.data || {};
        for (const key of ['display_name', 'title', 'email', 'org_id', 'org_other']) {
          cardApi.field(key)?.set(d[key] ?? '');
        }
        result.message('Prefilled from the current profile.');
      },
    }],
    run: async (v, result) => {
      if (!v.display_name.trim()) { result.message('display_name is required.', true); return; }
      const body = { display_name: v.display_name.trim() };
      if (v.title.trim()) body.title = v.title.trim();
      if (v.email.trim()) body.email = v.email.trim();
      if (v.org_id !== '') body.org_id = Number(v.org_id);
      if (v.org_other.trim()) body.org_other = v.org_other.trim();
      const res = await api.post('/api/profile', body);
      result.render(res);
      if (res.ok) toast('Profile saved');
    },
  });

  root.append(profileCard);

  root.append(card({
    method: 'GET',
    path: '/api/organizations?q=',
    title: 'find an org_id',
    desc: 'Type-ahead over recognised organisations. Needs at least two characters; returns at most twenty.',
    fields: [{ name: 'q', label: 'q', placeholder: 'chey', hint: 'Two characters minimum, or the API returns [].' }],
    action: 'Search',
    run: async (v, result) => {
      const res = await api.get('/api/organizations', { q: v.q.trim() });
      if (!res.ok) { result.render(res); return; }
      const rows = res.data || [];
      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${rows.length} match(es) · ${res.ms} ms` })),
        table([
          { label: 'org_id', cls: 'mono', render: (r) => String(r.org_id) },
          { label: 'name', key: 'name' },
          { label: 'kind', render: (r) => h('span', { class: 'tag', text: r.kind || '—' }) },
          { label: 'region', key: 'region' },
          { label: '', render: (r) => {
            const btn = h('button', { class: 'btn btn-ghost btn-tiny', text: 'use' });
            btn.addEventListener('click', () => {
              profileCard.cardApi.field('org_id').set(r.org_id);
              profileCard.cardApi.open();
              toast(`org_id = ${r.org_id}`);
            });
            return btn;
          } },
        ], rows, { empty: 'No organisations matched.' }),
      );
    },
  }));
}
