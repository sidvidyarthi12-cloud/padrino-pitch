// The plus flow. One place to put money in or out: a quote, a vendor you paid, money from
// family, a cancelled subscription, anything else. The whole flow is one input: snap or
// upload a photo, or type or paste it in plain words. The kind chips under it are optional
// hints that ride along to /api/intake as kindHint; with no chip, Gemini decides. Then one
// confirm card, already filled in, and one Save. Filling it in by hand is there for people
// who want it, never the path you are pushed into.
//
// Store functions this screen calls are being added by another builder, so every call
// is guarded: if one is missing yet, the couple sees a polite note instead of an error.

import * as store from '../store.js';
import { money, esc, todayISO, relative } from '../format.js';
import { icon, toast } from '../ui.js';
import { prefillQuote, errorBlock, shrinkImage } from './quotes.js';
import { prefillContract } from './contract.js';

const KINDS = {
  quote: { label: 'A quote', short: 'A quote', icon: 'quote' },
  contract: { label: 'A contract', short: 'A contract', icon: 'planning' },
  payment: { label: 'I paid a vendor', short: 'Paid a vendor', icon: 'payments' },
  family_money: { label: 'Family gave money', short: 'Family money', icon: 'family' },
  subscription_cancelled: { label: 'I cancelled a subscription', short: 'Cancelled a subscription', icon: 'find' },
  expense: { label: 'Something else', short: 'Something else', icon: 'other' }
};
const CHIP_ORDER = ['quote', 'contract', 'payment', 'family_money', 'subscription_cancelled', 'expense'];

// Kept while the screen is open so a re-render (the plan changed) does not lose typing.
let state = fresh();
function fresh() {
  return { step: 'ask', kindHint: null, text: '', image: null, preview: null, guess: null, manual: false, error: null, lineId: null, linkedFrom: null };
}

export const selfUpdating = true;

export async function render(root, { navigate }) {
  const plan = store.getPlan();
  const q = query();

  // Deep links from Today's next steps land on the confirm card with what the plan already knows.
  if (q.kind === 'subscription_cancelled') { navigate('/find-money'); return; }
  if (q.kind && q.kind !== state.linkedFrom) {
    state = fresh();
    state.linkedFrom = q.kind;
    if (q.kind === 'quote') {
      state.kindHint = 'quote';
      state.lineId = q.lineId || null;
    } else if (KINDS[q.kind]) {
      state.step = 'confirm';
      state.guess = { kind: q.kind, paymentId: q.paymentId || null, pledgeId: q.pledgeId || null, lineId: q.lineId || null, ...guessFromPlan(plan, q) };
    }
  }
  if (!q.kind) state.linkedFrom = null;

  root.innerHTML = `<div class="add-screen" id="add-screen"></div>`;
  paint(root.querySelector('#add-screen'), plan, navigate);
  return () => { if (state.step !== 'reading') state = fresh(); };
}

function paint(box, plan, navigate) {
  if (state.step === 'reading') return paintReading(box);
  if (state.step === 'confirm') return paintConfirm(box, plan, navigate);
  return paintAsk(box, plan, navigate);
}

// Step 1: what happened? One input, optional chips.

