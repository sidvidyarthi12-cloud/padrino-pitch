// Payments: a dotted timeline from today to the wedding day, then the list with relative
// dates. Paid ones are ticked. The bank card connects and matches payments on its own.

import * as store from '../store.js';
import { getPlan, getBankData, addPayment, markUnpaid, removePayment } from '../store.js';
import { paymentTimeline } from '../calc.js';
import { refreshBankData, connectBank } from '../bank.js';
import { money, esc, fmtDateShort, relative, todayISO, daysUntil, num, plural } from '../format.js';
import { icon, openSheet, closeSheet, toast, confirmSheet, bufferCardHtml } from '../ui.js';

// The living money check from the store (getBufferCheck), when that part has landed.
export function safeBuffer() {
  if (typeof store.getBufferCheck !== 'function') return null;
  try { const c = store.getBufferCheck(); return c && typeof c === 'object' ? c : null; } catch (e) { console.error(e); return null; }
}

let bankChecked = false;

export async function render(root, { navigate }) {
  const plan = getPlan();
  if (!bankChecked) { bankChecked = true; refreshBankData().catch(() => {}); }
  const bank = getBankData();
  const history = safeHistory();
  const alerts = safeAlerts();

  let t;
  try { t = paymentTimeline(plan); } catch (e) { console.error(e); t = { payments: [], nextDue: null, overdue: [], next30: [], overdueTotal: 0, next30Total: 0, totalScheduled: 0, totalPaid: 0, totalUnpaid: 0 }; }

  const paidCount = t.payments.filter((p) => p.status === 'paid').length;
  const open = t.payments.filter((p) => p.status !== 'paid');
  const lineName = (p) => plan.lines.find((l) => l.id === p.lineId)?.item || '';
  const headline = t.overdue.length ? `${num(t.overdue.length)} ${plural(t.overdue.length, 'payment')} late`
    : t.nextDue ? `Next one ${relative(t.nextDue.dueDate)}`
      : open.length ? 'Nothing due soon' : (t.payments.length ? 'All paid' : 'No payments yet');
  const upcoming = t.overdue[0] || t.nextDue || open[0] || null;
  const rewards = await rewardsBlock(upcoming, plan, bank);

  root.innerHTML = `${alertStyle()}${rewardsStyle()}
    <header class="screen-head" data-color="ocean">
      <p class="eyebrow">Payments · What is due</p>
      <h1>${esc(headline)}</h1>
      <p class="lede">${t.nextDue && !t.overdue.length ? `${esc(t.nextDue.label)}, ${money(t.nextDue.amount)}.` : 'Every deposit and balance on one line to the wedding day.'}</p>
    </header>

    ${alerts.map(alertCard).join('')}

    ${bufferCardHtml(safeBuffer(), { href: '#/step/number' })}

    ${t.payments.length ? `
    <section class="card">
      <div class="card-head"><span class="card-title">On the way to the day</span><span class="status ${t.overdue.length ? 'bad' : 'good'}">${icon(t.overdue.length ? 'warn' : 'check')}${num(paidCount)} of ${num(t.payments.length)} paid</span></div>
      ${timelineHtml(t.payments, plan.couple.weddingDate)}
    </section>

    ${rewards}

    <section class="section">
      <div class="card" style="padding:4px 18px">
        ${t.payments.map((p) => row(p)).join('')}
      </div>
    </section>` : `
    <div class="empty">
      <h2>No payments yet</h2>
      <p>Add a quote and its deposit and balance land here with dates. Or add one by hand.</p>
    </div>`}

    <div class="mt">
      <button class="text-btn" type="button" id="add-payment">Add a payment by hand</button>
    </div>

    <section class="card ${bank ? '' : 'tint-sky'}" id="bank-section">
      ${bank ? bankConnected(bank, plan) : bankEmpty()}
    </section>

    <section class="section" id="history">
      <div class="section-head"><h2 class="section-title">History</h2><span class="tiny">${history.length ? 'what your bank confirmed' : ''}</span></div>
      ${history.length ? `<div class="card" style="padding:4px 18px">${history.map(historyRow).join('')}</div>`
        : `<p class="section-text">${typeof store.getHistory === 'function'
          ? 'Nothing yet. When you pay a vendor or family money comes in, it shows here with what your bank saw.'
          : 'History is being wired up. It will show every payment and every dollar from family, each one checked against your bank.'}</p>`}
    </section>`;

  function row(p) {
    const paid = p.status === 'paid';
    const waiting = p.status === 'waiting' || (!paid && p.paidOn && p.source === 'you');
    const when = paid ? `paid ${relative(p.paidOn || p.dueDate)}${p.source === 'bank' || p.verified ? ', verified by your bank' : ''}`
      : waiting ? 'you paid it, waiting for your bank'
        : p.overdue ? `${relative(p.dueDate)}, late` : relative(p.dueDate);
    const line = shortItem(lineName(p));
    return `<div class="pay ${paid ? 'paid' : waiting ? 'waiting' : p.overdue ? 'overdue' : ''}">
      ${waiting ? `<span class="tick wait" title="Waiting for your bank">${icon('clock')}</span>`
        : `<button class="tick ${paid ? 'on' : ''}" type="button" data-toggle="${esc(p.id)}" aria-label="${paid ? 'Mark unpaid' : 'I paid this'}: ${esc(p.label || 'payment')}" aria-pressed="${paid}">${icon('check')}</button>`}
      <div class="p-main">
        <div class="p-label">${esc(p.label || 'Payment')}</div>
        <div class="p-sub">${line ? esc(line) + ' · ' : ''}${esc(when)}</div>
      </div>
      <div class="p-amt">${money(p.amount)}</div>
      <div class="p-actions"><button class="text-btn muted" type="button" data-remove="${esc(p.id)}">Remove</button></div>
    </div>`;
  }

  // Ticking a due payment opens the plus flow on "I paid a vendor", so the bank can verify it.
  root.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const p = plan.payments.find((x) => x.id === b.dataset.toggle);
    if (!p) return;
    if (p.status === 'paid') markUnpaid(p.id);
    else navigate(`/add?kind=payment&paymentId=${encodeURIComponent(p.id)}`);
  }));
  root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmSheet({ title: 'Remove this payment?', body: 'It comes off the timeline. The budget line stays.', confirmLabel: 'Remove', danger: true });
    if (ok) removePayment(b.dataset.remove);
  }));
  root.querySelector('#add-payment').addEventListener('click', () => openAdd(plan));
  wireAlerts(root);
  root.querySelector('#rw-rates')?.addEventListener('click', () => openRates(() => render(root, { navigate })));

  root.querySelector('#connect-bank')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const status = root.querySelector('#bank-status');
    btn.disabled = true;
    status.textContent = 'Connecting.';
    try {
      const data = await connectBank();
      status.textContent = data ? '' : 'Nothing came back from the bank yet.';
      if (!data) btn.disabled = false;
    } catch (err) {
      btn.disabled = false;
      status.textContent = err.message || 'Could not connect.';
    }
  });
  // The refresh verifies payments and family money on its own and toasts each new one.
  root.querySelector('#sync-bank')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await refreshBankData({ force: true }); } catch { /* keep what we have */ }
    btn.disabled = false;
  });
}

