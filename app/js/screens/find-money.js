// Find money: repeat charges as rows. "Could go" rows have a switch and a way to cancel them;
// "Stays" rows can be moved up if the app guessed wrong. A bar fills toward the gap (or toward the
// wedding fund) as you flip them. Sums come from /lib/bank.js. The choices live in js/subs.js.
// Cancelling: the app shows how and watches the bank. It does not cancel anything on its own.

import * as store from '../store.js';
import { getTemplate } from '../data.js';
import { summary } from '../calc.js';
import { refreshBankData, connectBank, frequencyLabel, categoryLabel } from '../bank.js';
import { monthlyFreed, freedByWedding } from '../../lib/bank.js';
import { money, esc, num, plural, initials, fmtDateShort, fmtDate } from '../format.js';
import { icon, bar, setBar, share, toast, openSheet } from '../ui.js';
import * as subs from '../subs.js';

let bankChecked = false;
// Which charges are switched on (stopped, counted toward the wedding). Null until the first look.
let picked = null;
// Charges already seen, so a charge that is new to the list starts switched on.
const seen = new Set();

const LOGO_TINTS = ['rose', 'emerald', 'ocean', 'marigold', 'plum', 'teal'];
const HABIT_CATEGORIES = new Set(['FOOD_AND_DRINK', 'GENERAL_MERCHANDISE', 'TRAVEL', 'TRANSPORTATION', 'HOME_IMPROVEMENT']);

const CSS = `
.fm .sub-row { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto 44px; column-gap: 12px; row-gap: 0; align-items: center; padding: 12px 0; }
.fm .sub-row .fm-acts { grid-column: 2 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 0 16px; margin-top: 2px; }
.fm .fm-open { cursor: pointer; border-radius: 8px; min-width: 0; }
.fm .fm-act { appearance: none; border: 0; background: none; padding: 0; min-height: 32px; display: inline-flex; align-items: center; cursor: pointer; font-size: 0.82rem; font-weight: 600; color: var(--accent); }
.fm .fm-act:hover { color: var(--accent-hover); }
.fm .fm-act.muted { color: var(--muted); font-weight: 500; }
.fm .fm-act.muted:hover { color: var(--text); }
.fm .fm-pill { font-size: 0.76rem; padding: 3px 9px; margin: 4px 0; white-space: normal; }
.fm .fm-pill .ic { width: 12px; height: 12px; }
.fm .fm-hint { font-size: 0.8rem; color: var(--muted); margin: -4px 0 10px; }
.fm .fm-left a { font-weight: 600; }
.fm-sheet .fm-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 6px; }
.fm-sheet h2 { margin-bottom: 4px; }
.fm-sheet .fm-steps { list-style: none; counter-reset: fm; margin: 16px 0 0; padding: 0; }
.fm-sheet .fm-steps li { counter-increment: fm; display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 10px; align-items: start; padding: 9px 0; border-top: 1px solid var(--line); }
.fm-sheet .fm-steps li:first-child { border-top: 0; }
.fm-sheet .fm-steps li::before { content: counter(fm); width: 24px; height: 24px; border-radius: 50%; background: var(--surface-2); color: var(--muted); font-size: 0.8rem; font-weight: 700; display: grid; place-items: center; }
.fm-sheet .fm-heads { margin-top: 14px; padding: 12px 14px; border-radius: var(--radius-s); background: var(--warn-tint); }
.fm-sheet .fm-heads .fm-heads-title { display: flex; align-items: center; gap: 6px; font-weight: 700; color: var(--warn); font-size: 0.85rem; margin-bottom: 4px; }
.fm-sheet .fm-heads .ic { width: 15px; height: 15px; }
.fm-sheet .fm-heads p { font-size: 0.92rem; }
.fm-sheet .fm-state { margin-top: 14px; padding: 14px; border-radius: var(--radius-s); background: var(--surface-2); }
.fm-sheet .fm-state p { margin-top: 8px; }
.fm-sheet .fm-stack { display: grid; gap: 10px; margin-top: 18px; }
.fm-sheet .fm-stack .btn { width: 100%; }
.fm-sheet .fm-center { text-align: center; }
.fm-sheet a.fm-src { word-break: break-word; }
`;

