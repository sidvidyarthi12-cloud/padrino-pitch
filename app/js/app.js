// Shell: router, nav, header menu, theme. Screens live in ./screens/.

import { APP_NAME, getPlan, hasPlan, subscribe, loadDemo, startOver } from './store.js';
import * as bankMod from './bank.js';
import { getTemplate } from './data.js';
import { summary } from './calc.js';
import { icon, toast, confirmSheet } from './ui.js';
import { esc, money, num, plural } from './format.js';

import * as setup from './screens/setup.js';
import * as home from './screens/home.js';
import * as budget from './screens/budget.js';
import * as quotes from './screens/quotes.js';
import * as payments from './screens/payments.js';
import * as family from './screens/family.js';
import * as fixer from './screens/fixer.js';
import * as findMoney from './screens/find-money.js';
import * as add from './screens/add.js';
import * as chat from './screens/chat.js';
import * as pathScreen from './screens/path.js';
import * as stepScreen from './screens/step.js';
import { celebrate } from './screens/celebrate.js';

// Screens other builders are still writing load the first time someone opens them. If the
// file is not there yet, the couple sees a calm "coming soon" note instead of a broken page.
function lazy(file, title) {
  let loading = null;
  const wrap = {
    loaded: null,
    get selfUpdating() { return Boolean(wrap.loaded && wrap.loaded.selfUpdating); },
    async render(root, params) {
      if (!loading) loading = import(file).then((m) => { wrap.loaded = m; return m; });
      let m = null;
      try { m = await loading; } catch (e) { loading = null; console.warn(`${file} is not ready yet`, e); }
      if (!m || typeof m.render !== 'function') {
        root.innerHTML = `
          <header class="screen-head"><h1>${esc(title)}</h1></header>
          <div class="empty"><h2>Coming soon</h2><p>This part is still being built. Everything else works in the meantime.</p>
          <a class="btn secondary mt" href="#/home">Back to Today</a></div>`;
        return;
      }
      return m.render(root, params);
    }
  };
  return wrap;
}

const vendorsScreen = lazy('./screens/vendors.js', 'Vendors');

// nav: true shows in the bottom bar, 'more' is sidebar only, false is reachable by link only.
// The path is home. The conversation is one tap away. The plus flow lives on in the composer
// and as a route other screens link to. A ':id' segment is handed to the screen as params.id.
const HOME = '/path';
const routes = {
  '/setup': { mod: setup, title: 'Setup', nav: false },
  '/path': { mod: pathScreen, title: 'Path', icon: 'path', nav: true },
  '/step/:id': { mod: stepScreen, title: 'Step', nav: false, under: '/path' },
  '/talk': { mod: chat, title: 'Padrino', icon: 'chat', nav: true },
  '/home': { mod: home, title: 'Plan', icon: 'home', nav: 'more' },
  '/payments': { mod: payments, title: 'Payments', icon: 'payments', nav: true },
  '/family': { mod: family, title: 'Family', icon: 'family', nav: true },
  '/vendors': { mod: vendorsScreen, title: 'Vendors', icon: 'store', nav: true },
  '/vendors/:id': { mod: vendorsScreen, title: 'Vendor', nav: false, under: '/vendors' },
  '/thread/:id': { mod: lazy('./screens/thread.js', 'Messages'), title: 'Messages', nav: false, under: '/vendors' },
  '/budget': { mod: budget, title: 'Budget', icon: 'budget', nav: 'more' },
  '/add': { mod: add, title: 'What happened?', icon: 'plus', nav: false },
  '/quotes': { mod: quotes, title: 'Quotes', icon: 'quote', nav: 'more' },
  '/contract': { mod: lazy('./screens/contract.js', 'Contract check'), title: 'Contract check', icon: 'contract', nav: 'more' },
  '/fixer': { mod: fixer, title: 'Fixer', icon: 'fixer', nav: 'more' },
  '/find-money': { mod: findMoney, title: 'Find money', icon: 'find', nav: 'more' },
  '/after': { mod: lazy('./screens/after.js', 'After the wedding'), title: 'After the wedding', icon: 'rings', nav: 'more' },
  '/style': { mod: lazy('./screens/style.js', 'Wedding style'), title: 'Wedding style', icon: 'star', nav: 'more' }
};