// ---- Fraud warning. A vendor's payment instructions changed (new bank, new account, new handle).
// Shared with Today. Dismissed only after the couple says they called the vendor.

export function safeAlerts() {
  if (typeof store.getAlerts !== 'function') return [];
  try {
    const list = store.getAlerts();
    if (!Array.isArray(list)) return [];
    return list.filter((a) => a && !a.dismissed && !a.dismissedAt
      && (/(instruction|bank|payment|account|handle)/i.test(String(a.kind || a.type || '')) || a.before || a.after));
  } catch (e) { console.error(e); return []; }
}

export function alertStyle() {
  return `<style>
    .fraud .fraud-line { font-family: var(--font-display); font-size: 1.2rem; line-height: 1.35; }
    .fraud .tiny { max-width: 48ch; }
  </style>`;
}

export function alertCard(a) {
  const vendor = a.vendor || a.vendorName || a.who || 'A vendor';
  const after = a.nowWords || payWords(a.after || a.to || a.instructions || a.next);
  const before = payWords(a.before || a.from || a.previous);
  return `<section class="card tint-rose fraud" data-alert="${esc(a.id)}">
    <div class="card-head"><span class="card-title">Before you pay</span><span class="status bad">${icon('warn')}New bank details</span></div>
    <p class="fraud-line">${esc(vendor)} sent new bank details. Call them on a number you already had before you pay.</p>
    ${after ? `<p class="tiny mt-s">New: ${esc(after)}.${before ? ` Before: ${esc(before)}.` : ''}</p>` : ''}
    <p class="tiny mt-s">Scammers copy a vendor's email and change where the money goes. One call to the number on the original contract settles it.</p>
    <div class="row mt"><button class="btn sm" type="button" data-alert-ok="${esc(a.id)}">I called, it checks out</button></div>
  </section>`;
}

