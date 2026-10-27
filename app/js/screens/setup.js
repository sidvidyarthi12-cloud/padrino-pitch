// Onboarding: one friendly question per screen, progress dots, a back control, and
// "you can change this later" under every answer. The key step asks the couple to connect
// their bank, then shows what we found and lets them edit it before the plan is built.
// Each partner still picks their top 3 from picture tiles, on their own turn.

import * as store from '../store.js';
import { getPlan, hasPlan, createPlanFromSetup, setCouple, setMoney, setPriorities, addPledge, getBankData, hasBank } from '../store.js';
import { connectBank } from '../bank.js';
import { getTemplate } from '../data.js';
import { summary } from '../calc.js';
import { PRIORITIES, priorityLabel, combineTop, sharedPicks } from '../priorities.js';
import { esc, todayISO, num, money } from '../format.js';
import { icon, toast, ring, coverPct, styleGridHtml, wireStyleGrid, loadTraditions, OWN_ID, bufferLineHtml, wireBufferLine } from '../ui.js';
import { doLoadDemo } from '../app.js';
import * as onboarding from '../../lib/onboarding.js';
import { suggestSaved, suggestMonthly, subscriptionSummary, seasonDate, guestsWord, SEASONS } from '../../lib/onboarding.js';

// The store changes while the bank links. This screen redraws itself, so the shell stays out.
export const selfUpdating = true;

const STEPS = ['welcome', 'names', 'style', 'date', 'guests', 'bank', 'found', 'pickA', 'handoff', 'pickB', 'agree', 'family', 'done'];
// Sub steps share a dot with the step they belong to.
const DOT_OF = { handoff: 'pickB', agree: 'pickB' };

// What family money can go toward, before the plan has lines. Ids match budget-template.json.
const COVER = [
  ['venue-rental', 'Venue'], ['catering-food', 'Food'], ['bar-alcohol', 'Drinks'], ['cake', 'Cake'],
  ['photographer', 'Photographer'], ['dj', 'DJ or band'], ['florist', 'Flowers'], ['wedding-dress', 'Dress'],
  ['lighting-decor', 'Decor'], ['invitations', 'Invitations'], ['wedding-bands', 'Rings'],
  ['hair-makeup', 'Hair and makeup'], ['honeymoon', 'Honeymoon'], ['', 'Something else']
];

let state = null;

function freshState() {
  const p = getPlan();
  const edit = Boolean(p);
  return {
    edit,
    step: edit ? 'names' : 'welcome',
    couple: p ? { ...p.couple, names: [...(p.couple.names || ['', ''])] } : { names: ['', ''], weddingDate: '', city: 'El Paso', guests: 100 },
    money: p ? { ...p.money } : { saved: 0, monthly: 0, startMonth: todayISO().slice(0, 7) },
    traditions: p && Array.isArray(p.couple?.traditions) ? [...p.couple.traditions] : [],
    traditionNotes: (p && p.couple?.traditionNotes) || '',
    keepInBank: p && Number.isFinite(Number(p.money?.keepInBank)) ? Number(p.money.keepInBank) : null,
    a: p ? [...(p.priorities.a || [])] : [],
    b: p ? [...(p.priorities.b || [])] : [],
    pledges: [],
    bankSkipped: false,
    prefilled: false,
    connecting: false,
    bankError: null,
    built: false
  };
}

export async function render(root, { navigate }) {
  if (!state || state.edit !== hasPlan()) state = freshState();
  draw(root, navigate);
}

// The steps this run actually shows. Editing an existing plan skips the welcome, the family
// step (Family has its own page) and the bank step when a bank is already linked.
function order() {
  return STEPS.filter((s) => {
    if (s === 'welcome' || s === 'family') return !state.edit;
    if (s === 'bank') return !state.edit || !hasBank();
    return true;
  });
}
function after(s) { const o = order(); return o[Math.min(o.length - 1, o.indexOf(s) + 1)]; }
function before(s) { const o = order(); return o[Math.max(0, o.indexOf(s) - 1)]; }

function go(root, navigate, step) {
  state.step = step;
  draw(root, navigate);
}

function draw(root, navigate) {
  root.innerHTML = '';
  const fn = {
    welcome: drawWelcome, names: drawNames, style: drawStyle, date: drawDate, guests: drawGuests, bank: drawBank, found: drawFound,
    pickA: (r, n) => drawPick(r, n, 'a'), handoff: drawHandoff, pickB: (r, n) => drawPick(r, n, 'b'),
    agree: drawAgree, family: drawFamily, done: drawDone
  }[state.step] || drawWelcome;
  fn(root, navigate);
}

function nameOf(which) {
  const n = state.couple.names[which === 'a' ? 0 : 1];
  return (n || '').trim() || (which === 'a' ? 'Partner 1' : 'Partner 2');
}

