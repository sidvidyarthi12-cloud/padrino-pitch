// Contract check. Before you sign: what you would owe if you cancelled on any date, date change
// and force majeure in plain words, the headcount guarantee, what the vendor promises, red flags,
// and the questions to ask. The AI reads the document (POST /api/contract). The dollar rows come
// from /lib/contract.js, never from here. Both are guarded: a missing piece shows a polite note.

import * as store from '../store.js';
import { money, esc, fmtDateShort, relative, todayISO, daysUntil, parseDate, num, plural } from '../format.js';
import { icon, toast, openSheet } from '../ui.js';
import { errorBlock, shrinkImage } from './quotes.js';

// A fictional venue contract, so the screen has something to show without an API key. Labeled demo.
const SAMPLE = {
  vendor: 'Sample Hall (demo)', total: 4500, deposit: 1125,
  schedule: [{ label: 'Deposit', rule: '25% at signing' }, { label: 'Second payment', rule: '25% five months before' }, { label: 'Balance', rule: '30 days before' }],
  cancellation: [
    { until: '180 days before', fromDays: null, toDays: 180, keepPct: 25, owe: null, loseDeposit: true, note: 'Deposit is not refunded.' },
    { until: '90 days before', fromDays: 180, toDays: 90, keepPct: 50, owe: null, loseDeposit: true, note: '' },
    { until: 'the wedding day', fromDays: 90, toDays: 0, keepPct: 100, owe: null, loseDeposit: true, note: '' }
  ],
  dateChange: 'One date change is free if the new date is within 12 months and the hall is open that day. A second change costs $250.',
  forceMajeure: 'If a storm, a public health order or a power failure makes the hall unusable, you can move the date at no cost. Money paid is not refunded, only moved.',
  headcount: { guaranteeDue: '14 days before', minimum: 100 },
  vendorPromises: ['The hall from 2 PM to midnight, with setup from noon.', 'Tables, chairs and white linens for up to 150 guests.', 'A day-of coordinator for 8 hours.', 'Parking for 60 cars.'],
  missing: ['Who pays for overtime past midnight', 'Whether the cleaning fee is included', 'What happens if the hall double books'],
  redFlags: ['The balance is due 30 days before, earlier than most venues ask.', 'The minimum of 100 guests is charged even if fewer come.'],
  questions: ['Is the 22% service charge a tip for the staff, or does the hall keep it?', 'What is the overtime rate after midnight?', 'If we move the date once, does our deposit move with it?', 'Can we lower the guest minimum to 80 if we book a weekday?'],
  paymentInstructions: { method: 'check or bank transfer', bankLast4: '4471', handle: null }
};

let state = fresh();
function fresh() {
  return { step: 'ask', text: '', image: null, preview: null, fileName: '', error: null, analysis: null, rows: null, libMissing: false, saved: false };
}

// The plus flow hands a pasted contract or a photo over here.
export function prefillContract({ text = '', image = null, preview = null, fileName = '' } = {}) {
  state = fresh();
  state.text = text || '';
  state.image = image;
  state.preview = preview;
  state.fileName = fileName || '';
}

export const selfUpdating = true;

export async function render(root, { navigate }) {
  const plan = store.getPlan();
  root.innerHTML = `<div id="contract-screen">${scopedStyle()}</div>`;
  const box = root.querySelector('#contract-screen');
  paint(box, plan, navigate);
  if (state.step === 'ask' && (state.text || state.image)) {
    // Came in from the plus flow with something already attached: read it right away.
    read(box, plan, navigate);
  }
  return () => { if (state.step !== 'reading') state = fresh(); };
}