export function wireAlerts(root) {
  root.querySelectorAll('[data-alert-ok]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmSheet({ title: 'Did you call them?', body: 'Use the number from the original contract or their website, not the one in the new email.', confirmLabel: 'Yes, it checks out' });
    if (!ok) return;
    if (typeof store.dismissAlert !== 'function') { toast('That part of the app is still being finished. Try again in a minute.', 3600); return; }
    try { store.dismissAlert(b.dataset.alertOk); toast('Noted. Pay as usual.'); } catch (e) { console.error(e); }
    b.closest('[data-alert]')?.remove();
  }));
}

function payWords(pi) {
  if (!pi) return '';
  if (typeof pi === 'string') return pi;
  const bits = [];
  if (pi.method) bits.push(String(pi.method));
  if (pi.bank) bits.push(String(pi.bank));
  if (pi.bankLast4 || pi.last4) bits.push(`account ending ${pi.bankLast4 || pi.last4}`);
  if (pi.handle) bits.push(String(pi.handle));
  return bits.join(', ');
}

// ---- Card rewards. Which card to pay the next vendor payment with, what it gives back, and the
// surcharge that can cancel it out. Cards come from the bank through getCards(); the estimate
// comes from /lib/rewards.js; the facts and their sources from /data/card-facts.json.

function rewardsStyle() {
  return `<style>
    .rw .rw-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 4px; }
    .rw .rw-card { display: flex; align-items: center; gap: 10px; flex: 1 1 180px; min-width: 0; }
    .rw .rw-chip { width: 46px; height: 30px; border-radius: 7px; background: var(--accent); color: var(--accent-ink); border: 2px solid var(--ink); box-shadow: 2px 2px 0 var(--shadow-ink); display: grid; place-items: center; flex: none; }
    .rw .rw-chip .ic { width: 18px; height: 18px; }
    .rw .rw-name { font-weight: 600; }
    .rw .rw-sub { font-size: 0.8rem; color: var(--muted); }
    .rw .rw-back { text-align: right; }
    .rw .rw-back .answer { font-size: 1.6rem; }
    .rw .rw-warn { color: var(--text); margin-top: 10px; }
    .rw details { margin-top: 6px; }
    .rw details summary { list-style: none; cursor: pointer; font-size: 0.85rem; font-weight: 600; color: var(--accent); }
    .rw details summary::-webkit-details-marker { display: none; }
    .rw .fact { padding: 8px 0; border-top: 1px solid var(--line); font-size: 0.86rem; color: var(--muted); }
    .rw .fact a { margin-left: 6px; font-size: 0.8rem; }
  </style>`;
}