// Finds the route for a path. '/vendors/abc' matches '/vendors/:id' with params { id: 'abc' }.
function resolve(path) {
  if (routes[path]) return { key: path, route: routes[path], params: {} };
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 2) {
    const key = `/${parts[0]}/:id`;
    if (routes[key]) {
      let id = parts[1];
      try { id = decodeURIComponent(id); } catch { /* keep as is */ }
      return { key, route: routes[key], params: { id } };
    }
  }
  return null;
}

const screenEl = document.getElementById('screen');
const navEl = document.getElementById('nav');
const demoTag = document.getElementById('demo-tag');
const menuBtn = document.getElementById('menu-btn');
const menuEl = document.getElementById('menu');
const themeBtn = document.getElementById('theme-btn');
document.getElementById('brand-name').textContent = APP_NAME;

let current = null;
let cleanup = null;

export function navigate(path) {
  if (location.hash !== '#' + path) location.hash = '#' + path;
  else render();
}

function currentPath() {
  const raw = (location.hash || '').replace(/^#/, '');
  const path = raw.split('?')[0] || '';
  return path.startsWith('/') ? path : '/' + path;
}

function buildNav() {
  const path = currentPath();
  const hit = resolve(path);
  // A vendor page or a thread lights up Vendors in the sidebar.
  const active = hit ? (hit.route.under || hit.key) : path;
  navEl.hidden = !hasPlan();
  const items = Object.entries(routes).filter(([, r]) => r.nav);
  navEl.innerHTML = `<ul>${items.map(([p, r]) => {
    return `<li><a href="#${p}" class="${r.nav === 'more' ? 'more-only' : ''}" ${active === p ? 'aria-current="page"' : ''}>
      ${icon(r.icon)}<span>${esc(r.title)}</span></a></li>`;
  }).join('')}</ul>`;
  document.body.classList.toggle('on-add', path === '/add');
  document.body.classList.toggle('on-talk', path === '/talk');
  document.body.classList.toggle('on-path', path === '/path');
  document.body.classList.toggle('on-step', path.startsWith('/step/'));
}

// When a step opened another screen, a small bar offers the way back to it.
const RESUME_KEY = 'padrino.step.resume';
const resumeEl = document.getElementById('resume');
function paintResume(path) {
  if (!resumeEl) return;
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null'); } catch { r = null; }
  const show = r && r.nodeId && !path.startsWith('/step/') && path !== '/path' && path !== '/setup';
  resumeEl.hidden = !show;
  if (!show) { resumeEl.innerHTML = ''; return; }
  resumeEl.innerHTML = `${icon('path')}<span>Your step: ${esc(r.title || 'the path')}</span><a href="#/step/${encodeURIComponent(r.nodeId)}">Back to it ${icon('arrow')}</a>`;
}

// A brand new plan (setup just finished, or the demo loaded) lands on the path,
// even when the screen that made it points at the old home.
let landOnPath = false;

async function render() {
  let path = currentPath();
  let hit = resolve(path);
  if (!hit) { path = hasPlan() ? HOME : '/setup'; hit = resolve(path); }
  if (!hasPlan() && path !== '/setup') { path = '/setup'; hit = resolve(path); }
  if (landOnPath && hasPlan() && path !== '/setup') { landOnPath = false; if (path === '/home' || path === '/talk') { path = HOME; hit = resolve(path); } }
  // Only rewrite the hash when the path itself changed; a query like ?kind=payment stays for the screen to read.
  if (currentPath() !== path) { location.replace('#' + path); }

  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  current = hit.key;
  buildNav();
  paintResume(path);
  document.title = `${hit.route.title} | ${APP_NAME}`;
  screenEl.innerHTML = '';
  screenEl.scrollTop = 0;
  window.scrollTo({ top: 0 });
  try {
    const result = await hit.route.mod.render(screenEl, { plan: getPlan(), navigate, ...hit.params });
    if (typeof result === 'function') cleanup = result;
  } catch (e) {
    console.error(e);
    screenEl.innerHTML = `<div class="card bad"><h2>Something went wrong on this screen</h2>
      <p class="muted mt-s">${esc(e.message || String(e))}</p>
      <p class="tiny mt-s">If a data file or the money module is missing, the other build step may not be done yet.</p></div>`;
  }
}

function refreshChrome() {
  demoTag.hidden = !(getPlan() && getPlan().demo);
}

// Header menu

function buildMenu() {
  const p = getPlan();
  menuEl.innerHTML = `
    <button type="button" role="menuitem" data-act="demo">Load demo couple</button>
    ${p ? `<a href="#/home" role="menuitem">Plan, today's view</a>` : ''}
    ${p ? `<a href="#/setup" role="menuitem">Names, date and what matters</a>` : ''}
    ${p ? `<a href="#/add" role="menuitem">Add something by hand</a>` : ''}
    ${p ? `<a href="#/budget" role="menuitem">Budget</a>` : ''}
    ${p ? `<a href="#/quotes" role="menuitem">Quotes</a>` : ''}
    ${p ? `<a href="#/contract" role="menuitem">Contract check</a>` : ''}
    ${p ? `<a href="#/fixer" role="menuitem">Fixer</a>` : ''}
    ${p ? `<a href="#/find-money" role="menuitem">Find money</a>` : ''}
    ${p ? `<a href="#/style" role="menuitem">Wedding style</a>` : ''}
    ${p ? `<a href="#/after" role="menuitem">After the wedding</a>` : ''}
    <a href="board.html" role="menuitem">Draft board</a>
    <div class="menu-sep"></div>
    <button type="button" role="menuitem" class="danger" data-act="reset">Start over</button>`;
}

function openMenu() {
  buildMenu();
  menuEl.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
  const first = menuEl.querySelector('button, a');
  if (first) first.focus();
}

function closeMenu() {
  menuEl.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}

menuBtn.innerHTML = icon('menu');
menuBtn.addEventListener('click', () => (menuEl.hidden ? openMenu() : closeMenu()));
document.addEventListener('click', (e) => {
  if (!menuEl.hidden && !menuEl.contains(e.target) && e.target !== menuBtn && !menuBtn.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menuEl.hidden) { closeMenu(); menuBtn.focus(); } });
menuEl.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (e.target.closest('a')) { closeMenu(); return; }
  if (!act) return;
  closeMenu();
  if (act === 'demo') await doLoadDemo();
  if (act === 'reset') await doStartOver();
});

export async function doLoadDemo() {
  try {
    await loadDemo();
    toast('Demo couple loaded');
    navigate(HOME);
  } catch (e) {
    console.error(e);
    toast('Could not load the demo file');
  }
}

export async function doStartOver() {
  const ok = await confirmSheet({
    title: 'Start over?',
    body: 'This clears the plan on this phone. The demo couple can be loaded again any time.',
    confirmLabel: 'Start over', danger: true
  });
  if (!ok) return;
  startOver();
  toast('Cleared');
  navigate('/setup');
}

// Theme: follows the system unless the couple picks one. Light tends to project better.

const THEME_KEY = 'padrino.theme';
function applyTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  themeBtn.innerHTML = icon(dark ? 'sun' : 'moon');
  themeBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}
themeBtn.addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  try { localStorage.setItem(THEME_KEY, dark ? 'light' : 'dark'); } catch { /* ignore */ }
  applyTheme();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();

// Celebration: fires once, when the plan goes from over budget to covered.
// It watches every plan change and works out what closed the gap from the difference.

let template = [];
let lastPlan = null;
let lastOverBy = null;

function overByOf(plan) {
  if (!plan) return null;
  try { return Number(summary(plan, template).overBy) || 0; } catch { return null; }
}

function whatClosedIt(before, after) {
  if (!before || !after) return 'The plan now fits inside what you will have.';
  const freedBefore = Number(before.money?.freedMonthly) || 0;
  const freedAfter = Number(after.money?.freedMonthly) || 0;
  if (freedAfter > freedBefore) {
    const names = after.money?.freedNames || [];
    const who = names.length ? (names.length <= 2 ? names.join(' and ') : `${names.length} subscriptions`) : 'what you cancelled';
    return `Putting ${money(freedAfter)} a month from ${who} toward the wedding closed it.`;
  }
  const gB = Number(before.couple?.guests) || 0; const gA = Number(after.couple?.guests) || 0;
  if (gA && gA < gB) return `Keeping the list at ${num(gA)} guests closed it.`;
  const trimmed = (after.lines || []).filter((l) => {
    const b = (before.lines || []).find((x) => x.id === l.id);
    return b && Number(l.planned) < Number(b.planned);
  });
  if (trimmed.length) {
    const names = trimmed.slice(0, 2).map((l) => String(l.item || '').split(/\s[\/(]|\s-\s/)[0].trim().toLowerCase());
    return `Trimming ${names.join(' and ')}${trimmed.length > 2 ? ` and ${num(trimmed.length - 2)} more` : ''} closed it.`;
  }
  const recB = (before.pledges || []).reduce((n, f) => n + (Number(f.received) || 0), 0);
  const recA = (after.pledges || []).reduce((n, f) => n + (Number(f.received) || 0), 0);
  if (recA > recB) {
    const who = (after.pledges || []).find((f) => Number(f.received) > (Number((before.pledges || []).find((x) => x.id === f.id)?.received) || 0));
    return `${who?.name || 'Family'}'s money coming in closed it.`;
  }
  const monB = Number(before.money?.monthly) || 0; const monA = Number(after.money?.monthly) || 0;
  if (monA > monB) return `Saving ${money(monA)} a month closed it.`;
  const savB = Number(before.money?.saved) || 0; const savA = Number(after.money?.saved) || 0;
  if (savA > savB) return 'The money you added closed it.';
  const pledB = (before.pledges || []).length; const pledA = (after.pledges || []).length;
  if (pledA > pledB) return `${plural(pledA - pledB, 'A new padrino', 'New padrinos')} closed it.`;
  return 'The plan now fits inside what you will have.';
}