function ensureStyle() {
  if (document.getElementById('fm-style')) return;
  const st = document.createElement('style');
  st.id = 'fm-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

export async function render(root) {
  ensureStyle();
  const plan = store.getPlan();
  if (!bankChecked) { bankChecked = true; refreshBankData().catch(() => {}); }
  const bank = store.getBankData();
  const [template, guide] = await Promise.all([getTemplate().catch(() => []), subs.loadGuide()]);
  if (!/find-money/.test(location.hash)) return;
  let s = null;
  try { s = summary(plan, template); } catch (e) { console.error(e); }

  if (!bank) {
    root.innerHTML = `
      <header class="screen-head" data-color="teal">
        <p class="eyebrow">Find money · Cut what you do not use</p>
        <h1>Find money</h1>
        <p class="lede">Most couples pay every month for things they forgot about. The wedding can have that money instead.</p>
      </header>
      <section class="card tint-peach">
        <div class="nudge"><div class="n-ic">${icon('find')}</div><div>
          <p><strong>Connect your bank once.</strong></p>
          <p class="muted mt-s">We read the charges that repeat and guess which ones you could live without. You can move any of them. Payments you already made get ticked off on their own.</p>
        </div></div>
        <div class="row mt">
          <button class="btn" type="button" id="connect-bank">Connect your bank</button>
          <span class="tiny" id="bank-status"></span>
        </div>
      </section>
      <p class="tiny mt">This demo links a test bank, not a real account.</p>`;
    root.querySelector('#connect-bank').addEventListener('click', connectHandler(root));
    return;
  }

  subs.syncWith(bank);
  const transactions = bank.transactions || [];
  const recurring = (bank.recurring || []).slice();
  // A cancelled charge can drop out of the bank's repeat list. Keep showing it until it is verified.
  const ids = new Set(recurring.map((r) => r.id));
  for (const rec of subs.allCancelled()) {
    if (!ids.has(rec.id)) recurring.push({ id: rec.id, name: rec.name, monthly: rec.monthly, amount: rec.amount, frequency: rec.frequency, lastDate: rec.lastDate, nextDate: rec.nextDate, category: null, merchant: true });
  }

  const { go, stay } = subs.splitSubs(recurring, transactions);
  const goIds = new Set(go.map((r) => r.id));

  if (!picked) {
    const chosen = plan.money.freedNames;
    picked = new Set(go.filter((r) => !Array.isArray(chosen) || chosen.includes(titleCase(r.name))).map((r) => r.id));
    go.forEach((r) => seen.add(r.id));
  } else {
    for (const r of go) if (!seen.has(r.id)) { seen.add(r.id); picked.add(r.id); }
  }
  for (const id of [...picked]) if (!goIds.has(id)) picked.delete(id);

  // Once freed money is in the plan, the plan's gap already counts it. Measure against the
  // gap as it was before, so the bar still shows how much the subscriptions covered.
  const applied = Number(plan.money.freedMonthly) || 0;
  const monthsLeft = s ? s.monthsLeft : 0;
  const appliedByWedding = s && applied ? freedByWedding(applied, monthsLeft) : 0;
  const gap = s ? Math.max(0, Number(s.overBy) + appliedByWedding) : 0;
  const allByWedding = s ? freedByWedding(monthlyFreed(go), monthsLeft) : 0;
  const bankCtx = { transactions, fetchedAt: bank.fetchedAt };

  root.innerHTML = `
    <div class="fm">
    <header class="screen-head" data-color="teal">
      <p class="eyebrow">Find money · Cut what you do not use</p>
      <h1>Find money</h1>
      <p class="lede">Switch on what you could live without. The wedding gets that money.</p>
    </header>

    <section class="card" aria-live="polite">
      <div class="card-head"><span class="card-title">${gap ? 'Toward the gap' : 'Toward the wedding'}</span><span id="freed-pill"></span></div>
      <div class="answer" id="freed-monthly"></div>
      <div class="answer-sub">a month, freed up</div>
      ${bar(0, { cls: 'tall good mt', label: gap ? 'How much of the gap this covers by the wedding' : 'How much this adds by the wedding' })}
      <div class="bar-ends"><span id="freed-word"></span><span>${gap ? 'gap covered' : 'by the wedding'}</span></div>
      <p class="tiny mt-s fm-left" id="fixer-note" hidden></p>
      <div class="row mt" id="apply-row">
        <button class="btn" type="button" id="apply-freed"></button>
        <button class="text-btn muted" type="button" id="undo-freed" hidden>Undo</button>
      </div>
      <p class="tiny mt-s" id="applied-note" hidden></p>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="section-title">Could go</h2><span class="tiny"><button class="text-btn" type="button" id="pick-all">All</button> &nbsp; <button class="text-btn muted" type="button" id="pick-none">None</button></span></div>
      <p class="fm-hint">Tap one to see how to cancel it. Wrong guess? Move it to Stays.</p>
      <div class="card" style="padding:4px 18px">
        ${go.length ? go.map((r, i) => goRow(r, picked.has(r.id), i, guide, bankCtx)).join('')
          : '<p class="all-done">Nothing is marked as optional. Move a charge up from Stays if you could live without it.</p>'}
      </div>
    </section>

    ${stay.length ? `
    <section class="section">
      <div class="section-head"><h2 class="section-title">Stays</h2><span class="tiny">rent, loans, utilities, medical</span></div>
      <p class="fm-hint">The app guessed these stay. Move any you could drop.</p>
      <div class="card" style="padding:4px 18px">${stay.map((r, i) => stayRow(r, i + go.length, bankCtx)).join('')}</div>
    </section>` : ''}

    <p class="tiny mt-l">Move the freed money into a separate wedding account the day it would have been charged. Money that stays in checking gets spent.${bank.sandbox ? ' This is a test bank.' : ''}</p>
    </div>`;

  const wrap = root.querySelector('.fm');
  const barEl = wrap.querySelector('.fillbar');
  const applyBtn = wrap.querySelector('#apply-freed');
  const undoBtn = wrap.querySelector('#undo-freed');
  const appliedNote = wrap.querySelector('#applied-note');
  const fixerNote = wrap.querySelector('#fixer-note');

  function paintApply(m) {
    const same = applied && Math.abs(applied - m) < 0.01;
    undoBtn.hidden = !applied;
    appliedNote.hidden = !applied;
    if (applied) appliedNote.textContent = `${money(applied)} a month is already going to the wedding.`;
    applyBtn.hidden = same || (!m && !applied);
    applyBtn.textContent = applied ? `Change it to ${money(m)} a month` : `Put ${money(m)} a month toward the wedding`;
  }

  function repaint() {
    const sel = go.filter((r) => picked.has(r.id));
    const m = monthlyFreed(sel);
    const w = s ? freedByWedding(m, monthsLeft) : 0;
    paintApply(m);
    wrap.querySelector('#freed-monthly').textContent = money(m);
    const pct = gap ? share(w, gap) : share(w, allByWedding);
    setBar(barEl, pct);
    const word = wrap.querySelector('#freed-word');
    const pill = wrap.querySelector('#freed-pill');
    // Link back to the fixer for whatever is left.
    if (gap) {
      const left = Math.max(0, gap - w);
      fixerNote.hidden = false;
      fixerNote.innerHTML = left > 0
        ? `${money(left)} would still be short. <a href="#/fixer">See other ways to close it</a>`
        : 'That closes the gap.';
    } else {
      fixerNote.hidden = true;
    }
    if (!sel.length) { word.textContent = 'nothing switched on yet'; pill.innerHTML = ''; return; }
    if (gap) {
      if (w >= gap) { word.textContent = 'that closes it'; pill.innerHTML = `<span class="status good">${icon('check')}Gap covered</span>`; }
      else { word.textContent = `${money(w)} by the wedding`; pill.innerHTML = `<span class="status warn">${icon('info')}Part of it</span>`; }
    } else {
      word.textContent = `${money(w)} by the wedding`;
      pill.innerHTML = `<span class="status good">${icon('check')}${num(sel.length)} ${plural(sel.length, 'charge')}</span>`;
    }
  }
  repaint();

  // Redraw the whole screen after a move or a cancel, keeping the scroll place.
  function redraw() {
    const y = window.scrollY;
    if (!/find-money/.test(location.hash)) return Promise.resolve();
    return render(root).then(() => window.scrollTo({ top: y }));
  }

  wrap.querySelectorAll('[data-charge]').forEach((cb) => cb.addEventListener('change', () => {
    const row = cb.closest('.sub-row');
    if (cb.checked) { picked.add(cb.dataset.charge); row.classList.remove('off'); }
    else { picked.delete(cb.dataset.charge); row.classList.add('off'); }
    repaint();
  }));
  wrap.querySelector('#pick-all')?.addEventListener('click', () => {
    picked = new Set(go.map((r) => r.id));
    wrap.querySelectorAll('[data-charge]').forEach((cb) => { cb.checked = true; cb.closest('.sub-row').classList.remove('off'); });
    repaint();
  });
  wrap.querySelector('#pick-none')?.addEventListener('click', () => {
    picked = new Set();
    wrap.querySelectorAll('[data-charge]').forEach((cb) => { cb.checked = false; cb.closest('.sub-row').classList.add('off'); });
    repaint();
  });
  applyBtn.addEventListener('click', () => {
    const sel = go.filter((r) => picked.has(r.id));
    const m = monthlyFreed(sel);
    if (!m) return;
    store.putFreedTowardWedding({ monthly: m, names: sel.map((r) => titleCase(r.name)) });
    toast(`${money(m)} a month now goes to the wedding`, 3000);
    setTimeout(() => { location.hash = '#/home'; }, 900);
  });
  undoBtn.addEventListener('click', () => {
    store.undoFreed();
    toast('Taken back out of the wedding savings');
  });

  // Move a charge between Could go and Stays. The choice is remembered in subs.js.
  const byId = new Map(recurring.map((r) => [r.id, r]));
  wrap.querySelectorAll('[data-move]').forEach((btn) => btn.addEventListener('click', () => {
    const r = byId.get(btn.dataset.move);
    if (!r) return;
    const to = btn.dataset.to === 'go' ? 'go' : 'stay';
    subs.setChoice(r.id, to, r);
    if (to === 'go') { picked.add(r.id); seen.add(r.id); } else picked.delete(r.id);
    toast(to === 'go' ? `${titleCase(r.name)} moved to Could go` : `${titleCase(r.name)} moved to Stays`);
    redraw();
  }));

  // Tap a "Could go" charge to see how to cancel it.
  const open = (id) => {
    const r = byId.get(id);
    if (r) openCancelSheet(r, { guide, bank, transactions, redraw });
  };
  wrap.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => open(el.dataset.open));
    if (el.getAttribute('role') === 'button') {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(el.dataset.open); }
      });
    }
  });
}

