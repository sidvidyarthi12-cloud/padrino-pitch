// Today: the daily dashboard. Names and a countdown, one budget ring, the guest slider,
// your next steps, and the doors into the other tools.
// Every number here comes from money.js through calc.js. This file only draws.

import * as store from '../store.js';
import { getPlan, setGuests, getBankData } from '../store.js';
import { getTemplate, getTemplateById } from '../data.js';
import { summary, guestImpact, paymentTimeline, pledgeSummary } from '../calc.js';
import { cancelCandidates } from '../../lib/bank.js';
import * as subs from '../subs.js';

// Subscriptions that could go, the same way Find money counts them: Plaid sometimes files
// repeat charges as transfers with no merchant, and the couple's own "Stays" choices are honored.
function subsToGo(bank) {
  if (!bank) return [];
  if (typeof subs.splitSubs === 'function') {
    try { return subs.splitSubs(bank.recurring || [], bank.transactions || []).go || []; } catch (e) { console.error(e); }
  }
  try { return cancelCandidates(bank.recurring || []); } catch { return []; }
}
import { money, num, fmtDay, fmtDateShort, daysUntil, relative, esc, names, plural } from '../format.js';
import { icon, ring, setRing, fitRingText, bar, setBar, share, coverPct, coverCaption, toast, bufferCardHtml } from '../ui.js';
import { safeAlerts, alertCard, alertStyle, wireAlerts, safeBuffer } from './payments.js';