function scopedStyle() {
  return `<style>
    .ct-worst { background: var(--surface); border-color: var(--ink); }
    .ct-worst .big { font-family: var(--font-display); font-size: 1.35rem; line-height: 1.3; margin-top: 2px; }
    .ct-bar { display: flex; gap: 3px; height: 44px; margin-top: 12px; align-items: flex-end; }
    .ct-seg { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; }
    .ct-seg i { display: block; width: 100%; border-radius: 6px 6px 3px 3px; background: var(--accent); min-height: 6px; opacity: 0.9; }
    .ct-seg.low i { background: var(--good); }
    .ct-seg.mid i { background: var(--warn); }
    .ct-seg.high i { background: var(--bad); }
    .ct-seg.now i { outline: 2px solid var(--text); outline-offset: 1px; }
    .ct-labels { display: flex; gap: 3px; margin-top: 8px; }
    .ct-labels span { flex: 1; min-width: 0; font-size: 0.72rem; color: var(--muted); line-height: 1.25; }
    .ct-labels strong { display: block; color: var(--text); font-variant-numeric: tabular-nums; font-size: 0.82rem; }
    .ct-two { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 14px; }
    @media (min-width: 600px) { .ct-two { grid-template-columns: 1fr 1fr; } }
    .ct-two .card { margin: 0; }
    .ct-flag { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-top: 1px solid var(--line); }
    .ct-flag:first-child { border-top: 0; }
    .ct-flag .ic { width: 18px; height: 18px; flex: none; margin-top: 2px; color: var(--bad); }
    .ct-flag.ok .ic { color: var(--good); }
    .ct-flag.miss .ic { color: var(--warn); }
    .ct-q { padding: 10px 0; border-top: 1px solid var(--line); display: grid; grid-template-columns: 1.6em minmax(0, 1fr); gap: 8px; }
    .ct-q:first-child { border-top: 0; }
    .ct-q .n { color: var(--faint); font-variant-numeric: tabular-nums; }
    .ct-file { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 0.9rem; }
    .ct-file img { max-height: 110px; max-width: 50%; border-radius: 10px; display: block; }
    .ct-file .doc { width: 44px; height: 54px; border-radius: 6px; background: var(--plum); display: grid; place-items: center; color: var(--plum-ink); border: 2px solid var(--ink); box-shadow: 2px 2px 0 var(--shadow-ink); flex: none; }
    .ct-saved { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; padding: 12px 0; border-top: 1px solid var(--line); cursor: pointer; }
    .ct-saved:first-child { border-top: 0; }
    .ct-saved .t { font-weight: 600; }
    .ct-saved .s { font-size: 0.8rem; color: var(--muted); }
    .ct-saved .a { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
  </style>`;
}

function paint(box, plan, navigate) {
  if (state.step === 'reading') return paintReading(box);
  if (state.step === 'result') return paintResult(box, plan, navigate);
  return paintAsk(box, plan, navigate);
}

// Ask: paste it, or snap or upload a photo or PDF.