function safeCards() {
  if (typeof store.getCards !== 'function') return null;
  try {
    const list = store.getCards();
    if (!Array.isArray(list)) return [];
    // rewardPct is a percent: 2 means 2%.
    return list.map((c) => {
      const raw = c.rewardPct ?? null;
      const pct = raw == null || raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
      return { ...c, id: c.id || c.accountId, name: c.name || 'Credit card', mask: c.mask || '', balance: c.balance, pct, kind: c.rewardKind || 'back' };
    });
  } catch (e) { console.error(e); return []; }
}

let factsCache;
async function loadFacts() {
  if (factsCache !== undefined) return factsCache;
  try {
    const res = await fetch('data/card-facts.json');
    if (!res.ok) { factsCache = null; return null; }
    const data = await res.json();
    const out = [];
    const take = (arr, group) => { for (const f of arr || []) { if (!f) continue; const text = typeof f === 'string' ? f : (f.fact || f.text || f.title || f.note || f.summary); if (text) out.push({ text, group, source: typeof f === 'object' ? (f.source || f.url || f.link || '') : '' }); } };
    if (Array.isArray(data)) take(data, '');
    else if (data && typeof data === 'object') for (const [k, v] of Object.entries(data)) { if (Array.isArray(v)) take(v, k); }
    factsCache = out;
  } catch { factsCache = null; }
  return factsCache;
}

// /lib/rewards.js: rewardsForPayment(amount, cards, { surchargePct }) gives { options, best, worthIt, advice, text,
// warning, bankText }. surchargeFromQuote(decoded) reads a card fee off the vendor's quote when there is one.
async function pickBest(cards, amount, plan, line) {
  let mod = null;
  try { mod = await import('../../lib/rewards.js'); } catch { return { missing: true }; }
  if (typeof mod.rewardsForPayment !== 'function') return { missing: true };
  let surchargePct = 0;
  const quote = line?.quoteId ? (plan.quotes || []).find((q) => q.id === line.quoteId) : null;
  if (quote && typeof mod.surchargeFromQuote === 'function') {
    try { surchargePct = Number(mod.surchargeFromQuote(quote.decoded)) || 0; } catch { surchargePct = 0; }
  }
  try {
    const r = mod.rewardsForPayment(amount, cards, { surchargePct });
    if (!r || typeof r !== 'object') return { missing: true };
    const best = r.best || null;
    const card = best ? (cards.find((c) => c.id === best.cardId) || cards[0]) : null;
    return {
      card, rewards: best ? best.rewards : null, surcharge: best ? best.surcharge : null, surchargePct: surchargePct || null,
      advice: r.advice || 'none', text: r.text || '', warning: r.warning || '', bankText: r.bankText || '', options: r.options || []
    };
  } catch (e) { console.error(e); return { missing: true }; }
}