export async function render(root, { navigate }) {
  const plan = getPlan();
  const template = await getTemplate().catch(() => []);
  const byId = await getTemplateById().catch(() => new Map());
  const s = summary(plan, template);
  const timeline = safeTimeline(plan);
  const days = daysUntil(plan.couple.weddingDate);
  const guests = Number(plan.couple.guests) || 0;
  const steps = nextSteps(plan, s, timeline, byId).slice(0, 5);
  const verified = verifiedCount(plan);
  const unplanned = safeUnplanned();
  const alerts = safeAlerts();
  const married = days !== null && days < 0;

  root.innerHTML = `${alertStyle()}
    <header class="screen-head" data-color="emerald">
      <p class="eyebrow">${greeting()}, ${esc(names(plan))}</p>
      <h1>${daysLine(days)}</h1>
      <div class="chips">
        ${plan.couple.weddingDate ? `<a class="chip" href="#/setup">${icon('calendar')}${esc(fmtDay(plan.couple.weddingDate))}</a>` : `<a class="chip dashed" href="#/setup">${icon('calendar')}Pick a date</a>`}
        ${plan.couple.city ? `<a class="chip" href="#/setup">${icon('pin')}${esc(plan.couple.city)}</a>` : ''}
        <span class="chip" id="chip-guests">${icon('guests-comfort')}<span id="chip-guests-n">${num(guests)}</span>&nbsp;guests</span>
      </div>
    </header>

    ${alerts.map(alertCard).join('')}

    ${bufferCardHtml(safeBuffer())}

    ${married ? afterCard() : ''}

    <section class="card" id="budget-card" aria-live="polite">
      <div class="card-head"><span class="card-title">Your budget</span><a href="#/budget">See it</a></div>
      <div class="ring-row">
        <div class="ring-wrap">
          ${ring(coverPct(s.available, s.needed), { size: 118, stroke: 11, cls: ringCls(s.overBy, s.needed, s.available), label: 'How much of the wedding your money covers' })}
          <div class="ring-center"><div class="big" id="ring-big">${ringBig(s)}</div><div class="lbl" id="ring-lbl">${ringLbl(s)}</div></div>
        </div>
        <div class="grow">
          <div id="status-pill">${statusPill(s.overBy, s.needed, s.available)}</div>
          <p class="answer-sub mt-s" id="status-text">${statusText(s)}</p>
          ${plan.money.freedMonthly ? `<p class="tiny mt-s">Includes ${money(plan.money.freedMonthly)} a month from subscriptions you cut.</p>` : ''}
          ${Number(s.overBy) > 0 ? `<a class="btn sm mt-s" href="#/fixer" id="fix-link">Close the gap</a>` : ''}
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><span class="card-title">Guests</span><span class="tiny" id="guest-word">your current plan</span></div>
      <div class="answer" id="guest-big">${num(guests)}</div>
      <label class="sr-only" for="guest-slider">Guest count</label>
      <input type="range" id="guest-slider" min="${Math.max(10, Math.round(guests * 0.4))}" max="${Math.max(guests + 40, Math.round(guests * 1.6))}" step="1" value="${guests}" aria-valuetext="${num(guests)} guests">
      <div class="slider-row"><span id="slider-min"></span><span>fewer</span><span>more</span><span id="slider-max"></span></div>
      ${bar(coverPct(s.available, s.needed), { cls: 'mt-s ' + barCls(s.overBy), label: 'How much of the wedding your money covers at this guest count' })}
      <div class="bar-caption" id="cover-cap">${coverCaption(s.available, s.needed)}</div>
      <p class="tiny mt-s" id="gi-note" hidden></p>
      <div class="row mt" id="keep-row" hidden>
        <button class="btn sm" type="button" id="keep-guests">Keep this count</button>
        <button class="text-btn muted" type="button" id="reset-guests">Back to ${num(guests)}</button>
      </div>
    </section>

    ${unplanned.length ? unplannedCard(unplanned[0], unplanned.length, plan) : ''}

    <section class="card">
      <div class="card-head"><span class="card-title">Your next steps</span><span class="tiny">${steps.length ? `${steps.length} to go` : ''}</span></div>
      <div id="steps">
        ${steps.length ? steps.map(stepRow).join('') : `<p class="all-done">Nothing waiting on you today. Enjoy it.</p>`}
      </div>
      ${verified ? `<p class="verified-note">${icon('check')}${num(verified)} ${plural(verified, 'step')} verified by your bank</p>` : ''}
    </section>

    <style>.tile-grid.four { grid-template-columns: repeat(2, minmax(0, 1fr)); } @media (min-width: 600px) { .tile-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); } }</style>
    <div class="tile-grid four">
      <a class="tile sky" href="#/vendors">${icon('store')}<span>Vendors<span class="tile-sub">${vendorsSub(plan)}</span></span></a>
      <a class="tile peach" href="#/find-money">${icon('find')}<span>Find money<span class="tile-sub">${findSub()}</span></span></a>
      <a class="tile sage" href="#/family">${icon('family')}<span>Family<span class="tile-sub">${familySub(plan)}</span></span></a>
      <a class="tile sand" href="#/fixer">${icon('fixer')}<span>Fixer<span class="tile-sub">${Number(s.overBy) > 0 ? 'cuts that close the gap' : 'room if you need it'}</span></span></a>
    </div>`;

  const ringWrap = root.querySelector('#budget-card .ring-wrap');
  fitRingText(ringWrap);

  // Slider: a live what-if. The ring and the bar move with it. The plan only changes on "Keep this count".
  const slider = root.querySelector('#guest-slider');
  root.querySelector('#slider-min').textContent = num(slider.min);
  root.querySelector('#slider-max').textContent = num(slider.max);
  const keepRow = root.querySelector('#keep-row');
  const note = root.querySelector('#gi-note');
  const ringEl = root.querySelector('#budget-card .ring');
  const barEl = root.querySelector('.fillbar');
  let lastImpact = null;
  const setText = (sel, text) => { const n = root.querySelector(sel); if (n) n.textContent = text; };

  function paintState(overBy, needed, available, word) {
    ringEl.setAttribute('class', 'ring ' + ringCls(overBy, needed, available));
    setRing(ringEl, coverPct(available, needed));
    barEl.setAttribute('class', 'fillbar mt-s ' + barCls(overBy));
    setBar(barEl, coverPct(available, needed));
    setText('#cover-cap', coverCaption(available, needed));
    root.querySelector('#status-pill').innerHTML = statusPill(overBy, needed, available);
    setText('#status-text', word);
    const fix = root.querySelector('#fix-link');
    if (fix) fix.hidden = !(Number(overBy) > 0);
  }

  function paint(g) {
    setText('#chip-guests-n', num(g));
    setText('#guest-big', num(g));
    slider.setAttribute('aria-valuetext', num(g) + ' guests');
    const changed = g !== guests;
    keepRow.hidden = !changed;
    note.hidden = true;
    if (!changed) {
      lastImpact = null;
      setText('#guest-word', 'your current plan');
      setText('#ring-big', ringBig(s));
      setText('#ring-lbl', ringLbl(s));
      fitRingText(ringWrap);
      paintState(s.overBy, s.needed, s.available, statusText(s));
      return;
    }
    let im;
    try { im = guestImpact(plan, g, template); } catch (e) { console.error(e); return; }
    lastImpact = im;
    setText('#guest-word', g < guests ? `${num(guests - g)} fewer` : `${num(g - guests)} more`);
    const spare = Number(im.available) - Number(im.needed);
    setText('#ring-big', Number(im.overBy) > 0 ? money(im.overBy) : spare > 0 ? money(spare) : 'fits');
    setText('#ring-lbl', Number(im.overBy) > 0 ? 'over' : spare > 0 ? 'to spare' : 'exactly');
    fitRingText(ringWrap);
    paintState(im.overBy, im.needed, im.available, Number(im.overBy) > 0
      ? `At this count the wedding costs more than you will have.`
      : `At this count the wedding fits inside what you will have.`);
    if (im.hasCommitted) {
      note.hidden = false;
      note.textContent = 'Some of these are already booked. Check what headcount the contract promises before you count on the change.';
    }
  }

  slider.addEventListener('input', () => paint(Number(slider.value)));
  root.querySelector('#reset-guests').addEventListener('click', () => { slider.value = guests; paint(guests); });
  root.querySelector('#keep-guests').addEventListener('click', () => {
    setGuests(Number(slider.value), lastImpact ? lastImpact.scaledLines : []);
    toast('Guest count saved');
  });

  // Next steps: every tap leads somewhere real. A payment or a pledge opens the plus flow
  // filled in; a booking opens it on a quote; the rest open the screen that does the job.
  // A step leaves this list when the thing is actually done (or the bank verified it), not when it is ticked.
  root.querySelectorAll('[data-step]').forEach((row) => {
    const id = row.dataset.step;
    const step = steps.find((x) => x.id === id);
    const go = () => { if (step.href) navigate(step.href.replace(/^#/, '')); };
    row.querySelector('.task-check')?.addEventListener('click', (e) => { e.stopPropagation(); go(); });
    row.querySelector('.task-main').addEventListener('click', go);
  });

  wireAlerts(root);

  // Unplanned spending the bank showed: add it to a line, or say it is not for the wedding.
  const un = root.querySelector('#unplanned');
  if (un) {
    const tx = unplanned[0];
    un.querySelector('[data-un="add"]').addEventListener('click', () => {
      const lineId = un.querySelector('#un-line').value || null;
      if (typeof store.acceptUnplanned !== 'function') { toast('That part of the app is still being finished. Try again in a minute.', 3600); return; }
      try { store.acceptUnplanned(tx.transactionId, lineId); toast('Added to the plan'); } catch (e) { console.error(e); toast('Could not add that'); }
    });
    un.querySelector('[data-un="no"]').addEventListener('click', () => {
      if (typeof store.dismissUnplanned !== 'function') { toast('That part of the app is still being finished. Try again in a minute.', 3600); return; }
      try { store.dismissUnplanned(tx.transactionId); toast('Left out of the wedding'); } catch (e) { console.error(e); toast('Could not do that'); }
    });
  }
}

// ---- after the wedding: the tile shows once the day has passed. The menu always has it.

function afterCard() {
  return `<a class="card tint-sage" href="#/after" style="display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:14px;align-items:center;color:inherit;text-decoration:none">
    <span style="width:48px;height:48px;border-radius:14px;background:var(--surface);color:var(--good);display:grid;place-items:center">${icon('heart')}</span>
    <span><span style="display:block;font-family:var(--font-display);font-size:1.2rem;font-weight:500">After the wedding</span>
      <span class="tiny" style="display:block;margin-top:2px">The name change, the money, insurance, thank-yous. In order, with the official links.</span></span>
    <span class="task-go" aria-hidden="true">${icon('chevron')}</span>
  </a>`;
}

// ---- unplanned spending, from the bank

function safeUnplanned() {
  if (typeof store.getUnplanned !== 'function') return [];
  try { const list = store.getUnplanned(); return Array.isArray(list) ? list : []; } catch (e) { console.error(e); return []; }
}

function unplannedCard(tx, count, plan) {
  const lines = plan.lines.filter((l) => l.id !== 'cushion');
  return `<section class="card tint-sand unplanned" id="unplanned">
    <div class="card-head"><span class="card-title">Is this for the wedding?</span>${count > 1 ? `<span class="tiny">${num(count)} to look at</span>` : ''}</div>
    <div class="un-row">
      <div class="un-merchant">${esc(titleWords(tx.merchant))}</div>
      <div class="un-amt">${money(tx.amount)}</div>
    </div>
    <p class="tiny">${tx.date ? esc(fmtDateShort(tx.date)) + ', ' : ''}seen in your bank, not in the plan</p>
    <label class="field mt"><span>Which part of the wedding</span>
      <select id="un-line">${lines.map((l) => `<option value="${esc(l.id)}" ${l.id === tx.guessLineId ? 'selected' : ''}>${esc(shortItem(l.item))}</option>`).join('')}</select>
    </label>
    <div class="row">
      <button class="btn sm" type="button" data-un="add">Add to the plan</button>
      <button class="btn secondary sm" type="button" data-un="no">Not wedding</button>
    </div>
  </section>`;
}

// Payments the bank has confirmed. They leave the list and get one quiet note instead.
// The history is the live record of what the bank verified; the payment flags are the fallback.
function verifiedCount(plan) {
  if (typeof store.getHistory === 'function') {
    try {
      const list = store.getHistory();
      if (Array.isArray(list)) return list.filter((h) => h.kind === 'payment' && h.status === 'verified' && h.bank).length;
    } catch (e) { console.error(e); }
  }
  return (plan.payments || []).filter((p) => p.status === 'paid' && (p.source === 'bank' || p.verified === true || p.verifiedBy === 'bank')).length;
}

// ---- next steps, built from the plan

function nextSteps(plan, s, timeline, byId) {
  const out = [];
  const guests = Number(plan.couple.guests) || 0;

  // Money due: late first, then the next two. Ticking one opens the plus flow on "I paid a vendor".
  // One you already said you paid shows as waiting until the bank confirms it.
  const payStep = (p, cls) => {
    const waiting = p.status === 'waiting' || (p.status !== 'paid' && p.paidOn && p.source === 'you');
    return { id: 'pay:' + p.id, paymentId: p.id, title: `Pay the ${lower(p.label)}`, sub: money(p.amount), when: waiting ? 'waiting for your bank' : relative(p.dueDate), cls: waiting ? 'wait' : cls, waiting, href: `#/add?kind=payment&paymentId=${encodeURIComponent(p.id)}` };
  };
  for (const p of timeline.overdue.slice(0, 2)) out.push(payStep(p, 'late'));
  for (const p of timeline.payments.filter((x) => x.status !== 'paid' && !x.overdue).slice(0, 2)) {
    if (p.daysUntil != null && p.daysUntil > 60) break;
    out.push(payStep(p, p.dueSoon ? 'soon' : 'money'));
  }

  // Booking: a line with money planned, no vendor, whose usual booking window is here or passed.
  const monthsLeft = Number(s.monthsLeft) || 0;
  const toBook = plan.lines
    .filter((l) => !l.vendor && Number(l.planned) > 0 && byId.get(l.id)?.bookMonthsBefore)
    .map((l) => ({ l, t: byId.get(l.id) }))
    .filter(({ t }) => monthsLeft <= Number(t.bookMonthsBefore) + 1)
    .sort((a, b) => Number(b.t.bookMonthsBefore) - Number(a.t.bookMonthsBefore));
  for (const { l, t } of toBook.slice(0, 2)) {
    const late = monthsLeft < Number(t.bookMonthsBefore);
    out.push({ id: 'book:' + l.id, title: `Book your ${lower(shortItem(l.item))}`, sub: late ? 'most couples have this booked by now' : 'the usual time to book is now', when: late ? 'this week' : 'this month', cls: late ? 'soon' : '', href: `#/add?kind=quote&lineId=${encodeURIComponent(l.id)}` });
  }

  // Family money promised but not in hand yet. Ticking opens "Family gave money" filled in.
  let pledges = { people: [] };
  try { pledges = pledgeSummary(plan); } catch { /* ignore */ }
  for (const f of pledges.people.filter((p) => Number(p.outstanding) > 0).slice(0, 1)) {
    out.push({ id: 'pledge:' + f.id, title: `Check in with ${f.name}`, sub: `about the ${lower(f.item || 'help they offered')}`, when: 'anytime', cls: '', href: `#/add?kind=family_money&pledgeId=${encodeURIComponent(f.id)}` });
  }

  // Subscriptions, once the bank is in.
  const bank = getBankData();
  if (bank) {
    const cand = subsToGo(bank);
    if (cand.length && !plan.money.freedMonthly) out.push({ id: 'subs', title: `Cancel ${num(cand.length)} ${plural(cand.length, 'subscription')} you could live without`, sub: 'the wedding gets that money instead', when: 'quick win', cls: 'money', href: '#/find-money', arrow: true });
  } else {
    out.push({ id: 'bank', title: 'Connect your bank', sub: 'payments get verified on their own', when: 'two minutes', cls: '', href: '#/payments', arrow: true });
  }

  // Quotes in the plan worth a second look.
  for (const q of (plan.quotes || []).slice(0, 1)) {
    out.push({ id: 'quote:' + q.id, title: `Read the ${lower(q.vendor)} quote for hidden costs`, sub: 'service charge, tax, vendor meals', when: 'anytime', cls: '', href: '#/quotes', arrow: true });
  }

  // Lines people forget, still at zero.
  if (s.forgottenOpen.length) {
    const first = plan.lines.find((l) => l.id === s.forgottenOpen[0]);
    if (first) out.push({ id: 'forgot:' + first.id, title: `Put a number on ${lower(shortItem(first.item))}`, sub: 'couples usually forget this one', when: 'anytime', cls: '', href: '#/budget', arrow: true });
  }

  return out;
}

function stepRow(t) {
  const control = t.waiting
    ? `<span class="task-wait" title="Waiting for your bank">${icon('clock')}</span>`
    : t.arrow
      ? `<span class="task-go" aria-hidden="true">${icon('chevron')}</span>`
      : `<button class="task-check" type="button" aria-label="${esc(t.title)}">${icon('check')}</button>`;
  return `<div class="task ${t.waiting ? 'waiting' : ''}" data-step="${esc(t.id)}">
    ${control}
    <div class="task-main"><div class="task-title">${esc(t.title)}</div>
      <div class="task-sub">${t.when ? `<span class="task-when ${esc(t.cls || '')}">${esc(t.when)}</span>` : ''}${t.sub ? `<span>${esc(t.sub)}</span>` : ''}</div></div>
  </div>`;
}

function titleWords(s) {
  return String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// ---- words

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function daysLine(days) {
  if (days === null) return 'Your wedding';
  if (days < 0) return 'Married ' + num(-days) + ' ' + plural(-days, 'day') + ' ago';
  if (days === 0) return 'Today is the day';
  if (days === 1) return 'Tomorrow is the day';
  return num(days) + ' days to go';
}

function ringCls(overBy, needed, available) {
  if (Number(overBy) > 0) return Number(overBy) <= Number(available) * 0.08 ? 'warn' : 'bad';
  return share(needed, available) >= 92 ? 'warn' : 'good';
}
function barCls(overBy) { return Number(overBy) > 0 ? 'bad' : 'good'; }

function statusPill(overBy, needed, available) {
  if (Number(overBy) > 0) {
    const little = Number(overBy) <= Number(available) * 0.08;
    return `<span class="status ${little ? 'warn' : 'bad'}">${icon('warn')}${little ? 'A little over' : 'Over budget'}</span>`;
  }
  if (share(needed, available) >= 92) return `<span class="status warn">${icon('info')}Tight, but on track</span>`;
  return `<span class="status good">${icon('check')}On track</span>`;
}

function statusText(s) {
  if (Number(s.overBy) > 0) return `The wedding needs more than you will have by the day. The fixer can close it.`;
  if (Number(s.gap) > 0) return `The wedding fits inside what you will have, rainy-day money included.`;
  return `The wedding uses exactly what you will have.`;
}

// The one number inside the ring: the gap when over, otherwise how much is still free.
function ringBig(s) {
  if (Number(s.overBy) > 0) return money(s.overBy);
  return Number(s.gap) > 0 ? money(s.gap) : 'fits';
}
function ringLbl(s) {
  if (Number(s.overBy) > 0) return 'over';
  return Number(s.gap) > 0 ? 'to spare' : 'exactly';
}

function findSub() {
  const bank = getBankData();
  if (!bank) return 'connect your bank';
  const freed = Number(getPlan()?.money?.freedMonthly) || 0;
  if (freed) return `${money(freed)} a month going in`;
  const n = subsToGo(bank).length;
  return n ? `${num(n)} ${plural(n, 'subscription')} to stop` : 'nothing to stop';
}

function vendorsSub(plan) {
  const booked = (plan.lines || []).filter((l) => l.vendor).length;
  if (typeof store.getSavedVendors === 'function') {
    try { const saved = store.getSavedVendors(); if (Array.isArray(saved) && saved.length) return `${num(saved.length)} saved`; } catch { /* fine */ }
  }
  return booked ? `${num(booked)} booked, browse more` : 'real El Paso vendors';
}

function familySub(plan) {
  const n = (plan.pledges || []).length;
  if (!n) return 'add a padrino';
  try {
    const ps = pledgeSummary(plan);
    const waiting = ps.people.filter((p) => Number(p.outstanding) > 0).length;
    return waiting ? `${num(waiting)} still to come in` : 'all in';
  } catch { return `${num(n)} ${plural(n, 'person', 'people')}`; }
}

function safeTimeline(plan) {
  try { return paymentTimeline(plan, new Date()); } catch (e) { console.error(e); return { payments: [], nextDue: null, overdue: [], next30: [] }; }
}

function lower(s) { const t = String(s || ''); return t ? t.charAt(0).toLowerCase() + t.slice(1) : t; }
function shortItem(s) { return String(s || '').split(/\s[\/(]|\s-\s/)[0].trim(); }