// Styles for this flow only. Everything else comes from styles.css.
const STYLE = `<style>
.ob { max-width: 540px; margin: 0 auto; }
.ob-top { display: flex; align-items: center; gap: 10px; margin: 4px 0 22px; min-height: 40px; }
.ob-back { width: 40px; height: 40px; border-radius: 8px; display: grid; place-items: center; border: 2px solid var(--ink); box-shadow: 2px 2px 0 var(--shadow-ink); background: var(--surface); color: var(--text); cursor: pointer; flex: none; padding: 0; }
.ob-back:hover { border-color: var(--line-strong); }
.ob-back .ic { width: 18px; height: 18px; }
.ob-back.empty { border: 0; background: transparent; pointer-events: none; }
.ob-dots { flex: 1; display: flex; justify-content: center; gap: 7px; }
.ob-dots span { width: 9px; height: 9px; border-radius: 2px; background: var(--surface); border: 1.5px solid var(--ink); opacity: 1; transition: width 220ms, opacity 220ms; }
.ob-dots span.done { background: var(--accent); opacity: .45; }
.ob-dots span.now { background: var(--accent); opacity: 1; width: 22px; }
.ob .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.ob .q-head { margin: 0 0 20px; }
.ob .q-head h1:focus { outline: none; }
.ob-actions { margin-top: 26px; display: flex; flex-direction: column; gap: 12px; align-items: center; }
.ob-actions .btn { width: 100%; }
.ob-hero { text-align: center; padding: 26px 0 8px; }
.ob-mark { width: 88px; height: 88px; color: var(--accent); margin: 0 auto 18px; display: block; }
.ob-hero h1 { font-size: clamp(1.9rem, 8vw, 2.5rem); }
.ob-hero .lede { color: var(--muted); margin: 10px auto 0; max-width: 34ch; }
.ob-stack { display: grid; gap: 4px; }
.ob-check { display: flex; align-items: center; gap: 10px; margin: 2px 0 14px; cursor: pointer; font-weight: 500; }
.ob-check input { width: 20px; height: 20px; accent-color: var(--accent); margin: 0; }
.ob-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 12px; }
.ob-chip { border: 1.5px solid var(--ink); background: var(--surface); color: var(--text); border-radius: 6px; padding: 8px 15px; cursor: pointer; font-weight: 700; box-shadow: 2px 2px 0 var(--shadow-ink); }
.ob-chip[aria-pressed="true"] { background: var(--dark-btn); border-color: var(--ink); color: var(--dark-btn-ink); }
.ob-season { background: var(--surface); border: 2px solid var(--ink); box-shadow: 3px 3px 0 var(--shadow-ink); border-radius: var(--radius); padding: 14px 16px 6px; margin-bottom: 16px; }
.ob-word { text-align: center; color: var(--muted); margin-top: 4px; font-weight: 500; }
.ob-guests { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; max-width: 320px; margin: 16px auto 8px; }
.ob-guests i { width: 10px; height: 10px; border-radius: 2px; border: 1.5px solid var(--ink); background: var(--surface); transition: background 160ms; }
.ob-guests i.on { background: var(--accent); }
.ob-reasons { list-style: none; padding: 0; margin: 0 0 16px; display: grid; gap: 10px; }
.ob-reasons li { display: flex; gap: 12px; align-items: flex-start; background: var(--surface); border: 2px solid var(--ink); box-shadow: 3px 3px 0 var(--shadow-ink); border-radius: var(--radius); padding: 14px; }
.ob-reasons strong { display: block; font-weight: 600; }
.ob-reasons span { color: var(--muted); font-size: .92rem; }
.ob-ic { width: 38px; height: 38px; border-radius: 6px; background: var(--marigold); display: grid; place-items: center; flex: none; color: var(--marigold-ink); border: 2px solid var(--ink); box-shadow: 2px 2px 0 var(--shadow-ink); }
.ob-ic .ic { width: 20px; height: 20px; }
.ob-trust { display: block; color: var(--muted); font-size: .86rem; text-align: center; margin: 0 auto; max-width: 34ch; }
.ob-trust .ic { width: 15px; height: 15px; display: inline-block; vertical-align: -3px; margin-right: 6px; }
.ob-spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: ob-spin .8s linear infinite; display: inline-block; vertical-align: -3px; margin-right: 8px; }
@keyframes ob-spin { to { transform: rotate(360deg); } }
.ob-err { color: var(--text); background: var(--surface); border: 2px solid var(--bad); border-radius: var(--radius-s); padding: 10px 14px; font-size: .9rem; margin-top: 12px; }
.ob-line { background: var(--surface); border: 2px solid var(--ink); box-shadow: 3px 3px 0 var(--shadow-ink); border-radius: var(--radius); padding: 16px; margin-bottom: 12px; }
.ob-line-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ob-lbl { font-size: .82rem; font-weight: 600; color: var(--muted); }
.ob-src { font-size: .76rem; color: var(--faint); text-align: right; }
.ob-money { position: relative; margin: 6px 0 0; }
.ob-money::before { content: "$"; position: absolute; left: 0; top: 50%; transform: translateY(-50%); font-family: var(--font-display); font-size: 1.4rem; color: var(--muted); }
.ob .ob-money input[type="number"] { width: 100%; border: 0; border-bottom: 1px dashed var(--line-strong); border-radius: 0; background: transparent; font-family: var(--font-display); font-size: 2.1rem; padding: 2px 0 2px 24px; min-height: 52px; letter-spacing: -.02em; -moz-appearance: textfield; }
.ob .ob-money input[type="number"]::-webkit-inner-spin-button, .ob .ob-money input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.ob .ob-money input[type="number"]:focus { outline: none; border-bottom: 1px solid var(--accent); }
.ob-line input[type="range"] { height: 36px; }
.ob-line .tiny { margin-top: 6px; }
.ob-found-tag { display: inline-flex; align-items: center; gap: 6px; font-size: .78rem; color: var(--text); font-weight: 700; background: var(--surface); border: 1.5px solid var(--ink); border-radius: 6px; padding: 4px 10px; margin-bottom: 14px; }
.ob-found-tag .ic { width: 13px; height: 13px; }
.ob-plist { list-style: none; padding: 0; margin: 0 0 14px; display: grid; gap: 8px; }
.ob-plist li { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--surface); border: 2px solid var(--ink); box-shadow: 2px 2px 0 var(--shadow-ink); border-radius: var(--radius-s); padding: 10px 14px; }
.ob-plist .who { font-weight: 600; }
.ob-plist .what { color: var(--muted); font-size: .9rem; }
.ob-pform { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; background: var(--surface); border: 2px solid var(--ink); box-shadow: 3px 3px 0 var(--shadow-ink); border-radius: var(--radius); padding: 14px; }
.ob-pform .field { margin: 0; }
.ob-pform .full { grid-column: 1 / -1; }
.ob-done { text-align: center; padding: 6px 0; }
.ob-done .ring-wrap { margin: 0 auto 18px; width: 150px; }
.ob-done .lede { color: var(--muted); max-width: 36ch; margin: 8px auto 0; }
@media (max-width: 420px) { .ob-pform { grid-template-columns: 1fr; } }
/* No plan yet means no side nav. On a laptop the shell's grid would drop the screen into the
   empty 200px nav column, so the screen takes the whole row here instead. */
@media (min-width: 900px) { .layout:has(> .nav[hidden]) > main.screen { grid-column: 1 / -1; } }
</style>`;