function logo(r, i) {
  const tint = LOGO_TINTS[i % LOGO_TINTS.length];
  return `<span class="sub-logo" style="background:var(--${tint});color:var(--${tint}-ink)" aria-hidden="true">${esc(initials(r.name).slice(0, 1))}</span>`;
}

// Plaid files many repeat charges as TRANSFER_OUT. Show how the same name was filed in the transactions.
function subLine(r, transactions) {
  let cat = String(r.category || '').toUpperCase();
  if (!cat || cat === 'TRANSFER_OUT') {
    const t = (transactions || []).find((x) => x.category && String(x.category).toUpperCase() !== 'TRANSFER_OUT' && subs.sameMerchant(x.name, r.name));
    if (t) cat = String(t.category).toUpperCase();
  }
  return [cat === 'TRANSFER_OUT' ? '' : categoryLabel(cat), frequencyLabel(r.frequency)].filter(Boolean).join(', ');
}

function goRow(r, on, i, guide, ctx) {
  const rec = subs.getCancelled(r.id);
  const g = subs.guideFor(titleCase(r.name), guide);
  const habit = !g && HABIT_CATEGORIES.has(transactionCategory(r, ctx.transactions));
  const check = rec ? subs.cancelCheck(rec, ctx.transactions, { fetchedAt: ctx.fetchedAt }) : null;
  const acts = rec
    ? `${pill(check)}<button class="fm-act" type="button" data-open="${esc(r.id)}">Details</button>`
    : `<button class="fm-act" type="button" data-open="${esc(r.id)}">${habit ? 'How to cut it' : 'How to cancel'}</button>
       <button class="fm-act muted" type="button" data-move="${esc(r.id)}" data-to="stay">Move to Stays</button>`;
  return `<div class="sub-row ${on ? '' : 'off'}">
    ${logo(r, i)}
    <div class="sub-main fm-open" role="button" tabindex="0" data-open="${esc(r.id)}" aria-label="${habit ? 'How to cut' : 'How to cancel'} ${esc(titleCase(r.name))}"><span class="sub-name">${esc(titleCase(r.name))}</span><br><span class="sub-sub">${esc(subLine(r, ctx.transactions))}</span></div>
    <span class="sub-amt">${money(r.monthly)}<span class="tiny"> /mo</span></span>
    <label class="switch" aria-label="Stop ${esc(r.name)}"><input type="checkbox" data-charge="${esc(r.id)}" ${on ? 'checked' : ''}><i></i></label>
    <div class="fm-acts">${acts}</div>
  </div>`;
}

