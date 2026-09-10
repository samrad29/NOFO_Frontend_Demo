// Shell: nav, top-bar status, request log, and the hash router.

import { h, clear, toast, fmtDate, fmtDuration, jsonBlock } from './dom.js';
import {
  getConfig, getSession, getCtx, clearCtx, secondsLeft, isExpired,
  getLog, clearLog, on,
} from './store.js';
import * as auth from './auth.js';
import * as api from './api.js';

import * as setupView from './views/setup.js';
import * as authView from './views/auth.js';
import * as accountView from './views/account.js';
import * as referenceView from './views/reference.js';
import * as teamsView from './views/teams.js';
import * as membersView from './views/members.js';
import * as goalsView from './views/goals.js';
import * as searchView from './views/search.js';
import * as grantView from './views/grant.js';
import * as matchesView from './views/matches.js';
import * as savedView from './views/saved.js';
import * as notificationsView from './views/notifications.js';
import * as rawView from './views/raw.js';

const VIEWS = {
  setup: setupView,
  auth: authView,
  account: accountView,
  reference: referenceView,
  teams: teamsView,
  members: membersView,
  goals: goalsView,
  search: searchView,
  grant: grantView,
  matches: matchesView,
  saved: savedView,
  notifications: notificationsView,
  raw: rawView,
};

const main = document.getElementById('main');
const navItems = [...document.querySelectorAll('.nav-item')];

/* ---------------- router ---------------- */

let current = null;
let container = null;

function show(name) {
  const view = VIEWS[name] ? name : 'setup';

  if (current === view) return;
  current = view;

  // Each view gets its own container, so anything it subscribed to can be
  // unwound by listening for view:teardown on the element it was handed.
  if (container) container.dispatchEvent(new CustomEvent('view:teardown'));
  clear(main);
  main.scrollTop = 0;
  container = h('div');
  main.append(container);

  for (const item of navItems) {
    item.classList.toggle('active', item.dataset.view === view);
  }

  try {
    VIEWS[view].render(container);
  } catch (err) {
    console.error(err);
    container.append(
      h('div', { class: 'view-head' }, h('h1', { text: 'This panel failed to render' })),
      jsonBlock(String(err && err.stack ? err.stack : err)),
    );
  }
}

function routeFromHash() {
  show((location.hash || '#setup').slice(1));
}

for (const item of navItems) {
  item.addEventListener('click', () => { location.hash = '#' + item.dataset.view; });
}
window.addEventListener('hashchange', routeFromHash);

/* ---------------- top bar: session ---------------- */

const sessionEmail = document.getElementById('session-email');
const sessionExp = document.getElementById('session-exp');

function paintSession() {
  const s = getSession();
  if (!s) {
    sessionEmail.textContent = 'signed out';
    sessionExp.textContent = 'no bearer token';
    return;
  }
  sessionEmail.textContent = s.user?.email || s.user?.id || 'token loaded';
  const left = secondsLeft();
  if (left === null) sessionExp.textContent = 'no expiry known';
  else if (left <= 0) sessionExp.textContent = 'token expired';
  else sessionExp.textContent = 'expires in ' + fmtDuration(left);
}

on('session', paintSession);
paintSession();
setInterval(paintSession, 1000);

document.getElementById('btn-refresh-token').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const res = await auth.refreshSession();
  btn.disabled = false;
  toast(res.ok ? 'Token refreshed' : 'Refresh failed: ' + res.error, !res.ok);
});

document.getElementById('btn-signout').addEventListener('click', async () => {
  await auth.signOut();
  toast('Signed out');
});

/* ---------------- top bar: health ---------------- */

const healthDot = document.getElementById('health-dot');
const healthText = document.getElementById('health-text');
const apiBasePill = document.getElementById('api-base-pill');

function paintApiBase() {
  apiBasePill.textContent = getConfig().apiBase || '(no base URL set)';
}
on('config', paintApiBase);
paintApiBase();

async function checkHealth(quiet = false) {
  healthText.textContent = 'checking…';
  healthDot.className = 'dot';
  const res = await api.health();
  if (res.ok) {
    healthDot.className = 'dot up';
    healthText.textContent = `backend up · ${res.ms} ms`;
  } else {
    healthDot.className = 'dot down';
    healthText.textContent = res.status ? `backend ${res.status}` : 'backend unreachable';
    if (!quiet) toast(res.error || 'Backend unreachable', true);
  }
}

document.getElementById('health-pill').addEventListener('click', () => checkHealth());

/* ---------------- context strip ---------------- */

const ctxNodes = {
  teamId: document.getElementById('ctx-team'),
  goalId: document.getElementById('ctx-goal'),
  savedId: document.getElementById('ctx-saved'),
  opportunityId: document.getElementById('ctx-opp'),
};

function paintCtx() {
  for (const [key, node] of Object.entries(ctxNodes)) {
    const value = getCtx(key);
    node.textContent = value === '' ? '—' : String(value);
    node.title = value === '' ? '' : String(value);
  }
}
on('ctx', paintCtx);
paintCtx();

document.getElementById('btn-clear-ctx').addEventListener('click', () => {
  clearCtx();
  toast('Context cleared');
});

/* ---------------- request log ---------------- */

const shell = document.querySelector('.shell');
const logBody = document.getElementById('log-body');

const LOG_OPEN_KEY = 'nofo_test_ui.logOpen';
if (localStorage.getItem(LOG_OPEN_KEY) !== 'false') shell.classList.add('log-open');

document.getElementById('btn-toggle-log').addEventListener('click', () => {
  shell.classList.toggle('log-open');
  localStorage.setItem(LOG_OPEN_KEY, String(shell.classList.contains('log-open')));
});

document.getElementById('btn-clear-log').addEventListener('click', () => clearLog());

function paintLog() {
  const entries = getLog();
  clear(logBody);

  if (entries.length === 0) {
    logBody.append(h('div', { class: 'empty', text: 'No requests yet.' }));
    return;
  }

  for (const entry of entries) {
    const head = h('div', { class: 'log-entry-head' },
      h('span', { class: 'log-code' + (entry.ok ? '' : ' bad'), text: entry.status || 'ERR' }),
      h('span', { class: 'log-m', text: entry.method }),
      h('span', { class: 'log-p', title: entry.path, text: entry.path }),
      h('span', { class: 'log-ms', text: `${entry.ms}ms` }),
    );

    const body = h('div', { class: 'log-entry-body' },
      h('div', { class: 'log-sub', text: fmtDate(entry.at) }),
      entry.request !== undefined && entry.request !== null
        ? h('div', {}, h('div', { class: 'log-sub', text: 'request' }), jsonBlock(entry.request))
        : null,
      h('div', { class: 'log-sub', text: 'response' }),
      jsonBlock(entry.response ?? '(empty)'),
    );

    const wrap = h('div', { class: 'log-entry' }, head, body);
    head.addEventListener('click', () => wrap.classList.toggle('open'));
    logBody.append(wrap);
  }
}

on('log', paintLog);
paintLog();

/* ---------------- boot ---------------- */

routeFromHash();
checkHealth(true);

if (isExpired() && getSession()?.refresh_token) {
  auth.refreshSession().then((res) => {
    if (res.ok) toast('Access token was stale — refreshed');
  });
}

if (!getConfig().anonKey && !getSession()) {
  toast('Add your Supabase anon key on the Setup tab to sign in');
}