function samePlan(a, b) {
  // A fresh plan (setup finished, demo loaded) is a new start, not a gap closing.
  if (!a || !b) return false;
  return a.demo === b.demo && (a.couple?.weddingDate || '') === (b.couple?.weddingDate || '') && (a.lines || []).length === (b.lines || []).length;
}

function watchForTheClose(plan) {
  const now = overByOf(plan);
  if (lastOverBy !== null && now !== null && lastOverBy > 0 && now === 0 && samePlan(lastPlan, plan)) {
    celebrate({ line: whatClosedIt(lastPlan, plan) });
  }
  lastOverBy = now;
  lastPlan = plan ? structuredClone(plan) : null;
}

// Wire up

window.addEventListener('hashchange', render);
let hadPlan = hasPlan();
subscribe((plan) => {
  refreshChrome();
  watchForTheClose(plan);
  // No plan to a plan: a fresh start. The next landing is the conversation.
  if (!hadPlan && plan) landOnPath = true;
  hadPlan = Boolean(plan);
  // Re-render the open screen when the plan changes, unless the screen handles its own updates.
  const r = routes[current];
  if (r && !r.mod.selfUpdating) render();
});

getTemplate().then((t) => { template = Array.isArray(t) ? t : []; watchForTheClose(getPlan()); }).catch(() => { watchForTheClose(getPlan()); });

refreshChrome();
render();
window.__padrinoReady = true;

// Bank watch (another builder's piece): rechecks the bank on start and when the tab comes back.
if (typeof bankMod.startBankWatch === 'function') {
  try { bankMod.startBankWatch(); } catch (e) { console.error(e); }
}