async function rewardsBlock(p, plan, bank) {
  if (!p) return '';
  const amount = Number(p.amount) || 0;
  const line = plan.lines.find((l) => l.id === p.lineId) || null;
  const vendor = line?.vendor || 'the vendor';
  const cards = safeCards();
  const head = `<div class="card-head"><span class="card-title">Pay with the card that pays you back</span><span class="tiny">${esc(p.label)}, ${money(amount)}</span></div>`;
  if (cards === null) {
    return `<section class="card rw"><div class="card-head"><span class="card-title">Pay with the card that pays you back</span></div><p class="muted">Cards are being wired up. Soon this says which card to pay ${esc(p.label.toLowerCase())} with.</p></section>`;
  }
  if (!cards.length) {
    return `<section class="card rw">${head}<p class="muted">${bank ? 'No credit card showed up in your bank yet.' : 'Connect your bank below and we tell you which card gives the most back on this one.'}</p></section>`;
  }
  const facts = await loadFacts();
  const unrated = cards.filter((c) => c.pct == null);
  const best = await pickBest(cards, amount, plan, line);
  const factsHtml = facts && facts.length ? `<details><summary>Where this comes from</summary>${facts.slice(0, 6).map((f) => `<div class="fact">${esc(f.text)}${f.source ? `<a href="${esc(f.source)}" target="_blank" rel="noopener">source</a>` : ''}</div>`).join('')}</details>` : '';
  const rateBtn = `<button class="text-btn" type="button" id="rw-rates">${unrated.length === cards.length ? 'Tell us what your cards give back' : 'Change reward rates'}</button>`;
  const cardLine = (c) => `<div class="rw-card"><span class="rw-chip">${icon('payments')}</span><div><div class="rw-name">${esc(c.name)}${c.mask ? ' ··' + esc(c.mask) : ''}</div><div class="rw-sub">${c.pct != null ? `${c.pct}% ${esc(c.kind)}${c.rewardSource === 'demo' ? ', a demo rate' : ''}` : 'reward rate not set'}</div></div></div>`;
  if (best.missing) {
    return `<section class="card tint-sage rw">${head}
      <div class="rw-row">${cardLine(cards[0])}</div>
      <p class="rw-warn">${unrated.length === cards.length ? 'Set what each card gives back and we work out which one to use.' : 'The estimate lands when the rewards math (lib/rewards.js) is in.'}</p>
      <p class="tiny mt-s">A card fee from the vendor can cancel the rewards out, and this only pays off if you clear the card in full that month.</p>
      <div class="row mt">${rateBtn}</div>${factsHtml}
    </section>`;
  }
  if (!best.card) {
    // No card comes out ahead: no rate set, the fee eats it, or it does not fit. The lib's own words say which.
    return `<section class="card tint-sage rw">${head}
      <div class="rw-row">${cardLine(cards[0])}</div>
      <p class="rw-warn">${esc(best.text || 'Pay this one from your bank.')}</p>
      ${best.bankText ? `<p class="tiny mt-s">${esc(best.bankText)}</p>` : ''}
      <div class="row mt">${rateBtn}</div>${factsHtml}
    </section>`;
  }
  const c = best.card;
  const fee = best.surcharge;
  const feeWord = fee != null && fee > 0 && best.rewards != null
    ? (fee > best.rewards ? `that is ${money(fee)}, more than the rewards. Pay another way.` : `that is ${money(fee)}, less than the rewards, so the card still wins.`)
    : 'it can wipe the rewards out. Ask before you tap.';
  return `<section class="card tint-sage rw">${head}
    <div class="rw-row">
      ${cardLine(c)}
      ${best.rewards != null ? `<div class="rw-back"><div class="answer">${money(best.rewards, { cents: best.rewards < 100 })}</div><div class="answer-sub">back, about</div></div>` : ''}
    </div>
    <p class="rw-warn">If ${esc(vendor)} adds a card fee${best.surchargePct ? ` of ${best.surchargePct}%` : ''}, ${feeWord}</p>
    <p class="tiny mt-s">${esc(best.warning || 'Only if you pay the card off in full that month. Interest costs more than any points.')}</p>
    <div class="row mt">${rateBtn}</div>${factsHtml}
  </section>`;
}

function openRates(after) {
  const cards = safeCards() || [];
  const dlg = openSheet(`
    <h2>What your cards give back</h2>
    <p class="muted">The percent on everyday spending. It is on the card's page or app. Set once.</p>
    <form id="rates-form" class="mt">
      ${cards.map((c) => `<label class="field"><span>${esc(c.name)}${c.mask ? ' ··' + esc(c.mask) : ''}</span><input name="${esc(c.id)}" type="number" inputmode="decimal" min="0" max="10" step="0.5" value="${c.pct != null ? esc(c.pct) : ''}" placeholder="1.5"></label>`).join('')}
      <div class="row end mt">
        <button class="btn secondary" type="button" data-act="cancel">Cancel</button>
        <button class="btn" type="submit">Save</button>
      </div>
    </form>`);
  dlg.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('#rates-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (typeof store.setCardReward !== 'function') { toast('That part of the app is still being finished. Try again in a minute.', 3600); return; }
    const f = e.target;
    for (const c of cards) {
      const v = f.elements[c.id]?.value;
      if (v === '' || v == null) continue;
      try { store.setCardReward(c.id, Number(v)); } catch (err) { console.error(err); }
    }
    closeSheet();
    toast('Saved');
    if (after) after();
  });
}