function stayRow(r, i, ctx) {
  return `<div class="sub-row">
    ${logo(r, i)}
    <div class="sub-main"><span class="sub-name">${esc(titleCase(r.name))}</span><br><span class="sub-sub">${esc(subLine(r, ctx.transactions))}</span></div>
    <span class="sub-amt">${money(r.monthly)}<span class="tiny"> /mo</span></span>
    <span aria-hidden="true"></span>
    <div class="fm-acts"><button class="fm-act muted" type="button" data-move="${esc(r.id)}" data-to="go">Move to Could go</button></div>
  </div>`;
}

// A small status pill for a cancelled charge.
function pill(check) {
  if (!check) return '';
  if (check.state === 'verified') return `<span class="status good fm-pill">${icon('check')}Verified, no new charge</span>`;
  if (check.state === 'charged-again') return `<span class="status bad fm-pill">${icon('warn')}Charged again on ${esc(fmtDateShort(check.chargedOn))}</span>`;
  return `<span class="status warn fm-pill">${icon('info')}Waiting for next charge, ${esc(fmtDateShort(check.next))}</span>`;
}

// The cancel sheet

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function transactionCategory(r, transactions) {
  const t = (transactions || []).find((x) => Number(x.amount) > 0 && x.category && subs.sameMerchant(x.name, r.name));
  return t ? String(t.category).toUpperCase() : String(r.category || '').toUpperCase();
}

