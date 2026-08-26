// Small DOM helpers plus the two components every view is built from:
// `card()` for a single endpoint, and `table()` for a list of rows.

import { getCtx, setCtx, on } from './store.js';

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

function append(parent, children) {
  for (const c of children.flat(4)) {
    if (c === null || c === undefined || c === false) continue;
    parent.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function toast(message, bad = false) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: 'toast' + (bad ? ' bad' : ''), text: message });
  box.append(el);
  setTimeout(() => el.remove(), bad ? 5200 : 2600);
}

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (isNaN(n)) return String(value);
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Seconds as a compact duration. Handles both a 1-hour token and a fake one. */
export function fmtDuration(seconds) {
  const s = Math.abs(Math.round(seconds));
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

export function shorten(value, n = 8) {
  const s = value === null || value === undefined ? '' : String(value);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function viewHead(title, description) {
  return h('div', { class: 'view-head' }, h('h1', { text: title }), description && h('p', { text: description }));
}

export function sectionLabel(text) {
  return h('div', { class: 'section-label', text });
}

export function note(html) {
  return h('div', { class: 'note', html });
}

/* ------------------------------------------------------------------ *
 * result renderer
 * ------------------------------------------------------------------ */

function makeResult() {
  const head = h('div', { class: 'result-head' });
  const body = h('div');
  const root = h('div', { class: 'result' }, head, body);

  return {
    root,
    clear() {
      root.classList.remove('show');
      clear(head);
      clear(body);
    },
    /** Render an api.js response envelope. */
    render(res) {
      clear(head);
      clear(body);
      const ok = res.ok;
      head.append(
        h('span', { class: 'status ' + (ok ? 'ok' : 'bad'), text: res.status || 'ERR' }),
        h('span', { class: 'result-meta', text: `${res.method} ${res.path}` }),
        res.ms !== undefined && h('span', { class: 'result-meta', text: `${res.ms} ms` }),
      );
      const text = res.data === undefined || res.data === null
        ? (res.error || '(empty response)')
        : JSON.stringify(res.data, null, 2);
      body.append(h('pre', { class: 'json' + (ok ? '' : ' err'), text }));
      root.classList.add('show');
    },
    /** Render arbitrary nodes instead of raw JSON. */
    custom(...nodes) {
      clear(head);
      clear(body);
      append(body, nodes);
      root.classList.add('show');
    },
    /** Keep the status line but replace the payload area. */
    setBody(...nodes) {
      clear(body);
      append(body, nodes);
      root.classList.add('show');
    },
    message(text, bad = false) {
      clear(head);
      clear(body);
      body.append(h('pre', { class: 'json' + (bad ? ' err' : ''), text }));
      root.classList.add('show');
    },
  };
}

/* ------------------------------------------------------------------ *
 * fields
 * ------------------------------------------------------------------ */

function buildField(spec, values) {
  const id = 'f_' + Math.random().toString(36).slice(2, 9);
  const initial = spec.ctxKey ? (getCtx(spec.ctxKey) || spec.value || '') : (spec.value ?? '');

  let input;
  if (spec.type === 'textarea') {
    input = h('textarea', { id, rows: spec.rows || 3, placeholder: spec.placeholder || '' });
    input.value = initial;
  } else if (spec.type === 'select') {
    input = h('select', { id });
    for (const opt of spec.options || []) {
      const [value, label] = Array.isArray(opt) ? opt : [opt, opt];
      input.append(h('option', { value, text: label }));
    }
    input.value = initial || (spec.options?.[0] ? (Array.isArray(spec.options[0]) ? spec.options[0][0] : spec.options[0]) : '');
  } else if (spec.type === 'checkbox') {
    input = h('input', { type: 'checkbox', id });
    input.checked = !!spec.value;
  } else {
    input = h('input', { type: spec.type || 'text', id, placeholder: spec.placeholder || '' });
    input.value = initial;
  }

  const label = h('label', { for: id, html: esc(spec.label || spec.name) + (spec.required ? ' <span class="req">*</span>' : '') });

  const root = spec.type === 'checkbox'
    ? h('div', { class: 'field' + (spec.wide ? ' wide' : ''), }, h('div', { class: 'check' }, input, label))
    : h('div', { class: 'field' + (spec.wide ? ' wide' : '') }, label, input, spec.hint && h('div', { class: 'hint', text: spec.hint }));

  const get = () => (spec.type === 'checkbox' ? input.checked : input.value);

  Object.defineProperty(values, spec.name, { get, enumerable: true, configurable: true });

  if (spec.ctxKey) {
    // Two-way: typing here updates the shared context, and a change made
    // elsewhere (clicking a row, say) flows back into this input.
    input.addEventListener('change', () => setCtx(spec.ctxKey, input.value));
    const off = on('ctx', () => {
      // The input outlives its view otherwise, once the panel is swapped out.
      if (!input.isConnected) { off(); return; }
      const next = getCtx(spec.ctxKey);
      if (document.activeElement !== input && next !== input.value) input.value = next;
    });
  }

  return { root, input, spec, get, set: (v) => { input.value = v ?? ''; } };
}

/* ------------------------------------------------------------------ *
 * card
 * ------------------------------------------------------------------ */

/**
 * One endpoint, collapsed by default.
 *
 * @param {object} spec
 * @param {string} spec.method       HTTP verb, used for the badge.
 * @param {string} spec.path         Display path, e.g. /api/teams/:team_id.
 * @param {string} [spec.title]      Short human label.
 * @param {string} [spec.desc]       Longer explanation.
 * @param {boolean} [spec.open]      Start expanded.
 * @param {Array}  [spec.fields]     Field specs.
 * @param {string} [spec.action]     Label for the primary button.
 * @param {Function} [spec.run]      async (values, result, card) => void
 * @param {Array}  [spec.buttons]    Extra buttons: {label, run, primary}.
 * @param {Function} [spec.extra]    (bodyEl, {result, values, fields}) => void
 */
export function card(spec) {
  const values = {};
  const fields = (spec.fields || []).map((f) => buildField(f, values));
  const result = makeResult();

  const head = h('div', { class: 'card-head' },
    h('span', { class: 'method ' + spec.method, text: spec.method }),
    h('span', { class: 'card-path', text: spec.path }),
    spec.title && h('span', { class: 'card-title', text: '· ' + spec.title }),
    h('span', { class: 'card-caret', text: '▸' }),
  );

  const body = h('div', { class: 'card-body' });
  const root = h('div', { class: 'card' + (spec.open ? ' open' : '') }, head, body);
  const caret = head.querySelector('.card-caret');
  if (spec.open) caret.textContent = '▾';

  head.addEventListener('click', () => {
    root.classList.toggle('open');
    caret.textContent = root.classList.contains('open') ? '▾' : '▸';
  });

  if (spec.desc) body.append(h('div', { class: 'card-desc', text: spec.desc }));
  if (fields.length) body.append(h('div', { class: 'fields' }, fields.map((f) => f.root)));

  const buttons = [];
  const allButtons = [
    ...(spec.run ? [{ label: spec.action || 'Send', run: spec.run, primary: true }] : []),
    ...(spec.buttons || []),
  ];

  if (allButtons.length) {
    const row = h('div', { class: 'btn-row' });
    for (const b of allButtons) {
      const btn = h('button', { class: 'btn' + (b.primary ? '' : ' btn-ghost'), text: b.label });
      btn.addEventListener('click', async () => {
        const previous = buttons.map((x) => x.disabled);
        buttons.forEach((x) => { x.disabled = true; });
        const original = btn.textContent;
        btn.textContent = '…';
        try {
          await b.run(values, result, api);
        } catch (err) {
          result.message(String(err && err.message ? err.message : err), true);
        } finally {
          btn.textContent = original;
          buttons.forEach((x, i) => { x.disabled = previous[i]; });
        }
      });
      buttons.push(btn);
      row.append(btn);
    }
    body.append(row);
  }

  const api = {
    root, body, result, values, fields,
    field: (name) => fields.find((f) => f.spec.name === name),
    open: () => { root.classList.add('open'); caret.textContent = '▾'; },
    /** Fire a button by label, or the primary one. Used to auto-load a view. */
    trigger: (label) => {
      const btn = label ? buttons.find((b) => b.textContent === label) : buttons[0];
      btn?.click();
      return !!btn;
    },
  };

  if (spec.extra) spec.extra(body, api);
  body.append(result.root);

  root.cardApi = api;
  return root;
}

/* ------------------------------------------------------------------ *
 * table
 * ------------------------------------------------------------------ */

/**
 * @param {Array} columns  [{key, label, cls, render(row) -> Node|string}]
 * @param {Array} rows
 * @param {object} [opts]  {empty, rowClass(row)}
 */
export function table(columns, rows, opts = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return h('div', { class: 'empty', text: opts.empty || 'Nothing here.' });
  }

  const thead = h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.cls || '', text: c.label }))));
  const tbody = h('tbody');

  for (const row of rows) {
    const tr = h('tr', { class: opts.rowClass ? opts.rowClass(row) || '' : '' });
    for (const c of columns) {
      const td = h('td', { class: c.cls || '' });
      const content = c.render ? c.render(row) : row[c.key];
      if (content instanceof Node) td.append(content);
      else td.textContent = content === null || content === undefined || content === '' ? '—' : String(content);
      tr.append(td);
    }
    tbody.append(tr);
  }

  return h('div', { class: 'table-wrap' }, h('table', {}, thead, tbody));
}