// History: every payment and every dollar in, with what the bank said about it.

function safeHistory() {
  if (typeof store.getHistory !== 'function') return [];
  try { const list = store.getHistory(); return Array.isArray(list) ? list : []; } catch (e) { console.error(e); return []; }
}

const KIND_WORD = { payment: 'paid', family: 'from family', quote: 'quote', subscription: 'cancelled', expense: 'spent', income: 'came in' };

function historyRow(h) {
  const inflow = h.kind === 'family' || h.kind === 'income';
  const bank = h.bank;
  // A quote or a note you added yourself has nothing for the bank to confirm; it just sits in the plan.
  const selfOnly = h.status === 'verified' && h.source === 'you' && !bank;
  const badge = selfOnly
    ? `<span class="status neutral">${icon('check')}In your plan</span>`
    : h.status === 'verified'
      ? `<span class="status good">${icon('check')}Verified by your bank</span>`
      : h.status === 'different'
        ? `<span class="status warn">${icon('warn')}Different amount</span>`
        : `<span class="status neutral">${icon('clock')}Waiting for your bank</span>`;
  // Subscriptions carry cents; everything else reads as whole dollars.
  const amt = (n) => money(n, { cents: !Number.isInteger(Number(n)) });
  const bankLine = bank ? `<div class="h-bank">${icon('bank')}<span><strong>${esc(bank.merchant || 'Bank line')}</strong>, ${amt(bank.amount)}${bank.date ? ' on ' + esc(fmtDateShort(bank.date)) : ''}${bank.account ? ` · ${esc(bank.account)}${bank.mask ? ' ··' + esc(bank.mask) : ''}` : ''}</span></div>` : '';
  const when = h.date || h.at;
  const who = h.who && !String(h.title || '').toLowerCase().includes(String(h.who).toLowerCase()) ? h.who : '';
  const sub = [when ? fmtDateShort(when) : '', who, KIND_WORD[h.kind] || ''].filter(Boolean);
  return `<div class="hist">
    <div class="h-main">
      <div class="h-title">${esc(h.title || 'Entry')}</div>
      <div class="h-sub">${sub.map(esc).join(' · ')}</div>
    </div>
    <div class="h-amt ${inflow ? 'good-text' : ''}">${inflow ? '+' : ''}${amt(h.amount)}</div>
    <div class="h-badge">
      ${bank && h.status !== 'waiting' ? `<details class="h-tap"><summary>${badge}</summary>${bankLine}</details>` : badge}
    </div>
    ${h.status === 'different' && h.note ? `<p class="h-note">${esc(h.note)}</p>` : ''}
  </div>`;
}