function paintAsk(box, plan, navigate) {
  const hint = state.kindHint;
  const line = state.lineId ? plan.lines.find((l) => l.id === state.lineId) : null;
  const forLine = line ? ' for the ' + esc(shortItem(line.item).toLowerCase()) : '';
  const placeholder = hint === 'quote' ? `Paste the quote${forLine} here`
    : hint === 'contract' ? 'Paste the contract, or snap the pages'
    : hint === 'payment' ? 'Paid the photographer $640 today'
      : hint === 'family_money' ? 'Tio Javier sent $450 for the cake'
        : hint === 'subscription_cancelled' ? 'Cancelled Netflix, $15.49 a month'
          : hint === 'expense' ? 'Davids Bridal, $350 for shoes and the veil'
            : 'Mom and Dad sent $500 for the venue';
  box.innerHTML = `
    <header class="add-head">
      <h1>What happened?</h1>
      <button class="icon-btn add-close" type="button" id="add-close" aria-label="Close">${icon('close')}</button>
    </header>
    ${state.error ? errorBlock(state.error) : ''}
    <form class="smart" id="smart-form">
      <label class="sr-only" for="smart-text">Tell us what happened</label>
      <textarea id="smart-text" name="text" rows="2" placeholder="${placeholder}">${esc(state.text)}</textarea>
      ${state.preview ? `<div class="smart-photo"><img src="${state.preview}" alt="Your photo"><button class="text-btn muted" type="button" id="clear-photo">Remove photo</button></div>` : ''}
      <div class="smart-tools">
        <input type="file" id="smart-file" accept="image/*" capture="environment" class="sr-only">
        <label class="smart-cam" for="smart-file">${icon('camera')}<span>${state.preview ? 'Another photo' : 'Snap or upload'}</span></label>
        ${hint ? `<span class="smart-hint">${icon(KINDS[hint].icon)}${esc(KINDS[hint].short)}${forLine}</span>` : ''}
        <span class="grow"></span>
        <button class="smart-go" type="submit" aria-label="Go">${icon('arrow')}</button>
      </div>
    </form>

    <div class="hint-chips" role="group" aria-label="What kind of thing is this (optional)">
      ${CHIP_ORDER.map((k) => `<button type="button" class="kind-chip" aria-pressed="${k === hint}" data-kind="${k}">${icon(KINDS[k].icon)}${esc(KINDS[k].label)}</button>`).join('')}
    </div>

    <p class="tiny mt add-foot">
      ${hint === 'quote'
        ? `Paste the quote or snap it. Or <button class="text-btn" type="button" id="see-example">see an example</button> of one decoded.`
        : hint === 'contract'
          ? `Paste it or snap the pages. We read what you would owe if you cancel, and what to ask before you sign.`
        : hint
          ? `Tagged. Type or snap it and we fill in the rest.`
          : `Type it, paste an email, or snap a receipt or a quote. A tag is optional; we work out what it is.`}
      <span class="add-foot-sep">·</span>
      <button class="text-btn muted" type="button" id="manual">Fill it in myself</button>
    </p>`;

  const form = box.querySelector('#smart-form');
  const ta = box.querySelector('#smart-text');
  ta.addEventListener('input', () => { state.text = ta.value; autoGrow(ta); });
  autoGrow(ta);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
  box.querySelector('#add-close').addEventListener('click', () => { state = fresh(); navigate('/home'); });

  box.querySelector('#smart-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const { dataUrl, base64 } = await shrinkImage(file);
      state.image = { mediaType: 'image/jpeg', data: base64 };
      state.preview = dataUrl;
      state.error = null;
    } catch (err) {
      console.error(err);
      state.error = { message: 'Could not read that photo. Try another one.' };
    }
    paintAsk(box, plan, navigate);
  });
  box.querySelector('#clear-photo')?.addEventListener('click', () => { state.image = null; state.preview = null; paintAsk(box, plan, navigate); });

  box.querySelector('#see-example')?.addEventListener('click', () => {
    prefillQuote({ sample: true, lineId: state.lineId });
    state = fresh();
    navigate('/quotes');
  });

  // Chips attach to the input as a hint. Tap again to take it off.
  box.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.kind;
    state.kindHint = state.kindHint === k ? null : k;
    state.error = null;
    paintAsk(box, plan, navigate);
    box.querySelector('#smart-text').focus();
  }));

  // The exception: a blank card for people who want to type it in themselves.
  box.querySelector('#manual').addEventListener('click', () => {
    const k = state.kindHint && state.kindHint !== 'quote' && state.kindHint !== 'contract' ? state.kindHint : 'payment';
    state.manual = true;
    state.guess = blankGuess(k);
    state.step = 'confirm';
    paintConfirm(box, plan, navigate);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text && !state.image) { toast('Type what happened, or add a photo'); ta.focus(); return; }
    state.text = text;
    if (state.kindHint === 'quote') { handToQuotes(navigate); return; }
    if (state.kindHint === 'contract') { handToContract(navigate); return; }
    readIntake(box, plan, navigate);
  });

  if (hint) ta.focus();
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(220, Math.max(56, ta.scrollHeight)) + 'px';
}

function blankGuess(kind) {
  return { kind, amount: null, who: '', date: todayISO(), lineId: null, paymentId: null, pledgeId: null, summary: '' };
}

// Step 2: reading

function paintReading(box) {
  box.innerHTML = `
    <header class="add-head"><h1>What happened?</h1></header>
    <div class="loading"><span class="spinner" aria-hidden="true"></span><span>${state.image ? 'Reading the photo. This can take up to 20 seconds.' : 'Working out what that is.'}</span></div>`;
}