export function actions(...buttons) {
  return h('div', { class: 'cell-actions' }, buttons.filter(Boolean));
}

export function miniButton(label, onClick, title) {
  const btn = h('button', { class: 'btn btn-ghost btn-tiny', text: label, title: title || label });
  btn.addEventListener('click', async () => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try { await onClick(); } finally { btn.disabled = false; btn.textContent = original; }
  });
  return btn;
}

export function tag(text, solid = false) {
  return h('span', { class: 'tag' + (solid ? ' solid' : ''), text });
}

export function stats(pairs) {
  return h('div', { class: 'stats' }, pairs.map(([label, value]) =>
    h('div', { class: 'stat' }, h('b', { text: String(value ?? 0) }), h('span', { text: label }))));
}

export function jsonBlock(data) {
  return h('pre', { class: 'json', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) });
}

/** A clickable id cell that pushes its value into the shared context. */
export function idCell(value, ctxKey, label) {
  if (value === null || value === undefined || value === '') return '—';
  const btn = h('button', {
    class: 'btn btn-ghost btn-tiny',
    text: label || String(value),
    title: `Use ${value} as the active ${ctxKey}`,
  });
  btn.addEventListener('click', () => {
    setCtx(ctxKey, value);
    toast(`${ctxKey} = ${value}`);
  });
  return btn;
}