function dots(step) {
  const list = order().filter((s) => s !== 'welcome' && !DOT_OF[s]);
  const at = list.indexOf(DOT_OF[step] || step);
  if (at < 0) return '<span class="ob-dots"></span>';
  return `<div class="ob-dots" aria-hidden="true">${list.map((s, k) => `<span class="${k < at ? 'done' : k === at ? 'now' : ''}"></span>`).join('')}</div>
    <span class="sr-only">Step ${at + 1} of ${list.length}</span>`;
}

// The frame every step sits in: back control, dots, heading, body, actions, reassurance.
function shell(root, navigate, { step, title, lede = '', body = '', actions = '', note = 'You can change this later.', back = true, focus = 'input' }) {
  const backTo = back && step !== order()[0] ? before(step) : null;
  const backEl = backTo
    ? `<button class="ob-back" type="button" id="back" aria-label="Back">${icon('back')}</button>`
    : (state.edit ? `<a class="ob-back" href="#/home" aria-label="Back to Today">${icon('back')}</a>` : '<span class="ob-back empty"></span>');
  root.innerHTML = `${STYLE}
    <div class="ob" data-step="${esc(step)}">
      <div class="ob-top">${backEl}${dots(step)}<span class="ob-back empty"></span></div>
      <header class="q-head"><h1 id="ob-title" tabindex="-1">${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</header>
      <div class="ob-body">${body}</div>
      ${actions ? `<div class="ob-actions">${actions}</div>` : ''}
      ${note ? `<p class="tiny center mt">${esc(note)}</p>` : ''}
    </div>`;
  if (backTo) root.querySelector('#back').addEventListener('click', () => go(root, navigate, backTo));
  const target = focus === 'input' ? (root.querySelector('input:not([type="range"]):not([type="checkbox"])') || root.querySelector('#ob-title')) : root.querySelector('#ob-title');
  if (target) target.focus({ preventScroll: true });
}

// A step that is one form: Next submits it.
function question(root, navigate, opts) {
  const { onNext, nextLabel = 'Next', ...rest } = opts;
  shell(root, navigate, {
    ...rest,
    body: `<form id="q" novalidate>${rest.body}<div class="ob-actions"><button class="btn lg" type="submit">${esc(nextLabel)}</button></div></form>`,
    actions: ''
  });
  root.querySelector('#q').addEventListener('submit', (e) => {
    e.preventDefault();
    if (onNext(e.target) !== false) go(root, navigate, after(rest.step));
  });
}

// 1. Welcome

function drawWelcome(root, navigate) {
  root.innerHTML = `${STYLE}
    <div class="ob" data-step="welcome">
      <div class="ob-hero">
        <svg class="ob-mark" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
          <circle cx="38" cy="54" r="22"/><circle cx="58" cy="54" r="22"/>
          <path d="M48 14c-5-8-17-5-17 4 0 8 17 17 17 17s17-9 17-17c0-9-12-12-17-4z" fill="var(--rose)"/>
        </svg>
        <p class="eyebrow">${esc(store.APP_NAME)}</p>
        <h1 id="ob-title" tabindex="-1">Plan the wedding without the money stress.</h1>
        <p class="lede">One plan for the two of you, with your real money behind it. About two minutes to set up.</p>
      </div>
      <div class="ob-actions">
        <button class="btn lg" type="button" id="start">Start</button>
        <button class="text-btn muted" type="button" id="load-demo">Load the demo couple</button>
      </div>
    </div>`;
  root.querySelector('#start').addEventListener('click', () => go(root, navigate, 'names'));
  root.querySelector('#load-demo').addEventListener('click', () => { state = null; doLoadDemo(); });
  root.querySelector('#ob-title').focus({ preventScroll: true });
}

// 2. Names

function drawNames(root, navigate) {
  const c = state.couple;
  question(root, navigate, {
    step: 'names',
    title: 'Who is getting married?',
    lede: 'Two first names. That is all we need to start.',
    body: `
      <div class="ob-stack">
        <label class="field"><span>You</span><input name="name0" type="text" value="${esc(c.names[0] || '')}" autocomplete="given-name" placeholder="Ana" required></label>
        <label class="field"><span>Your partner</span><input name="name1" type="text" value="${esc(c.names[1] || '')}" placeholder="Luis" required></label>
      </div>`,
    onNext: (f) => {
      const a = f.name0.value.trim(); const b = f.name1.value.trim();
      if (!a || !b) { (a ? f.name1 : f.name0).focus(); toast('Two names, please'); return false; }
      state.couple.names = [a, b];
    }
  });
}