async function readIntake(box, plan, navigate) {
  state.step = 'reading'; state.error = null;
  paintReading(box);
  const payload = { context: intakeContext(plan) };
  if (state.kindHint) payload.kindHint = state.kindHint;
  if (state.image) payload.image = state.image;
  if (state.text) payload.text = state.text;
  try {
    const res = await fetch('api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.status === 404) {
      state.step = 'ask';
      state.error = { code: 'no_route' };
      return paintAsk(box, plan, navigate);
    }
    if (!res.ok || !data) {
      state.step = 'ask';
      state.error = { status: res.status, code: data?.error || data?.code, message: data?.message };
      return paintAsk(box, plan, navigate);
    }
    // A chip the couple picked wins over the model's guess about the kind. The rest comes from the model.
    let kind = state.kindHint || data.kind;
    if (!KINDS[kind]) kind = kind === 'income' ? 'family_money' : 'expense';
    state.guess = { ...data, kind, date: data.date || todayISO() };
    state.manual = false;
    checkPaymentInstructions(data);
    if (kind === 'quote') { handToQuotes(navigate); return; }
    if (kind === 'contract') { handToContract(navigate); return; }
    state.step = 'confirm';
    paintConfirm(box, plan, navigate);
  } catch {
    state.step = 'ask';
    state.error = { code: 'network' };
    paintAsk(box, plan, navigate);
  }
}

// A document with payment details in it goes through the fraud check: if this vendor's bank or handle
// changed since last time, an alert lands on Today and Payments before any money moves.
function checkPaymentInstructions(data) {
  const pi = data?.paymentInstructions;
  if (!pi || typeof store.notePaymentInstructions !== 'function') return;
  const vendor = data.who || data.vendor || '';
  if (!vendor) return;
  try {
    const r = store.notePaymentInstructions(vendor, pi);
    if (r?.changed) toast(`${vendor} changed how to pay. Call them on a number you already had before you pay.`, 5000);
  } catch (e) { console.error(e); }
}

// What we hand Gemini so it can match ids: budget lines, open payments, pledges. Nothing else.
function intakeContext(plan) {
  return {
    lines: plan.lines.filter((l) => l.id !== 'cushion').map(({ id, item, category, vendor }) => ({ id, item, category, vendor })),
    payments: plan.payments.filter((p) => p.status !== 'paid').map(({ id, label, amount, dueDate, lineId, status }) => ({ id, label, amount, dueDate, lineId, status })),
    pledges: plan.pledges.map(({ id, name, item, amount, received }) => ({ id, name, item, amount, received }))
  };
}

function handToQuotes(navigate) {
  prefillQuote({ text: state.text, image: state.image, preview: state.preview, lineId: state.lineId || state.guess?.lineId || null });
  state = fresh();
  navigate('/quotes');
}

// A contract goes to the contract check, which reads it right away.
function handToContract(navigate) {
  prefillContract({ text: state.text, image: state.image, preview: state.preview });
  state = fresh();
  navigate('/contract');
}

// Step 3: one confirm card, already filled in, everything editable, one Save.