function paintAsk(box, plan, navigate) {
  const saved = safeContracts();
  const style = box.querySelector('style')?.outerHTML || scopedStyle();
  box.innerHTML = `${style}
    <header class="screen-head" data-color="plum">
      <p class="eyebrow">Contract check · Before you sign</p>
      <h1>Contract check</h1>
      <p class="lede">Before you sign, know what you would owe if the day changes.</p>
    </header>
    ${state.error ? errorBlock(state.error) : ''}
    <section class="card">
      <form id="ct-form">
        <label class="field"><span>Paste the contract</span>
          <textarea name="text" id="ct-text" rows="6" placeholder="Paste the whole thing, or the parts about deposits, cancelling and the date.">${esc(state.text)}</textarea>
        </label>
        <div class="row between">
          <div>
            <input type="file" id="ct-file" accept="image/*,application/pdf" class="sr-only">
            <label class="btn secondary sm" for="ct-file">${icon('camera')} Photo or PDF</label>
          </div>
          <button class="btn" type="submit">Check it</button>
        </div>
        ${state.preview ? `<div class="ct-file"><img src="${state.preview}" alt="Your photo"><button class="text-btn muted" type="button" id="ct-clear">Remove</button></div>`
          : state.image ? `<div class="ct-file"><span class="doc">${icon('quote')}</span><span>${esc(state.fileName || 'Your PDF')}</span><button class="text-btn muted" type="button" id="ct-clear">Remove</button></div>` : ''}
      </form>
      <p class="tiny mt">We read it and put the dates and dollars in plain words. We do not give legal advice. For anything big, show it to someone who does. Or <button class="text-btn" type="button" id="ct-example">see an example</button> of a checked contract.</p>
    </section>

    ${saved.length ? `<section class="section">
      <div class="section-head"><h2 class="section-title">Checked before</h2><span class="tiny">${num(saved.length)} ${plural(saved.length, 'contract')}</span></div>
      <div class="card" style="padding:4px 18px">${saved.map((c, i) => `<div class="ct-saved" role="button" tabindex="0" data-saved="${i}">
        <div class="t">${esc(c.vendorName || c.vendor || c.analysis?.vendor || 'Contract')}</div>
        ${c.analysis?.total != null ? `<div class="a">${money(c.analysis.total)}</div>` : '<span></span>'}
        <div class="s">${c.at || c.savedAt || c.createdAt ? 'checked ' + esc(relative(String(c.at || c.savedAt || c.createdAt).slice(0, 10))) : 'saved'}</div>
      </div>`).join('')}</div>
    </section>` : ''}`;

  const ta = box.querySelector('#ct-text');
  ta.addEventListener('input', () => { state.text = ta.value; });
  box.querySelector('#ct-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      if (file.type === 'application/pdf') {
        const data = await readBase64(file);
        state.image = { mediaType: 'application/pdf', data };
        state.preview = null;
        state.fileName = file.name;
      } else {
        const { dataUrl, base64 } = await shrinkImage(file);
        state.image = { mediaType: 'image/jpeg', data: base64 };
        state.preview = dataUrl;
        state.fileName = file.name;
      }
      state.error = null;
    } catch (err) {
      console.error(err);
      state.error = { message: 'Could not read that file. Try a photo of the pages instead.' };
    }
    paintAsk(box, plan, navigate);
  });
  box.querySelector('#ct-clear')?.addEventListener('click', () => { state.image = null; state.preview = null; state.fileName = ''; paintAsk(box, plan, navigate); });
  box.querySelector('#ct-example').addEventListener('click', async () => {
    state = fresh();
    state.analysis = SAMPLE;
    state.saved = true; // an example is never saved as the couple's own contract
    state.example = true;
    state.step = 'result';
    await buildRows(plan);
    paintResult(box, plan, navigate);
  });
  box.querySelector('#ct-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.text = ta.value.trim();
    if (!state.text && !state.image) { toast('Paste the contract or add a photo first'); ta.focus(); return; }
    read(box, plan, navigate);
  });
  box.querySelectorAll('[data-saved]').forEach((row) => {
    const open = async () => {
      const c = saved[Number(row.dataset.saved)];
      if (!c) return;
      state = fresh();
      state.analysis = c.analysis || c;
      state.saved = true;
      state.step = 'result';
      await buildRows(plan);
      paintResult(box, plan, navigate);
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
  });
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function paintReading(box) {
  const style = box.querySelector('style')?.outerHTML || scopedStyle();
  box.innerHTML = `${style}
    <header class="screen-head" data-color="plum"><p class="eyebrow">Contract check · Reading</p><h1>Contract check</h1></header>
    <div class="loading"><span class="spinner" aria-hidden="true"></span><span>${state.image ? 'Reading the pages. This can take up to 30 seconds.' : 'Reading the contract.'}</span></div>`;
}

async function read(box, plan, navigate) {
  state.step = 'reading'; state.error = null;
  paintReading(box);
  const payload = { guests: Number(plan?.couple?.guests) || undefined, weddingDate: plan?.couple?.weddingDate || undefined };
  if (state.text) payload.text = state.text;
  if (state.image) payload.image = state.image;
  try {
    const res = await fetch('api/contract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.status === 404) { state.step = 'ask'; state.error = { code: 'no_route', message: 'The contract reader needs a server restart to switch on.' }; return paintAsk(box, plan, navigate); }
    if (!res.ok || !data) { state.step = 'ask'; state.error = { status: res.status, code: data?.error || data?.code, message: data?.message }; return paintAsk(box, plan, navigate); }
    state.analysis = data.analysis || data;
    state.step = 'result';
    await buildRows(plan);
    save(plan);
    notePaymentInstructions();
    paintResult(box, plan, navigate);
  } catch (e) {
    console.error(e);
    state.step = 'ask'; state.error = { code: 'network' };
    paintAsk(box, plan, navigate);
  }
}

// The dollar rows come from /lib/contract.js: cancellationPlan(analysis, { weddingDate, today, payments })
// returns { rows, current, nextStep, worst, headcount, summary, warnings }. Each row has the window
// (from, to), what the vendor keeps if you cancel then (keep), and plain words (text).
async function buildRows(plan) {
  state.rows = null; state.cplan = null; state.libMissing = false;
  let mod = null;
  try { mod = await import('../../lib/contract.js'); } catch { state.libMissing = true; return; }
  const fn = typeof mod.cancellationPlan === 'function' ? mod.cancellationPlan : null;
  if (!fn) { state.libMissing = true; return; }
  const weddingDate = plan?.couple?.weddingDate || null;
  const today = todayISO();
  const payments = paymentsForVendor(plan, state.analysis?.vendor);
  try {
    const r = fn(state.analysis, { weddingDate, today, ...(payments.length ? { payments } : {}) });
    const rows = Array.isArray(r?.rows) ? r.rows : [];
    state.cplan = r || null;
    state.rows = rows.map(normRow);
    if (!rows.length) state.rows = null;
  } catch (e) { console.error(e); state.libMissing = true; }
}

// The plan's own payments for this vendor, so "what you already paid" is real, not assumed.
function paymentsForVendor(plan, vendor) {
  const key = String(vendor || '').toLowerCase().replace(/\(demo\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!key || !plan) return [];
  const lineIds = new Set((plan.lines || []).filter((l) => {
    const v = String(l.vendor || '').toLowerCase().replace(/\(demo\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
    return v && (v === key || v.includes(key) || key.includes(v));
  }).map((l) => l.id));
  return (plan.payments || []).filter((p) => lineIds.has(p.lineId)).map(({ amount, dueDate, status, paidOn }) => ({ amount, dueDate, status, paidOn }));
}

function normRow(r) {
  return {
    date: r.from || null,
    until: r.to || null,
    label: '',
    owe: num0(r.keep ?? r.owe ?? null),
    text: r.text || '',
    isToday: Boolean(r.isToday),
    pct: null
  };
}
function num0(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// saveContract keeps one check per vendor and runs the payment details through the fraud check too.
function save(plan) {
  if (state.saved) return;
  if (typeof store.saveContract !== 'function') return;
  try {
    const name = state.analysis?.vendor || vendorGuess(plan) || 'Contract';
    const r = store.saveContract(name, state.analysis);
    state.saved = Boolean(r) || true;
    state.paymentCheck = r?.paymentCheck || null;
  } catch (e) { console.error(e); }
}

// Only when the store cannot save (no saveContract yet) do we run the fraud check ourselves.
function notePaymentInstructions() {
  if (state.paymentCheck || typeof store.saveContract === 'function') return;
  const pi = state.analysis?.paymentInstructions;
  if (!pi || typeof store.notePaymentInstructions !== 'function') return;
  try { state.paymentCheck = store.notePaymentInstructions(state.analysis.vendor || 'Vendor', pi); } catch (e) { console.error(e); }
}

function vendorGuess(plan) {
  return (plan?.lines || []).find((l) => l.vendor)?.vendor || '';
}

function safeContracts() {
  if (typeof store.getContracts !== 'function') return [];
  try { const l = store.getContracts(); return Array.isArray(l) ? l.slice().reverse() : []; } catch { return []; }
}

// Result

function paintResult(box, plan, navigate) {
  const a = state.analysis || {};
  const style = box.querySelector('style')?.outerHTML || scopedStyle();
  const vendor = a.vendor || 'This vendor';
  const total = num0(a.total);
  const worst = worstCase(a, total);
  const cancel = Array.isArray(a.cancellation) ? a.cancellation : [];
  const red = list(a.redFlags);
  const promises = list(a.vendorPromises);
  const missing = list(a.missing);
  const questions = list(a.questions);
  const hc = a.headcount || {};
  const days = daysUntil(plan?.couple?.weddingDate);

  box.innerHTML = `${style}
    <header class="screen-head" data-color="plum">
      <p class="eyebrow">Contract check · The read</p>
      <h1>${esc(vendor)}</h1>
      <p class="lede">${total != null ? `${money(total)} in all` : 'No total found'}${a.deposit != null && Number(a.deposit) > 0 ? `, ${money(a.deposit)} of it at signing` : ''}.</p>
      <div class="chips">
        ${state.example ? `<span class="chip dashed">${icon('info')}Example</span>` : state.saved ? `<span class="chip">${icon('check')}Saved</span>` : typeof store.saveContract !== 'function' ? `<span class="chip dashed">${icon('info')}Saving is being wired up</span>` : ''}
        <button class="chip" type="button" id="ct-again">${icon('quote')}Check another</button>
      </div>
    </header>

    <section class="card ct-worst">
      <div class="card-head"><span class="card-title">The worst case</span></div>
      <p class="big">${esc(worst)}</p>
    </section>

    ${state.paymentCheck?.changed ? `<section class="card tint-rose">
      <div class="card-head"><span class="card-title">Before you pay</span><span class="status bad">${icon('warn')}New bank details</span></div>
      <p style="font-family:var(--font-display);font-size:1.2rem;line-height:1.35">${esc(vendor)}'s payment details are different from the ones you had. Call them on a number you already had before you pay.</p>
    </section>` : ''}

    <section class="card">
      <div class="card-head"><span class="card-title">If you cancelled</span><span class="tiny">${days != null && days > 0 ? `${num(days)} days to go` : ''}</span></div>
      ${timelineBar(cancel, total, plan)}
      ${state.cplan?.summary ? `<p class="mt-s">${esc(state.cplan.summary)}</p>` : ''}
      ${state.cplan?.nextStep?.text ? `<p class="tiny mt-s">${esc(state.cplan.nextStep.text)}</p>` : ''}
      ${state.cplan?.paidAssumed ? `<p class="tiny mt-s">What you have paid is assumed from the contract schedule. Add this vendor's payments to the plan and it uses the real amounts.</p>` : ''}
      ${(state.cplan?.warnings || []).map((w) => `<p class="tiny mt-s warn-text">${esc(w)}</p>`).join('')}
      ${state.libMissing ? `<p class="tiny mt">The exact dollar figures land when the math module (lib/contract.js) is in. Until then these are the contract's own words.</p>` : ''}
    </section>

    <div class="ct-two">
      <section class="card">
        <div class="card-head"><span class="card-title">If the date moves</span></div>
        <p>${esc(words(a.dateChange) || 'The contract does not say. Ask before you sign.')}</p>
      </section>
      <section class="card">
        <div class="card-head"><span class="card-title">Storms, illness, shutdowns</span></div>
        <p>${esc(words(a.forceMajeure) || 'No force majeure clause found. Ask what happens if neither of you can hold the day.')}</p>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><span class="card-title">Headcount</span></div>
      <p>${headcountWords(hc, plan)}</p>
    </section>

    ${promises.length ? `<section class="card">
      <div class="card-head"><span class="card-title">What ${esc(vendor)} promises you</span></div>
      ${promises.map((p) => `<div class="ct-flag ok">${icon('check')}<span>${esc(p)}</span></div>`).join('')}
    </section>` : ''}

    ${red.length || missing.length ? `<section class="card">
      <div class="card-head"><span class="card-title">Worth a second look</span><span class="status ${red.length ? 'bad' : 'warn'}">${icon('warn')}${num(red.length + missing.length)}</span></div>
      ${red.map((p) => `<div class="ct-flag">${icon('warn')}<span>${esc(p)}</span></div>`).join('')}
      ${missing.map((p) => `<div class="ct-flag miss">${icon('info')}<span>Not in the contract: ${esc(lowerFirst(p))}</span></div>`).join('')}
    </section>` : ''}

    ${questions.length ? `<section class="card">
      <div class="card-head"><span class="card-title">Ask before you sign</span></div>
      ${questions.map((q, i) => `<div class="ct-q"><span class="n">${i + 1}</span><span>${esc(q)}</span></div>`).join('')}
      <div class="row mt">
        <button class="btn sm" type="button" id="ct-send">Send these to ${esc(vendor)}</button>
        <button class="btn secondary sm" type="button" id="ct-copy">Copy</button>
      </div>
      <p class="tiny mt-s" id="ct-send-note"></p>
    </section>` : ''}

    ${a.paymentInstructions ? `<section class="card tint-sky">
      <div class="card-head"><span class="card-title">How they want to be paid</span></div>
      <p>${esc(payWords(a.paymentInstructions))}</p>
      <p class="tiny mt-s">If these ever change by email, call ${esc(vendor)} on a number you already had before you pay.</p>
    </section>` : ''}

    <p class="tiny mt-l">Plain words from a document reader, not legal advice.</p>`;

  box.querySelector('#ct-again').addEventListener('click', () => { state = fresh(); paintAsk(box, plan, navigate); });
  box.querySelector('#ct-copy')?.addEventListener('click', async () => {
    const text = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not copy'); }
  });
  box.querySelector('#ct-send')?.addEventListener('click', () => sendToThread(vendor, questions, plan, navigate, box.querySelector('#ct-send-note')));
}

// Opens the vendor's thread with the questions as a draft, when that vendor has one.
async function sendToThread(vendor, questions, plan, navigate, noteEl) {
  const vendorId = await findVendorId(vendor);
  if (!vendorId) {
    if (noteEl) noteEl.textContent = `${vendor} does not have a message thread yet. Save them under Vendors first, or copy the questions.`;
    return;
  }
  const text = `Hi ${vendor}, a few questions before we sign:\n` + questions.map((q, i) => `${i + 1}. ${q}`).join('\n') + `\nThank you,\n${coupleNames(plan)}`;
  if (typeof store.addMessage === 'function') {
    try { store.addMessage(vendorId, { from: 'you', text, status: 'draft', channel: 'email', at: new Date().toISOString() }); } catch (e) { console.error(e); }
  }
  navigate(`/thread/${encodeURIComponent(vendorId)}`);
}

async function findVendorId(name) {
  const key = String(name || '').toLowerCase().trim();
  if (!key) return null;
  const same = (v) => String(v?.name || '').toLowerCase().trim() === key || key.includes(String(v?.name || '').toLowerCase().replace(/\s*\(demo\)\s*$/, '').trim());
  if (typeof store.getSavedVendors === 'function') {
    try { const hit = (store.getSavedVendors() || []).find(same); if (hit?.id) return hit.id; } catch { /* ignore */ }
  }
  try {
    const res = await fetch('data/vendors.json');
    if (res.ok) { const list = await res.json(); const hit = (Array.isArray(list) ? list : list?.vendors || []).find(same); if (hit?.id) return hit.id; }
  } catch { /* ignore */ }
  return null;
}

// The bar: one segment per cancellation window, taller and redder the more you would owe.
function timelineBar(cancel, total, plan) {
  const rows = state.rows && state.rows.length ? state.rows : cancel.map((c) => ({ label: c.until || c.rule || c.label || '', owe: num0(c.owe), pct: c.keepPct ?? null, date: c.date || null }));
  if (!rows.length) return `<p class="muted">The contract does not spell out what you owe if you cancel. That is the first question to ask.</p>`;
  const max = Math.max(1, ...rows.map((r) => Number(r.owe) || 0), total || 0);
  const today = parseDate(todayISO());
  return `<div class="ct-bar" role="img" aria-label="What you would owe if you cancelled, from now to the wedding day">
      ${rows.map((r) => {
        const share = r.owe != null ? (r.owe / max) : r.pct != null ? Number(r.pct) / 100 : 0.4;
        const cls = share >= 0.75 ? 'high' : share >= 0.35 ? 'mid' : 'low';
        const now = isNow(r, today, rows);
        return `<div class="ct-seg ${cls} ${now ? 'now' : ''}"><i style="height:${Math.max(14, Math.round(share * 100))}%"></i></div>`;
      }).join('')}
    </div>
    <div class="ct-labels">
      ${rows.map((r) => `<span><strong>${r.owe != null ? money(r.owe) : r.pct != null ? Math.round(Number(r.pct)) + '%' : ''}</strong>${esc(shortRule(r))}</span>`).join('')}
    </div>
    <p class="tiny mt-s">Left is now, right is the wedding day. The outlined bar is where you are today.</p>`;
}

function isNow(r, today, rows) {
  if (r.isToday) return true;
  if (!today) return false;
  const from = parseDate(r.date); const to = parseDate(r.until);
  if (from && to) return today >= from && today < to;
  if (from && !to) return today >= from && rows.indexOf(r) === rows.length - 1;
  return false;
}

function shortRule(r) {
  if (r.label) return String(r.label).replace(/^until\s+/i, 'until ').slice(0, 40);
  if (r.date && r.until) return `${fmtDateShort(r.date)} to ${fmtDateShort(r.until)}`;
  if (r.date) return `from ${fmtDateShort(r.date)}`;
  if (r.until) return `until ${fmtDateShort(r.until)}`;
  return '';
}

function worstCase(a, total) {
  if (state.cplan?.worst?.text) {
    const t = String(state.cplan.worst.text).replace(/^worst case:\s*/i, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const rows = state.rows && state.rows.length ? state.rows : null;
  if (rows) {
    const top = rows.reduce((m, r) => (Number(r.owe) > Number(m?.owe || -1) ? r : m), null);
    if (top && top.owe != null) {
      const all = total != null && top.owe >= total * 0.98;
      return `Cancel ${top.date ? 'after ' + fmtDateShort(top.date) : 'close to the day'} and you owe ${money(top.owe)}${all ? ', the whole thing' : ''}.`;
    }
  }
  const cancel = Array.isArray(a.cancellation) ? a.cancellation : [];
  const last = cancel[cancel.length - 1];
  if (last) {
    const owe = last.owe != null ? (typeof last.owe === 'number' ? money(last.owe) : String(last.owe)) : last.keepPct != null ? `${Math.round(Number(last.keepPct))}% of it` : 'what the contract says';
    return `Cancel ${last.until ? String(last.until).replace(/^until\s+/i, 'after ') : 'late'} and you owe ${owe}.`;
  }
  if (total != null) return `If you cancel and the contract is silent, expect to lose the deposit${a.deposit != null ? ` of ${money(a.deposit)}` : ''}.`;
  return 'The contract does not say what happens if you cancel. Ask before you sign.';
}

function headcountWords(hc, plan) {
  if (state.cplan?.headcount?.text) return esc(state.cplan.headcount.text);
  const parts = [];
  if (hc.guaranteeDue) parts.push(`Your final count is due ${esc(String(hc.guaranteeDue))}.`);
  if (hc.minimum != null && hc.minimum !== '') parts.push(`The minimum is ${esc(String(hc.minimum))} guests${Number(plan?.couple?.guests) && Number(hc.minimum) > Number(plan.couple.guests) ? `, more than the ${num(plan.couple.guests)} you are planning for` : ''}.`);
  if (!parts.length) return 'No headcount guarantee found. Ask when the final count is due and whether there is a minimum.';
  parts.push('After the guarantee date you pay for that many even if fewer come.');
  return parts.join(' ');
}

function payWords(pi) {
  if (typeof pi === 'string') return pi;
  const bits = [];
  if (pi.method) bits.push(String(pi.method));
  if (pi.bankLast4) bits.push(`account ending ${pi.bankLast4}`);
  if (pi.handle) bits.push(String(pi.handle));
  return bits.length ? bits.join(', ') : 'Listed in the contract.';
}

function list(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => typeof x === 'string' ? x : x?.text || x?.label || x?.ask || JSON.stringify(x)).filter(Boolean);
  return [String(v)];
}
function words(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v.summary || v.text || v.plain || v.rule || '';
}
function lowerFirst(s) { const t = String(s || ''); return t ? t.charAt(0).toLowerCase() + t.slice(1) : t; }
function coupleNames(plan) {
  const n = plan?.couple?.names || [];
  return [n[0], n[1]].filter(Boolean).join(' and ') || 'us';
}