// 2b. Wedding style: one or more traditions, or their own words. It shapes the budget lines,
// the milestones and the vendors. Photos come from /data/traditions.json when it has them.

function drawStyle(root, navigate) {
  const picks = state.traditions;
  const own = picks.includes(OWN_ID);
  const notes = state.traditionNotes || '';
  shell(root, navigate, {
    step: 'style',
    title: 'What kind of wedding?',
    lede: 'Pick everything that fits. Two families, two traditions is normal.',
    body: `<div id="style-body"><p class="muted">Loading the styles.</p></div>`,
    actions: `<button class="btn lg" type="button" id="next">${picks.length ? 'Next' : 'Skip for now'}</button>`,
    note: 'This changes your budget lines and milestones. You can change it later.',
    focus: 'title'
  });
  const nextBtn = root.querySelector('#next');
  const readNotes = () => { state.traditionNotes = root.querySelector('#style-grid-own textarea')?.value.trim() || ''; };
  nextBtn.addEventListener('click', () => { readNotes(); go(root, navigate, after('style')); });
  loadTraditions().then((list) => {
    if (state.step !== 'style') return;
    const body = root.querySelector('#style-body');
    if (!body) return;
    body.innerHTML = styleGridHtml(list, picks, own ? notes : notes, { gridId: 'style-grid' });
    wireStyleGrid(root, 'style-grid', picks, () => { nextBtn.textContent = picks.length ? 'Next' : 'Skip for now'; });
    root.querySelector('#style-grid-own textarea')?.addEventListener('input', readNotes);
  }).catch((e) => { console.error(e); });
}

// 3. Date, or a rough season

function drawDate(root, navigate) {
  const c = state.couple;
  const rough = Boolean(c.dateRough);
  const thisYear = new Date().getFullYear();
  const years = [thisYear + 1, thisYear + 2, thisYear + 3];
  const season = c.season || 'summer';
  const year = Number(c.seasonYear) || years[0];
  const chip = (group, value, label, on) => `<button type="button" class="ob-chip" data-${group}="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
  question(root, navigate, {
    step: 'date',
    title: `When is the big day${c.names[0] ? ', ' + esc(c.names[0]) : ''}?`,
    lede: 'Every deadline in the app counts back from this date.',
    body: `
      <label class="field" id="date-field" ${rough ? 'hidden' : ''}><span>Wedding date</span><input name="weddingDate" type="date" value="${esc(rough ? '' : c.weddingDate || '')}" class="big-input" min="${todayISO()}"></label>
      <label class="ob-check"><input type="checkbox" name="rough" ${rough ? 'checked' : ''}> We have not picked one yet</label>
      <div class="ob-season" id="season" ${rough ? '' : 'hidden'}>
        <p class="tiny" style="margin:0">A rough season is enough. Deadlines count back from the middle of it.</p>
        <div class="ob-chips" role="group" aria-label="Season">${SEASONS.map((s) => chip('season', s, s[0].toUpperCase() + s.slice(1), s === season)).join('')}</div>
        <div class="ob-chips" role="group" aria-label="Year">${years.map((y) => chip('year', y, String(y), y === year)).join('')}</div>
      </div>
      <label class="field"><span>City</span><input name="city" type="text" value="${esc(c.city || 'El Paso')}"></label>`,
    onNext: (f) => {
      state.couple.city = f.city.value.trim() || 'El Paso';
      if (f.rough.checked) {
        const s = root.querySelector('[data-season][aria-pressed="true"]')?.dataset.season || 'summer';
        const y = Number(root.querySelector('[data-year][aria-pressed="true"]')?.dataset.year) || years[0];
        state.couple = { ...state.couple, dateRough: true, season: s, seasonYear: y, weddingDate: seasonDate(s, y) };
        return;
      }
      if (!f.weddingDate.value) { f.weddingDate.focus(); toast('Pick a date, or tick "not yet"'); return false; }
      state.couple = { ...state.couple, dateRough: false, weddingDate: f.weddingDate.value };
    }
  });
  const box = root.querySelector('input[name="rough"]');
  box.addEventListener('change', () => {
    root.querySelector('#date-field').hidden = box.checked;
    root.querySelector('#season').hidden = !box.checked;
  });
  root.querySelector('#season').addEventListener('click', (e) => {
    const b = e.target.closest('.ob-chip'); if (!b) return;
    const group = b.dataset.season !== undefined ? 'season' : 'year';
    root.querySelectorAll(`[data-${group}]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
}

// 4. Guests, as a feeling first and a number second

function drawGuests(root, navigate) {
  const g = Number(state.couple.guests) || 100;
  const dotRow = (n) => Array.from({ length: 40 }, (_, k) => `<i class="${k < Math.ceil(n / 10) ? 'on' : ''}"></i>`).join('');
  question(root, navigate, {
    step: 'guests',
    title: 'About how many guests?',
    lede: 'A rough number is fine. Guests move the whole budget more than anything else.',
    body: `
      <div class="answer center" id="g-big" aria-live="polite">${num(g)}</div>
      <p class="ob-word" id="g-word">${esc(guestsWord(g))}</p>
      <div class="ob-guests" id="g-dots" aria-hidden="true">${dotRow(g)}</div>
      <p class="tiny center" style="margin-bottom:6px">Each dot is ten people.</p>
      <input type="range" name="guests" min="20" max="400" step="5" value="${g}" aria-label="Guest count" aria-valuetext="${g} guests">
      <div class="slider-row"><span>just family</span><span>everyone</span></div>`,
    onNext: (f) => { state.couple.guests = Math.max(1, Number(f.guests.value) || 1); },
    focus: 'title'
  });
  const r = root.querySelector('input[type="range"]');
  r.addEventListener('input', () => {
    const n = Number(r.value);
    root.querySelector('#g-big').textContent = num(n);
    root.querySelector('#g-word').textContent = guestsWord(n);
    root.querySelector('#g-dots').innerHTML = dotRow(n);
    r.setAttribute('aria-valuetext', `${n} guests`);
  });
}