function paintConfirm(box, plan, navigate) {
  const g = state.guess || {};
  const kind = g.kind;
  const due = plan.payments.filter((p) => p.status !== 'paid');
  const lines = plan.lines.filter((l) => l.id !== 'cushion');
  const lineOpts = (sel) => `<option value="">Not sure</option>${lines.map((l) => `<option value="${esc(l.id)}" ${l.id === sel ? 'selected' : ''}>${esc(shortItem(l.item))}</option>`).join('')}`;
  const amountField = (label) => `<label class="field"><span>${label}</span><div class="money-input"><input name="amount" type="number" inputmode="decimal" min="0" step="0.01" required value="${g.amount != null ? esc(g.amount) : ''}" placeholder="0"></div></label>`;
  const dateField = (label) => `<label class="field"><span>${label}</span><input name="date" type="date" value="${esc(g.date || todayISO())}" required></label>`;

  let fields = '';
  let note = '';
  if (kind === 'payment') {
    const knownPay = due.find((p) => p.id === g.paymentId);
    fields = `
      <label class="field"><span>Which payment</span>
        <select name="paymentId" id="pay-pick">
          ${due.map((p) => `<option value="${esc(p.id)}" ${p.id === g.paymentId ? 'selected' : ''}>${esc(p.label)}, ${money(p.amount)}, due ${esc(relative(p.dueDate))}</option>`).join('')}
          <option value="" ${!knownPay ? 'selected' : ''}>A payment that is not on the list</option>
        </select>
      </label>
      <div class="field-row">${amountField('Amount you paid')}${dateField('When')}</div>
      <label class="field"><span>Who you paid</span><input name="who" type="text" value="${esc(g.who || '')}" placeholder="Sample Photography"></label>
      <label class="field"><span>Budget line</span><select name="lineId">${lineOpts(g.lineId || knownPay?.lineId)}</select></label>`;
    note = 'It shows as waiting until your bank confirms the money left.';
  } else if (kind === 'family_money') {
    const known = plan.pledges.find((f) => f.id === g.pledgeId);
    fields = `
      <label class="field"><span>Who gave it</span>
        <select name="pledgeId" id="pledge-pick">
          ${plan.pledges.map((f) => `<option value="${esc(f.id)}" ${f.id === g.pledgeId ? 'selected' : ''}>${esc(f.name)}${f.item ? ', ' + esc(shortItem(f.item).toLowerCase()) : ''}</option>`).join('')}
          <option value="" ${!known ? 'selected' : ''}>Someone new</option>
        </select>
      </label>
      <label class="field" id="name-field" ${known ? 'hidden' : ''}><span>Their name</span><input name="name" type="text" value="${esc(known ? '' : (g.who || ''))}" placeholder="Tia Rosa"></label>
      <div class="field-row">${amountField('Amount')}${dateField('When')}</div>
      <label class="field"><span>What it is for</span><select name="lineId">${lineOpts(g.lineId || known?.lineId)}</select></label>`;
    note = 'It shows as waiting until your bank shows the money coming in.';
  } else if (kind === 'subscription_cancelled') {
    fields = `
      <label class="field"><span>What you cancelled</span><input name="who" type="text" required value="${esc(g.who || '')}" placeholder="Netflix"></label>
      <div class="field-row">${amountField('It cost, a month')}${dateField('Cancelled on')}</div>`;
    note = 'Find money checks your bank that the charge really stopped, and that money can go toward the wedding.';
  } else {
    fields = `
      <div class="field-row">${amountField('Amount')}${dateField('When')}</div>
      <label class="field"><span>Where or who</span><input name="who" type="text" value="${esc(g.who || '')}" placeholder="Davids Bridal"></label>
      <label class="field"><span>Budget line</span><select name="lineId">${lineOpts(g.lineId)}</select></label>
      <label class="field"><span>A note, if you want</span><input name="note" type="text" value="${esc(g.note || g.summary || '')}" placeholder="Shoes and the veil"></label>`;
  }

  box.innerHTML = `
    <header class="add-head">
      <button class="icon-btn add-back" type="button" id="add-back" aria-label="Back">${icon('back')}</button>
      <h1>${state.manual ? 'Fill it in' : 'Here is what we got'}</h1>
      <button class="icon-btn add-close" type="button" id="add-close" aria-label="Close">${icon('close')}</button>
    </header>
    <section class="card confirm-card">
      ${g.summary && !state.manual ? `<p class="confirm-sum">${esc(g.summary)}${g.confidence === 'low' ? ' <span class="mark warn-text">best guess</span>' : ''}</p>` : ''}
      <div class="kind-chips" role="radiogroup" aria-label="What kind of thing this is">
        ${CHIP_ORDER.map((k) => `<button type="button" class="kind-chip" role="radio" aria-checked="${k === kind}" data-chip="${k}">${icon(KINDS[k].icon)}${esc(KINDS[k].short)}</button>`).join('')}
      </div>
      <form id="confirm-form" class="mt">
        ${fields}
        <button class="btn block lg mt-s" type="submit">Save</button>
      </form>
      <div class="confirm-foot">
        ${note ? `<p class="tiny">${esc(note)}</p>` : '<span></span>'}
        ${state.manual ? '' : `<button class="text-btn muted" type="button" id="manual">Fill it in myself</button>`}
      </div>
    </section>`;

  box.querySelector('#add-close').addEventListener('click', () => { state = fresh(); navigate('/home'); });
  box.querySelector('#add-back').addEventListener('click', () => { state.step = 'ask'; paintAsk(box, plan, navigate); });
  box.querySelector('#manual')?.addEventListener('click', () => {
    state.manual = true;
    state.guess = blankGuess(kind);
    paintConfirm(box, plan, navigate);
  });
  box.querySelectorAll('[data-chip]').forEach((c) => c.addEventListener('click', () => {
    const k = c.dataset.chip;
    if (k === 'quote') {
      if (state.text || state.image) { handToQuotes(navigate); return; }
      state.kindHint = 'quote'; state.step = 'ask'; paintAsk(box, plan, navigate); return;
    }
    if (k === 'contract') {
      if (state.text || state.image) { handToContract(navigate); return; }
      state.kindHint = 'contract'; state.step = 'ask'; paintAsk(box, plan, navigate); return;
    }
    state.guess = { ...g, kind: k };
    paintConfirm(box, plan, navigate);
  }));
  box.querySelector('#pledge-pick')?.addEventListener('change', (e) => {
    const nameField = box.querySelector('#name-field');
    if (nameField) nameField.hidden = Boolean(e.target.value);
  });
  box.querySelector('#pay-pick')?.addEventListener('change', (e) => {
    const p = due.find((x) => x.id === e.target.value);
    const f = box.querySelector('#confirm-form');
    if (p) {
      if (!f.amount.value) f.amount.value = p.amount;
      if (p.lineId) f.lineId.value = p.lineId;
    }
  });

  box.querySelector('#confirm-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const amount = Number(f.amount?.value) || 0;
    if (amount <= 0) { toast('Put in the amount first'); f.amount?.focus(); return; }
    const date = f.date?.value || todayISO();
    const lineId = f.lineId?.value || null;
    const who = f.who?.value.trim() || null;
    if (kind === 'payment') {
      const ok = call('recordPayment', { paymentId: f.paymentId.value || null, lineId, amount, date, who });
      if (ok !== null) { toast('Saved. We will tick it when your bank shows it.'); finish(navigate, '/payments'); }
    } else if (kind === 'family_money') {
      const pledge = plan.pledges.find((x) => x.id === f.pledgeId.value);
      const name = pledge ? pledge.name : (f.name.value.trim() || 'Family');
      const item = lineId ? shortItem(plan.lines.find((l) => l.id === lineId)?.item || '') : (pledge?.item || '');
      const ok = call('recordFamilyMoney', { pledgeId: pledge ? pledge.id : null, name, amount, date, item });
      if (ok !== null) { toast(`Saved. ${name} is in the plan.`); finish(navigate, '/family'); }
    } else if (kind === 'subscription_cancelled') {
      // Recorded if the store has it; either way Find money is where that subscription lives now.
      const name = who || 'A subscription';
      if (typeof store.recordSubscriptionCancelled === 'function') {
        try { store.recordSubscriptionCancelled({ name, monthly: amount }); } catch (err) { console.error(err); }
      }
      toast(`${name} cancelled. Find money checks it stopped.`, 3200);
      finish(navigate, '/find-money');
    } else {
      const ok = call('recordExpense', { lineId, amount, date, who, note: f.note?.value.trim() || null });
      if (ok !== null) { toast('Saved to the plan'); finish(navigate, '/payments'); }
    }
  });
}