// Dots on a line from the first payment (or today) to the wedding day.
function timelineHtml(payments, weddingDate) {
  const today = daysUntil(todayISO());
  const dayOf = (iso) => daysUntil(iso);
  const days = payments.map((p) => dayOf(p.dueDate)).filter((d) => d !== null);
  const end = weddingDate ? dayOf(weddingDate) : Math.max(...days, 30);
  const start = Math.min(0, ...days);
  const span = Math.max(1, end - start);
  const x = (d) => Math.max(0, Math.min(100, ((d - start) / span) * 100));
  const paidUpTo = payments.filter((p) => p.status === 'paid').map((p) => dayOf(p.dueDate)).filter((d) => d !== null);
  const doneX = paidUpTo.length ? x(Math.max(...paidUpTo)) : 0;
  return `<div class="timeline" role="img" aria-label="Payments on a line from today to the wedding">
    <div class="tl-line"></div>
    <div class="tl-done" style="width:${doneX}%"></div>
    ${payments.map((p) => { const d = dayOf(p.dueDate); if (d === null) return ''; return `<span class="tl-dot ${p.status === 'paid' ? 'paid' : p.overdue ? 'late' : ''}" style="left:${x(d)}%" title="${esc(p.label)}, ${esc(fmtDateShort(p.dueDate))}"></span>`; }).join('')}
    <span class="tl-dot today" style="left:${x(today)}%" title="Today"></span>
    <span class="tl-lbl start" style="left:0">${start < 0 ? 'earlier' : 'today'}</span>
    <span class="tl-lbl end" style="left:100%">wedding day</span>
    <span class="tl-heart" aria-hidden="true">${icon('heart')}</span>
  </div>`;
}

function bankEmpty() {
  return `
    <div class="nudge"><div class="n-ic">${icon('bank')}</div><div>
      <p><strong>Connect your bank</strong></p>
      <p class="muted mt-s">A payment gets ticked the day it leaves your account. No typing.</p>
    </div></div>
    <div class="row mt">
      <button class="btn" type="button" id="connect-bank">Connect your bank</button>
      <span class="tiny" id="bank-status"></span>
    </div>
    <p class="tiny mt">This demo links a test bank. If a vendor ever emails new bank details, call them on a number you already had before sending anything.</p>`;
}

function bankConnected(bank, plan) {
  const accounts = bank.accounts || [];
  const bankPaid = plan.payments.filter((p) => p.source === 'bank' && p.status === 'paid').length;
  return `
    <div class="card-head"><span class="card-title">Your bank</span><span class="status good">${icon('check')}Connected</span></div>
    <p class="muted">${bankPaid ? `${num(bankPaid)} ${plural(bankPaid, 'payment')} ticked off from your account so far.` : 'Nothing matched yet. Payments get ticked the day they clear.'}</p>
    ${accounts.length ? `<div class="chips">${accounts.map((a) => `<span class="chip">${icon('bank')}${esc(a.name || 'Account')}${a.mask ? ' ··' + esc(a.mask) : ''}</span>`).join('')}</div>` : ''}
    <div class="row mt">
      <button class="btn secondary sm" type="button" id="sync-bank">Check again</button>
      <span class="tiny">${bank.sandbox ? 'Test bank.' : ''}</span>
    </div>`;
}

function openAdd(plan) {
  const dlg = openSheet(`
    <h2>Add a payment</h2>
    <form id="pay-form">
      <label class="field"><span>What is it</span><input name="label" type="text" required placeholder="Photographer deposit"></label>
      <div class="field-row">
        <label class="field"><span>Amount</span><div class="money-input"><input name="amount" type="number" min="0" step="1" required></div></label>
        <label class="field"><span>Due</span><input name="dueDate" type="date" value="${todayISO()}" required></label>
      </div>
      <label class="field"><span>Budget line</span>
        <select name="lineId"><option value="">None</option>${plan.lines.filter((l) => l.id !== 'cushion').map((l) => `<option value="${esc(l.id)}">${esc(shortItem(l.item))}</option>`).join('')}</select>
      </label>
      <div class="row end mt">
        <button class="btn secondary" type="button" data-act="cancel">Cancel</button>
        <button class="btn" type="submit">Add</button>
      </div>
    </form>`);
  dlg.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('#pay-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    addPayment({ label: f.label.value.trim(), amount: Number(f.amount.value) || 0, dueDate: f.dueDate.value, lineId: f.lineId.value || null, source: 'manual' });
    closeSheet();
    toast('Added');
  });
}

function shortItem(s) { return String(s || '').split(/\s[\/(]|\s-\s/)[0].trim(); }