// 5. Connect your bank. The key step.

function drawBank(root, navigate) {
  const bank = getBankData();
  const names = (bank?.accounts || []).map((a) => a.name).filter(Boolean);
  const connected = Boolean(bank);
  shell(root, navigate, {
    step: 'bank',
    title: connected ? 'Your bank is linked' : 'Connect your bank',
    lede: connected
      ? `We can see ${names.length ? esc(names.join(' and ')) : 'your accounts'}. Next we will show you what we found.`
      : 'This is the part that makes Padrino work. Read only, and it takes a few seconds.',
    body: connected ? '' : `
      <ul class="ob-reasons">
        <li><span class="ob-ic">${icon('bank')}</span><div><strong>See your real money</strong><span>What is saved and what comes in each month, not a guess.</span></div></li>
        <li><span class="ob-ic">${icon('check')}</span><div><strong>Payments get verified on their own</strong><span>When a deposit leaves your account, the plan marks it paid.</span></div></li>
        <li><span class="ob-ic">${icon('find')}</span><div><strong>Find money hiding in subscriptions</strong><span>Small monthly charges add up. We show you which could go.</span></div></li>
      </ul>
      <p class="ob-trust">${icon('lock')}<span>Read only. Padrino never moves money. Disconnect any time.</span></p>
      <div id="bank-msg" aria-live="polite"></div>`,
    actions: connected
      ? `<button class="btn lg" type="button" id="next">Next</button>`
      : `<button class="btn lg" type="button" id="connect">${icon('bank')} Connect your bank</button>
         <button class="text-btn muted" type="button" id="later">Do this later</button>`,
    note: connected ? 'You can disconnect any time from Find money.' : 'This demo links a test bank.',
    focus: 'title'
  });

  root.querySelector('#next')?.addEventListener('click', () => { state.bankSkipped = false; go(root, navigate, 'found'); });
  root.querySelector('#later')?.addEventListener('click', () => { state.bankSkipped = true; go(root, navigate, 'found'); });

  const btn = root.querySelector('#connect');
  btn?.addEventListener('click', async () => {
    if (state.connecting) return;
    state.connecting = true;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = `<span class="ob-spin" aria-hidden="true"></span>Linking your bank`;
    root.querySelector('#later').disabled = true;
    const msg = root.querySelector('#bank-msg');
    msg.innerHTML = `<p class="tiny center mt">This takes a few seconds. We are reading balances and recent charges.</p>`;
    try {
      const data = await connectBank();
      state.connecting = false;
      if (!data) throw new Error('No data came back');
      state.bankSkipped = false;
      state.prefilled = false;
      if (state.step === 'bank') go(root, navigate, 'found');
    } catch (e) {
      console.error(e);
      state.connecting = false;
      if (state.step !== 'bank') return;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = `${icon('bank')} Try again`;
      root.querySelector('#later').disabled = false;
      msg.innerHTML = `<p class="ob-err" role="alert">We could not reach the bank just now. Try again, or do this later and connect from Find money.</p>`;
    }
  });
}

// 6. What we found, or plain money inputs when the bank was skipped

// About a month of regular spending, from the bank, when suggestBuffer has landed in /lib/onboarding.js.
function bufferSuggestion(bank) {
  if (!bank || typeof onboarding.suggestBuffer !== 'function') return null;
  try {
    const r = onboarding.suggestBuffer(bank);
    const n = r && typeof r === 'object' ? Number(r.amount) : Number(r);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  } catch (e) { console.error(e); return null; }
}

function prefillFromBank(bank) {
  if (state.prefilled) return;
  state.prefilled = true;
  if (state.keepInBank == null) { const b = bufferSuggestion(bank); state.keepInBank = b != null ? b : 0; }
  const saved = suggestSaved(bank, { keepInBank: state.keepInBank });
  const monthly = suggestMonthly(bank);
  state.money = { ...state.money, saved: saved.amount, monthly: monthly.amount, startMonth: state.money.startMonth || todayISO().slice(0, 7) };
}

function moneyLine({ id, label, src, value, max, step, hint }) {
  return `
    <div class="ob-line">
      <div class="ob-line-head"><label class="ob-lbl" for="${id}">${label}</label>${src ? `<span class="ob-src">${src}</span>` : ''}</div>
      <div class="ob-money"><input id="${id}" name="${id}" type="number" min="0" step="${step}" value="${esc(value)}" inputmode="numeric"></div>
      <input type="range" id="${id}-r" min="0" max="${max}" step="${step}" value="${Math.min(value, max)}" aria-label="${label}, slider">
      <p class="tiny">${hint}</p>
    </div>`;
}