function openCancelSheet(r, ctx) {
  const g = subs.guideOrFallback(titleCase(r.name), ctx.guide);
  const habit = g.fallback && HABIT_CATEGORIES.has(transactionCategory(r, ctx.transactions));
  const title = g.fallback ? titleCase(r.name) : g.name;
  const plan = store.getPlan();

  const dlg = openSheet('');
  const body = dlg.querySelector('.sheet-body');

  function paint() {
    const rec = subs.getCancelled(r.id);
    const check = rec ? subs.cancelCheck(rec, ctx.transactions, { fetchedAt: ctx.bank.fetchedAt }) : null;
    body.innerHTML = `<div class="fm-sheet">${rec ? watchHtml(r, g, title, rec, check, plan) : guideHtml(r, g, title, habit)}</div>`;
    bind(rec, check);
  }

  function bind(rec, check) {
    body.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
    body.querySelector('[data-act="cancelled"]')?.addEventListener('click', () => {
      subs.markCancelled(r);
      const fn = store.recordSubscriptionCancelled;
      // A habit is not a subscription, so it does not go in the history as one.
      if (!habit && typeof fn === 'function') {
        try { fn({ name: titleCase(r.name), monthly: Number(r.monthly) || 0 }); } catch (e) { console.error(e); }
      }
      toast(habit ? 'Got it. We will watch your bank.' : 'Marked as cancelled. We will watch your bank.');
      paint();
      ctx.redraw();
    });
    body.querySelector('[data-act="undo"]')?.addEventListener('click', () => {
      subs.unmarkCancelled(r.id);
      paint();
      ctx.redraw();
    });
    body.querySelector('[data-act="skip"]')?.addEventListener('click', () => {
      subs.skipAhead(r.id);
      paint();
      ctx.redraw();
    });
  }

  paint();
  return dlg;
}

function stepsHtml(g) {
  return g.steps && g.steps.length ? `<ol class="fm-steps">${g.steps.map((t) => `<li><span>${esc(t)}</span></li>`).join('')}</ol>` : '';
}

function sourceHtml(g) {
  if (!g.source) return '';
  const more = (g.moreSources || []).map((u) => ` and <a class="fm-src" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(host(u))}</a>`).join('');
  const when = g.checked ? `, checked ${esc(fmtDate(g.checked))}` : '';
  return `<p class="tiny mt-s">Source: <a class="fm-src" href="${esc(g.source)}" target="_blank" rel="noopener noreferrer">${esc(host(g.source))}</a>${more}${when}.</p>`;
}

function headsHtml(g) {
  if (!g.heads_up) return '';
  return `<div class="fm-heads"><div class="fm-heads-title">${icon('warn')}Heads up</div><p>${esc(g.heads_up)}</p></div>`;
}

function linkLabel(g, title) {
  if (g.urlKind === 'direct') return `Open the ${esc(title)} cancel page`;
  if (g.urlKind === 'help') return `Open the official ${esc(title)} cancel guide`;
  return 'Search how to cancel it';
}