function finish(navigate, path) {
  state = fresh();
  navigate(path);
}

// Calls a store function if it exists. Returns null (and says so) when it is not there yet.
function call(name, ...args) {
  if (typeof store[name] !== 'function') {
    toast('That part of the app is still being finished. Try again in a minute.', 3600);
    return null;
  }
  try { return store[name](...args) ?? true; } catch (e) { console.error(e); toast('Could not save that'); return null; }
}

// For a deep link, fill what the plan already knows: the payment's amount and vendor, the pledge's name.
function guessFromPlan(plan, q) {
  const out = { amount: null, who: '', date: todayISO(), summary: '' };
  if (q.paymentId) {
    const p = plan.payments.find((x) => x.id === q.paymentId);
    if (p) {
      const line = plan.lines.find((l) => l.id === p.lineId);
      out.amount = p.amount; out.who = line?.vendor || ''; out.lineId = p.lineId || null;
      out.summary = `${p.label}, due ${relative(p.dueDate)}.`;
    }
  }
  if (q.pledgeId) {
    const f = plan.pledges.find((x) => x.id === q.pledgeId);
    if (f) {
      out.who = f.name; out.lineId = f.lineId || null;
      out.amount = Math.max(0, (Number(f.amount) || 0) - (Number(f.received) || 0)) || null;
      out.summary = `${f.name} promised ${money(f.amount)}${f.item ? ' for the ' + shortItem(f.item).toLowerCase() : ''}.`;
    }
  }
  return out;
}

function query() {
  const raw = (location.hash || '').split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(raw));
}

function shortItem(s) { return String(s || '').split(/\s[\/(]|\s-\s/)[0].trim(); }