function drawFound(root, navigate) {
  const bank = state.bankSkipped ? null : getBankData();
  if (!bank) return drawManualMoney(root, navigate);
  prefillFromBank(bank);

  const saved = suggestSaved(bank, { keepInBank: state.keepInBank });
  const monthly = suggestMonthly(bank);
  const subs = subscriptionSummary(bank);
  const m = state.money;
  const bufferSuggested = bufferSuggestion(bank);

  const savedHint = saved.reason === 'named' ? `That is what is in your ${esc(saved.account.name)} account today.`
    : saved.reason === 'savings' ? 'That is what is in savings today. Keep only the part meant for the wedding.'
      : 'We did not see a savings account. Type what you have set aside so far.';
  const monthlyHint = monthly.months === 0 ? 'We could not read enough history. Type what feels safe.'
    : monthly.leftover <= 0 ? 'Your spending is close to what comes in, so we left this at zero. Any amount helps.'
      : `In a normal month about ${money(monthly.leftover)} is left after regular spending. We suggest half of that, so life still has room.`;
  const subsLine = subs.count === 0 ? 'We did not spot any subscriptions. Find money keeps looking as new charges land.'
    : `We found ${subs.count} ${subs.count === 1 ? 'subscription' : 'subscriptions'}. Together they run about ${money(subs.monthly)} a month. We will show you these on Find money.`;

  question(root, navigate, {
    step: 'found',
    title: 'Here is what we found',
    lede: 'Three things to check. Slide or type, then go on.',
    body: `
      <span class="ob-found-tag">${icon('bank')}From ${esc(bank.sandbox ? 'your test bank' : 'your bank')}</span>
      ${bufferLineHtml({ id: 'keep', value: state.keepInBank || 0, max: Math.max(10000, (bufferSuggested || 0) * 3), suggested: bufferSuggested, hint: 'Money for living: rent, food, the car. The wedding never touches it. We take it off the top before suggesting the numbers below.' })}
      ${moneyLine({ id: 'saved', label: 'Saved for the wedding', src: saved.account ? `${esc(saved.account.name)}${saved.account.mask ? ' &middot;&middot;' + esc(saved.account.mask) : ''}` : '', value: Math.round(m.saved || 0), max: Math.max(30000, Math.ceil((saved.amount * 2) / 1000) * 1000), step: 100, hint: savedHint })}
      ${moneyLine({ id: 'monthly', label: 'Toward the wedding each month', src: monthly.months ? `last ${monthly.months} months` : '', value: Math.round(m.monthly || 0), max: Math.max(2000, Math.ceil((monthly.leftover || 0) / 500) * 500), step: 25, hint: monthlyHint })}
      <section class="card tint-sand"><div class="nudge"><div class="n-ic">${icon('find')}</div><p>${subsLine}</p></div></section>`,
    onNext: (f) => {
      state.keepInBank = Math.max(0, Number(f.keep.value) || 0);
      state.money = { ...state.money, saved: Math.max(0, Number(f.saved.value) || 0), monthly: Math.max(0, Number(f.monthly.value) || 0) };
    },
    nextLabel: 'Looks right',
    focus: 'title'
  });
  wireMoneyLine(root, 'saved');
  wireMoneyLine(root, 'monthly');
  wireBufferLine(root, 'keep', (n) => {
    state.keepInBank = n;
    // The saved suggestion sits on top of the buffer, so it moves when the buffer does.
    try {
      const again = suggestSaved(bank, { keepInBank: n });
      if (again && Number.isFinite(Number(again.amount)) && again.reason !== 'none') {
        const inp = root.querySelector('#saved'); const r = root.querySelector('#saved-r');
        if (inp && document.activeElement !== inp) { inp.value = Math.round(again.amount); if (r) r.value = Math.min(Number(inp.value) || 0, Number(r.max)); }
      }
    } catch { /* fine */ }
  });
}

function wireMoneyLine(root, id) {
  const n = root.querySelector(`#${id}`);
  const r = root.querySelector(`#${id}-r`);
  r.addEventListener('input', () => { n.value = r.value; });
  n.addEventListener('input', () => { r.value = Math.min(Number(n.value) || 0, Number(r.max)); });
}

function drawManualMoney(root, navigate) {
  const m = state.money;
  question(root, navigate, {
    step: 'found',
    title: 'What can you put toward it?',
    lede: 'Your own money, not an average. Family help comes next.',
    body: `
      <div class="ob-stack">
        <label class="field"><span>Saved already</span><div class="money-input"><input name="saved" type="number" min="0" step="100" value="${esc(m.saved || 0)}" inputmode="numeric"></div></label>
        <label class="field"><span>Each month from now</span><div class="money-input"><input name="monthly" type="number" min="0" step="50" value="${esc(m.monthly || 0)}" inputmode="numeric"></div></label>
      </div>
      <p class="tiny">Cash gifts never count. They arrive after the bills.</p>
      ${bufferLineHtml({ id: 'keep', value: state.keepInBank || 0, max: 10000 })}
      ${hasBank() ? '' : `<p class="tiny mt"><button class="text-btn" type="button" id="to-bank">Connect your bank instead</button> and we fill these in for you.</p>`}`,
    onNext: (f) => {
      state.keepInBank = Math.max(0, Number(f.keep.value) || 0);
      state.money = { ...state.money, saved: Math.max(0, Number(f.saved.value) || 0), monthly: Math.max(0, Number(f.monthly.value) || 0), startMonth: m.startMonth || todayISO().slice(0, 7) };
    }
  });
  wireBufferLine(root, 'keep', (n) => { state.keepInBank = n; });
  root.querySelector('#to-bank')?.addEventListener('click', () => { state.bankSkipped = false; go(root, navigate, 'bank'); });
}

// 7. Each partner picks three picture tiles, in order.