function guideHtml(r, g, title, habit) {
  const top = `<div class="fm-top"><span class="card-title">${habit ? 'Cut it' : 'How to cancel'}</span><button class="text-btn muted" type="button" data-close>Close</button></div>
    <h2>${esc(title)}</h2>
    <p class="muted">${money(r.monthly, { cents: true })} a month. Stop it and the wedding keeps that money.</p>`;
  if (habit) {
    return `${top}
      <p class="mt">This looks like something you buy, not a subscription, so there is nothing to cancel. If you cut back, we will watch your bank to see if the charges stop.</p>
      <div class="fm-stack">
        <button class="btn" type="button" data-act="cancelled">I stopped it</button>
        <button class="btn secondary" type="button" data-close>Not yet</button>
      </div>`;
  }
  const how = g.fallback
    ? `<p class="mt">${esc(g.text)}</p>`
    : stepsHtml(g);
  return `${top}
    <a class="btn secondary block mt" href="${esc(g.cancelUrl)}" target="_blank" rel="noopener noreferrer">${linkLabel(g, title)} ${icon('arrow')}</a>
    ${how}
    ${headsHtml(g)}
    ${sourceHtml(g)}
    <p class="callout mt">Padrino can't cancel it for you yet. You cancel on their site, then tap the button below. After that we watch your bank and tell you if the charge stops.</p>
    <div class="fm-stack">
      <button class="btn" type="button" data-act="cancelled">I cancelled it</button>
      <button class="btn secondary" type="button" data-close>Not yet</button>
    </div>`;
}

function watchHtml(r, g, title, rec, check, plan) {
  let state = '';
  if (check.state === 'verified') {
    state = `<span class="status good">${icon('check')}Verified</span>
      <p>No charge since you cancelled on ${esc(fmtDate(rec.cancelledOn))}, and the next charge date has passed. That money stays with the wedding.</p>`;
  } else if (check.state === 'charged-again') {
    state = `<span class="status bad">${icon('warn')}Charged again</span>
      <p>${money(check.amount, { cents: true })} came through on ${esc(fmtDate(check.chargedOn))}, after you cancelled.${check.soon ? ' If you cancelled close to your billing date, this may be the last one. Check again next month.' : ''}</p>
      <p>Open the cancel page again and make sure the last step went through.</p>`;
  } else {
    state = `<span class="status warn">${icon('info')}Waiting for the next charge date</span>
      <p>${check.days >= 0
        ? `The next charge is due ${esc(fmtDate(check.next))}. If it does not show up in your bank, we will mark this verified.`
        : `The next charge was due ${esc(fmtDate(check.next))}. We are waiting for your bank to catch up, then we will mark this verified.`}</p>`;
  }
  const again = check.state === 'charged-again' && !g.fallback
    ? `<a class="btn secondary block mt" href="${esc(g.cancelUrl)}" target="_blank" rel="noopener noreferrer">${linkLabel(g, title)} ${icon('arrow')}</a>`
    : '';
  const how = !g.fallback && g.steps && g.steps.length
    ? `<details class="more"><summary>See the steps again</summary>${stepsHtml(g)}${headsHtml(g)}${sourceHtml(g)}</details>`
    : '';
  const skip = check.state === 'waiting' && plan && plan.demo
    ? `<button class="text-btn muted" type="button" data-act="skip">Demo shortcut: skip ahead to the next charge date</button>`
    : '';
  return `<div class="fm-top"><span class="card-title">Cancelled</span><button class="text-btn muted" type="button" data-close>Close</button></div>
    <h2>${esc(title)}</h2>
    <p class="muted">${money(r.monthly, { cents: true })} a month. You said you cancelled on ${esc(fmtDate(rec.cancelledOn))}.</p>
    <div class="fm-state">${state}</div>
    ${again}
    ${how}
    <div class="fm-stack fm-center">
      <button class="btn" type="button" data-close>Done</button>
      ${skip}
      <button class="text-btn muted" type="button" data-act="undo">I did not cancel it after all</button>
    </div>`;
}

function titleCase(s) {
  const t = String(s || '');
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function connectHandler(root) {
  return async (e) => {
    const btn = e.currentTarget;
    const status = root.querySelector('#bank-status');
    btn.disabled = true;
    status.textContent = 'Connecting.';
    try {
      const data = await connectBank();
      if (!data) { btn.disabled = false; status.textContent = 'Nothing came back from the bank yet.'; }
    } catch (err) {
      btn.disabled = false;
      status.textContent = err.message || 'Could not connect.';
    }
  };
}