function drawPick(root, navigate, which) {
  const picks = state[which];
  const name = nameOf(which);
  const other = nameOf(which === 'a' ? 'b' : 'a');
  shell(root, navigate, {
    step: which === 'a' ? 'pickA' : 'pickB',
    title: `${esc(name)}, pick your top 3`,
    lede: `Tap in order. ${esc(other)} does not see this yet.`,
    body: `<div class="pick-grid" id="grid" role="group" aria-label="Your top three"></div>`,
    actions: `<button class="btn lg" type="button" id="next" disabled>${which === 'a' ? 'Done, hand it over' : 'See where you agree'}</button>`,
    note: 'Three picks. Tap again to undo one.',
    focus: 'title'
  });

  const grid = root.querySelector('#grid');
  const nextBtn = root.querySelector('#next');

  function paint() {
    grid.innerHTML = PRIORITIES.map((p) => {
      const rank = picks.indexOf(p.id);
      const on = rank >= 0;
      const full = picks.length >= 3 && !on;
      return `<button type="button" class="pick" data-id="${p.id}" aria-pressed="${on}" ${full ? 'disabled' : ''}>
        <span class="pick-ic">${icon(p.id)}</span>
        <span>${esc(p.label)}</span>${on ? `<span class="rank" aria-label="pick ${rank + 1}">${rank + 1}</span>` : ''}</button>`;
    }).join('');
    nextBtn.disabled = picks.length !== 3;
  }
  paint();

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.pick');
    if (!btn) return;
    const id = btn.dataset.id;
    const at = picks.indexOf(id);
    if (at >= 0) picks.splice(at, 1);
    else if (picks.length < 3) picks.push(id);
    paint();
  });

  nextBtn.addEventListener('click', () => {
    if (picks.length !== 3) return;
    go(root, navigate, which === 'a' ? 'handoff' : 'agree');
  });
}

function drawHandoff(root, navigate) {
  shell(root, navigate, {
    step: 'handoff',
    title: `Hand the phone to ${esc(nameOf('b'))}`,
    lede: `${esc(nameOf('a'))}'s picks stay hidden until you both finish.`,
    body: `<div class="handoff" style="padding:18px 0 0"><div class="big-ic">${icon('heart')}</div><p class="eyebrow">Your turn is done</p></div>`,
    actions: `<button class="btn lg" type="button" id="go">I'm ${esc(nameOf('b'))}</button>`,
    note: '',
    focus: 'title'
  });
  root.querySelector('#go').addEventListener('click', () => go(root, navigate, 'pickB'));
}

function drawAgree(root, navigate) {
  const a = state.a;
  const b = state.b;
  const shared = sharedPicks(a, b);
  const top = combineTop(a, b);
  const headline = shared.length === 3 ? 'You agree on all three'
    : shared.length === 2 ? 'You agree on two of three'
      : shared.length === 1 ? 'You agree on one'
        : 'Different lists. That is normal.';
  const sub = shared.length === 0
    ? 'We took turns from each list to make one top 3.'
    : 'Shared picks go first. Then we took turns from each list.';
  const col = (who, list) => `<div class="agree-col"><h3>${esc(nameOf(who))}</h3>
    <ol>${list.map((id) => `<li class="${shared.includes(id) ? 'shared' : ''}">${icon(id)}${esc(priorityLabel(id))}</li>`).join('')}</ol></div>`;
  shell(root, navigate, {
    step: 'agree',
    title: headline,
    lede: sub,
    body: `
      <div class="agree-grid">${col('a', a)}${col('b', b)}</div>
      <section class="card tint-peach mt">
        <div class="card-head"><span class="card-title">Protected</span><span class="lock">${icon('lock')}</span></div>
        <div class="chips" style="margin-top:4px">${top.map((id) => `<span class="chip">${icon(id)}${esc(priorityLabel(id))}</span>`).join('')}</div>
        <p class="muted mt">These get a lock. The fixer never suggests cutting them.</p>
      </section>`,
    actions: `<button class="btn lg" type="button" id="next">${state.edit ? 'Save' : 'Next'}</button>`,
    focus: 'title'
  });
  root.querySelector('#next').addEventListener('click', () => go(root, navigate, after('agree')));
}

// 8. Family, optional. Padrinos: who, what they cover, how much.

function drawFamily(root, navigate) {
  const list = state.pledges;
  const total = list.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  shell(root, navigate, {
    step: 'family',
    title: 'Is anyone helping pay?',
    lede: 'Padrinos, parents, an aunt with a soft spot for cake. Add them now or on the Family page later.',
    body: `
      ${list.length ? `<ul class="ob-plist" aria-label="People helping">${list.map((p, i) => `
        <li><div><div class="who">${esc(p.name)}</div><div class="what">${esc(p.item)}</div></div>
          <div class="row" style="gap:8px"><strong>${money(p.amount)}</strong><button class="text-btn muted" type="button" data-remove="${i}" aria-label="Remove ${esc(p.name)}">Remove</button></div></li>`).join('')}</ul>
        <p class="tiny" style="margin:-6px 0 14px">${money(total)} pledged so far. Money with strings attached is worth agreeing on first.</p>` : ''}
      <form id="pledge" class="ob-pform" novalidate>
        <label class="field"><span>Who</span><input name="name" type="text" placeholder="Tia Rosa" autocomplete="off"></label>
        <label class="field"><span>Covers</span><select name="cover">${COVER.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
        <label class="field full"><span>How much</span><div class="money-input"><input name="amount" type="number" min="0" step="50" placeholder="500" inputmode="numeric"></div></label>
        <div class="full"><button class="btn secondary sm" type="submit">${icon('plus')} Add this person</button></div>
      </form>`,
    actions: `<button class="btn lg" type="button" id="next">${list.length ? 'Next' : 'Skip for now'}</button>`,
    note: 'You can add or change family money any time.',
    focus: 'title'
  });

  root.querySelector('#pledge').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim();
    const amount = Number(f.amount.value) || 0;
    if (!name) { f.name.focus(); toast('Who is helping?'); return; }
    if (amount <= 0) { f.amount.focus(); toast('How much are they covering?'); return; }
    const [lineId, label] = COVER.find(([id]) => id === f.cover.value) || COVER[COVER.length - 1];
    list.push({ name, lineId: lineId || null, item: label, amount });
    drawFamily(root, navigate);
    root.querySelector('#pledge input[name="name"]').focus();
  });
  root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    list.splice(Number(b.dataset.remove), 1);
    drawFamily(root, navigate);
  }));
  root.querySelector('#next').addEventListener('click', () => go(root, navigate, 'done'));
}

// 9. Done: build the plan, show one ring and one sentence.

async function buildPlan() {
  const priorities = { a: [...state.a], b: [...state.b], top: combineTop(state.a, state.b) };
  const keep = state.keepInBank != null ? Math.max(0, Number(state.keepInBank) || 0) : null;
  const money = keep != null ? { ...state.money, keepInBank: keep } : state.money;
  if (state.edit) {
    setCouple(state.couple);
    setMoney(money);
    setPriorities(priorities);
  } else {
    await createPlanFromSetup({ couple: state.couple, money, priorities });
    const plan = getPlan();
    for (const f of state.pledges) {
      const line = f.lineId ? plan.lines.find((l) => l.id === f.lineId) : null;
      addPledge({ name: f.name, relation: '', lineId: line ? line.id : null, item: line ? line.item : f.item, amount: f.amount, received: 0, strings: '' });
    }
  }
  // The living money buffer and the wedding style, through the store when those parts have landed.
  if (keep != null && typeof store.setKeepInBank === 'function') {
    try { store.setKeepInBank(keep); } catch (e) { console.error(e); }
  }
  const ids = [...state.traditions];
  const notes = state.traditionNotes || '';
  if (ids.length || notes) {
    if (typeof store.setTraditions === 'function') {
      try { await store.setTraditions(ids, notes); } catch (e) { console.error(e); }
    } else {
      try { setCouple({ traditions: ids, traditionNotes: notes }); } catch (e) { console.error(e); }
    }
  }
  if (hasBank()) {
    try { store.markPaidFromBank?.(); } catch (e) { console.error(e); }
    if (typeof store.verifyWithBank === 'function') {
      try { await store.verifyWithBank(); } catch (e) { console.error(e); }
    }
  }
}

async function drawDone(root, navigate) {
  shell(root, navigate, {
    step: 'done',
    title: state.edit ? 'Saving' : 'Building your plan',
    lede: 'One moment.',
    body: `<div class="ob-done"><span class="ob-spin" aria-hidden="true"></span></div>`,
    note: '', back: false, focus: 'title'
  });

  let s;
  try {
    if (!state.built) { await buildPlan(); state.built = true; }
    s = summary(getPlan(), await getTemplate());
  } catch (e) {
    console.error(e);
    shell(root, navigate, {
      step: 'done', title: 'Something went wrong', lede: esc(e.message || String(e)),
      actions: `<button class="btn lg" type="button" id="retry">Try again</button>`, note: '', focus: 'title'
    });
    root.querySelector('#retry').addEventListener('click', () => drawDone(root, navigate));
    return;
  }
  if (state.step !== 'done') return;

  // A fresh split rounds each line to whole dollars, which can land a dollar or two over.
  // That is rounding, not a gap, so it reads as "fits" here.
  const over = Number(s.overBy) >= 5;
  const spare = Number(s.gap) > 0 ? s.gap : 0;
  const none = !Number(s.needed);
  const cls = none ? '' : over ? 'bad' : 'good';
  const big = none ? '' : over ? money(s.overBy) : spare ? money(spare) : 'fits';
  const lbl = none ? 'no plan yet' : over ? 'over' : spare ? 'to spare' : 'exactly';
  const line = none ? 'Add money on Today when you can, and the plan fills itself in.'
    : over ? 'The plan needs a bit more than you will have by the day. The Fixer can close the gap.'
      : spare ? 'Your money covers the plan, rainy-day money included, with some to spare.'
        : 'Your money covers the plan exactly, rainy-day money included.';
  const who = state.couple.names.filter(Boolean).join(' and ') || 'You two';

  shell(root, navigate, {
    step: 'done',
    title: state.edit ? 'Saved' : `${esc(who)}, you are set`,
    lede: '',
    body: `
      <div class="ob-done">
        <div class="ring-wrap">
          ${ring(none ? 0 : coverPct(s.available, s.needed), { size: 150, stroke: 12, cls, label: 'How much of the wedding your money covers' })}
          <div class="ring-center"><div class="big">${big}</div><div class="lbl">${lbl}</div></div>
        </div>
        <p class="lede">${line}</p>
      </div>`,
    actions: `<button class="btn lg" type="button" id="home">Go to Today</button>
      ${over ? `<a class="text-btn" href="#/fixer" id="fixer">Open the Fixer</a>` : ''}`,
    note: '', back: false, focus: 'title'
  });
  const edit = state.edit;
  root.querySelector('#home').addEventListener('click', () => { state = null; toast(edit ? 'Saved' : 'Plan ready'); navigate('/home'); });
  root.querySelector('#fixer')?.addEventListener('click', () => { state = null; });
}
