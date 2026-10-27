// Quotes: paste text or snap a photo. The server reads it and returns terms.
// money.js turns the terms into a true total. This screen only shows the result.

import { getPlan, addQuoteToPlan } from '../store.js';
import { getTemplate, getSampleQuote } from '../data.js';
import { computeQuote, summary, scheduleFromQuote } from '../calc.js';
import { money, pct, esc, fmtDate, num } from '../format.js';
import { icon, toast } from '../ui.js';
import { openThreadWith } from './thread.js';
import { vendorIdFor } from './vendors.js';

const MAX_SIDE = 1568;

// Kept across re-renders so a result is not lost when the plan changes.
let state = freshState();
function freshState(template) {
  return { mode: 'idle', text: '', image: null, preview: null, decoded: null, error: null, sample: false, lineId: null, saved: null, pickedDates: {}, template, auto: null };
}

// The plus flow hands a quote here. With text or a photo it decodes on arrival;
// with sample: true it opens the example straight away.
export function prefillQuote({ text = '', image = null, preview = null, lineId = null, sample = false } = {}) {
  state = freshState(state.template);
  state.text = text || '';
  state.image = image || null;
  state.preview = preview || null;
  state.lineId = lineId || null;
  state.auto = sample ? 'sample' : (text || image) ? 'decode' : null;
}

export async function render(root, { navigate }) {
  const plan = getPlan();
  if (!state.template) state.template = await getTemplate().catch(() => []);
  root.innerHTML = `
    <header class="screen-head" data-color="marigold">
      <p class="eyebrow">Quotes · Read before you sign</p>
      <h1>Quotes</h1>
      <p class="lede">Paste a quote or snap a photo. We show what it really costs once the extras are in.</p>
    </header>
    <div id="quote-body"></div>`;
  const body = root.querySelector('#quote-body');
  const auto = state.auto;
  state.auto = null;
  if (auto === 'sample') { loadExample(body, plan, navigate); return; }
  if (auto === 'decode') { decode(body, plan, navigate); return; }
  paint(body, plan, navigate);
}

function paint(body, plan, navigate) {
  if (state.mode === 'loading') return paintLoading(body);
  if (state.mode === 'result') return paintResult(body, plan, navigate);
  return paintInput(body, plan, navigate);
}

// Input

function paintInput(body, plan, navigate) {
  const past = plan.quotes || [];
  body.innerHTML = `
    ${state.error ? errorBlock(state.error) : ''}
    <form id="quote-form">
      <label class="field"><span>Paste the quote or the email</span>
        <textarea name="text" placeholder="Sunset Hall: dinner buffet $45 per guest, bar package $22 per guest, 22% service charge, 50% deposit at signing, balance 30 days before.">${esc(state.text)}</textarea>
      </label>
      <div class="drop">
        <input type="file" id="photo" accept="image/*" capture="environment">
        ${state.preview ? `<img class="thumb" src="${state.preview}" alt="Your quote photo">` : ''}
        <div class="row mt-s" style="justify-content:center">
          <label class="btn secondary sm" for="photo">${icon('camera')} ${state.preview ? 'Use a different photo' : 'Or take a photo'}</label>
          ${state.preview ? `<button class="text-btn muted" type="button" id="clear-photo">Remove</button>` : ''}
        </div>
      </div>
      <div class="row between mt">
        <button class="text-btn" type="button" id="see-example">See an example</button>
        <button class="btn" type="submit" id="decode">Read this quote</button>
      </div>
    </form>

    ${past.length ? `
    <section class="section">
      <div class="section-head"><h2 class="section-title">In your plan</h2></div>
      <div class="table">
        ${past.map((q) => `<button type="button" class="tr" data-quote="${esc(q.id)}">
          <div class="td-main"><div class="td-name">${esc(q.vendor)}</div><div class="td-sub">${esc(q.category || '')}${q.createdAt ? ', added ' + fmtDate(q.createdAt) : ''}</div></div>
          <div class="td-num"><span class="tiny">View</span></div></button>`).join('')}
      </div>
    </section>` : ''}

    <p class="callout mt-l">Most quotes leave out the service charge, tax on that charge, vendor meals and overtime. We add them back.</p>`;

  const form = body.querySelector('#quote-form');
  const textarea = form.querySelector('textarea');
  textarea.addEventListener('input', () => { state.text = textarea.value; });

  form.querySelector('#photo').addEventListener('change', async (e) => {
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
    paintInput(body, plan, navigate);
  });
  body.querySelector('#clear-photo')?.addEventListener('click', () => {
    state.image = null; state.preview = null; paintInput(body, plan, navigate);
  });

  body.querySelector('#see-example').addEventListener('click', () => loadExample(body, plan, navigate));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text && !state.image) { toast('Paste a quote or add a photo first'); return; }
    state.text = text;
    decode(body, plan, navigate);
  });

  body.querySelectorAll('[data-quote]').forEach((btn) => btn.addEventListener('click', () => {
    const q = (plan.quotes || []).find((x) => x.id === btn.dataset.quote);
    if (!q) return;
    state.decoded = q.decoded; state.mode = 'result'; state.sample = false; state.lineId = q.decoded?.lineId || null; state.saved = q.id; state.pickedDates = {};
    paintResult(body, plan, navigate);
  }));
}

// Loads the labeled example so the screen works without an API key.
async function loadExample(body, plan, navigate) {
  const keepLine = state.lineId;
  state.mode = 'loading'; state.sample = true; state.error = null; state.saved = null; state.lineId = keepLine; state.pickedDates = {};
  paintLoading(body, 'Loading the example.');
  try {
    state.decoded = await getSampleQuote();
    state.mode = 'result';
    paintResult(body, plan, navigate);
  } catch {
    state.mode = 'idle';
    state.error = { message: 'The example file is missing: /data/sample-quote-decoded.json' };
    paintInput(body, plan, navigate);
  }
}

// Sends the text or photo to the server and shows the result or one clear error.
async function decode(body, plan, navigate) {
  const keepLine = state.lineId;
  state.mode = 'loading'; state.sample = false; state.error = null; state.saved = null; state.lineId = keepLine; state.pickedDates = {};
  paintLoading(body, state.image ? 'Reading the photo. This can take up to 20 seconds.' : 'Reading the quote. A few seconds.');
  const payload = { guests: Number(plan.couple.guests) || 0 };
  if (state.image) payload.image = state.image; else payload.text = state.text;
  try {
    const res = await fetch('api/decode-quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.ok && data) {
      state.decoded = data; state.mode = 'result';
      paintResult(body, plan, navigate);
    } else {
      state.mode = 'idle';
      state.error = { status: res.status, code: data?.error || data?.code, message: data?.message };
      paintInput(body, plan, navigate);
    }
  } catch {
    state.mode = 'idle';
    state.error = { code: 'network' };
    paintInput(body, plan, navigate);
  }
}

// One calm, specific message per failure. The plus flow uses the same block.
export function errorBlock(err) {
  const code = err.code;
  let title; let text;
  if (code === 'no_key' || err.status === 503) {
    title = 'Reading is not switched on';
    text = 'Add GEMINI_API_KEY to app/.env and restart the server. Until then, See an example walks through a decoded quote.';
  } else if (err.status === 422 || code === 'not_a_quote') {
    title = 'That does not look like a vendor quote';
    text = 'Paste the part with prices, or take a clearer photo with the numbers in frame.';
  } else if (code === 'busy' || code === 'rate_limited') {
    title = 'The reader is busy';
    text = 'Give it a few seconds and try again.';
  } else if (code === 'bad_key') {
    title = 'The API key is not valid';
    text = 'Check GEMINI_API_KEY in app/.env and restart the server.';
  } else if (code === 'intake_failed') {
    title = 'Could not work out what that was';
    text = 'Try plainer words with the amount in them, or a clearer photo. You can also fill it in yourself.';
  } else if (code === 'no_route') {
    title = 'The smart input is not on yet';
    text = 'The server needs a restart to pick it up. Tap one of the tiles below and fill it in by hand for now.';
  } else if (code === 'timeout') {
    title = 'That took too long';
    text = 'Try a smaller photo, or paste the text of the quote instead.';
  } else if (code === 'decode_failed') {
    title = 'Could not read that quote';
    text = 'Paste the text instead of the photo, or crop the photo to the price list.';
  } else if (code === 'network') {
    title = 'Could not reach the server';
    text = 'Is node server.mjs running?';
  } else {
    title = 'That did not work';
    text = err.message || 'Try again.';
  }
  return `<div class="callout mb" style="border-left-color:var(--bad)"><strong>${esc(title)}.</strong> ${esc(text)}</div>`;
}

function paintLoading(body, text) {
  body.innerHTML = `<div class="loading"><span class="spinner" aria-hidden="true"></span><span>${esc(text || 'Reading the quote.')}</span></div>`;
}

// Result

function paintResult(body, plan, navigate) {
  const decoded = state.decoded || {};
  const guests = Number(plan.couple.guests) || 0;
  const taxRate = Number(plan.settings?.taxRate) || 0;
  let computed;
  try {
    computed = computeQuote(decoded, { guests, taxRate });
  } catch (err) {
    console.error(err);
    body.innerHTML = `<p class="callout" style="border-left-color:var(--bad)"><strong>Could not total this quote.</strong> ${esc(err.message)}</p>
      <button class="btn secondary mt" type="button" id="back">Back</button>`;
    body.querySelector('#back').addEventListener('click', () => { state.mode = 'idle'; paintInput(body, plan, navigate); });
    return;
  }

  const lineChoices = plan.lines.filter((l) => l.id !== 'cushion');
  if (!state.lineId) {
    const hinted = decoded.lineId && lineChoices.find((l) => l.id === decoded.lineId);
    state.lineId = hinted?.id || bestLine(decoded, lineChoices)?.id || lineChoices[0]?.id || null;
  }
  const line = plan.lines.find((l) => l.id === state.lineId);

  // What it does to the budget: the same summary function, on a copy with this quote committed.
  let before = null; let after = null;
  try {
    const template = state.template || [];
    before = summary(plan, template);
    const trial = structuredClone(plan);
    const tl = trial.lines.find((l) => l.id === state.lineId);
    if (tl) tl.committed = computed.trueTotal;
    after = summary(trial, template);
  } catch (err) { console.error(err); }

  let sched = { payments: [], warnings: [], unscheduled: 0 };
  try { sched = scheduleFromQuote(computed, decoded, plan.couple.weddingDate); } catch (err) { console.error(err); }
  const schedule = sched.payments.map((p, i) => ({ ...p, dueDate: p.dueDate || state.pickedDates[i] || null, idx: i }));
  const undated = schedule.filter((p) => !p.dueDate).length;

  const base = computed.lines.filter((l) => !l.added);
  const added = computed.lines.filter((l) => l.added);

  const baseShare = computed.trueTotal > 0 ? (computed.headline / computed.trueTotal) * 100 : 100;
  const certainExtra = computed.trueTotal > 0 ? (Math.max(0, computed.added - computed.estimatedExtras) / computed.trueTotal) * 100 : 0;
  const estExtra = computed.trueTotal > 0 ? (computed.estimatedExtras / computed.trueTotal) * 100 : 0;
  const addedWord = computed.addedPct >= 25 ? 'a lot more than it says' : computed.addedPct >= 10 ? 'more than it says' : computed.addedPct > 0 ? 'a little more than it says' : 'what it says';

  body.innerHTML = `
    ${state.sample ? `<p class="eyebrow">Example, fictional vendor</p>` : ''}
    <section class="card" style="margin-top:8px">
      <div class="card-head"><span class="card-title">${esc(decoded.vendor || 'Quote')}</span><span class="status ${computed.addedPct >= 10 ? 'warn' : 'good'}">${icon(computed.addedPct >= 10 ? 'warn' : 'check')}${esc(addedWord)}</span></div>
      <div class="answer">${money(computed.trueTotal)}</div>
      <div class="answer-sub">what it really costs, for ${num(guests)} guests</div>
      <div class="stack mt" role="img" aria-label="Quoted price against hidden costs">
        <span class="s-base" style="width:${baseShare}%"></span>
        ${certainExtra > 0 ? `<span class="s-extra" style="width:${certainExtra}%"></span>` : ''}
        ${estExtra > 0 ? `<span class="s-extra est" style="width:${estExtra}%"></span>` : ''}
      </div>
      <div class="legend"><span><i style="background:var(--accent)"></i>what they quoted</span><span><i style="background:var(--bad)"></i>charges and tax</span>${estExtra > 0 ? `<span><i style="background:repeating-linear-gradient(135deg,var(--bad) 0 3px,var(--bad-tint) 3px 5px)"></i>our estimate</span>` : ''}</div>
      ${added.length ? `<ul class="extras">${added.map((l) => `<li><span>${esc(l.label)}${l.estimated ? ' <span class="mark accent">estimate</span>' : ''}</span><span>${l.amount == null ? 'ask' : money(l.amount)}</span></li>`).join('')}</ul>` : ''}
      ${computed.unpriced.length ? `<p class="tiny mt-s bad-text">No price on the quote for ${computed.unpriced.map(esc).join(', ')}. Ask.</p>` : ''}
      ${decoded.vendor ? `<div class="talk-row"><button class="btn secondary sm" type="button" id="talk">${icon('chat')} Talk to this vendor</button><span class="tiny">We draft the questions from this quote.</span></div>` : ''}
      <details class="more">
        <summary>Line by line</summary>
        <div class="table">
          ${base.map(quoteLine).join('')}
          ${added.length ? `<div class="tr head"><div class="td-main">What the quote left out</div><div class="td-num"></div></div>` : ''}
          ${added.map(quoteLine).join('')}
          <div class="tr total"><div class="td-main"><div class="td-name">True total</div><div class="td-sub">${money(computed.contractTotal)} on the contract, ${money(computed.estimatedExtras)} estimated</div></div><div class="td-num"><div class="num-main">${money(computed.trueTotal)}</div></div></div>
        </div>
        ${computed.notes.map((n) => `<p class="tiny mt-s">${esc(n)}</p>`).join('')}
        ${taxRate ? `<p class="tiny mt-s">Tax at ${pct(taxRate, 2)}.</p>` : ''}
      </details>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="section-title">What it does to your budget</h2></div>
      <label class="field"><span>Budget line for this quote</span>
        <select id="line-pick">${lineChoices.map((l) => `<option value="${esc(l.id)}" ${l.id === state.lineId ? 'selected' : ''}>${esc(l.item)}, ${money(l.planned)} planned</option>`).join('')}</select>
      </label>
      ${before && after ? `
      <div class="card" style="margin-top:4px">
        <div class="card-head"><span class="card-title">If you sign this</span><span class="status ${Number(after.overBy) > 0 ? 'bad' : 'good'}">${icon(Number(after.overBy) > 0 ? 'warn' : 'check')}${Number(after.overBy) > 0 ? 'Over by ' + money(after.overBy) : 'Still on track'}</span></div>
        <div class="fillbar tall ${computed.trueTotal > (line?.planned || 0) ? 'bad' : 'good'}" role="img" aria-label="This quote against what you planned for the line"><span style="width:${Math.max(0, Math.min(100, (line?.planned || 0) > 0 ? ((line.planned) / Math.max(computed.trueTotal, line.planned)) * 100 : 0))}%"></span></div>
        <div class="bar-ends"><span>what you planned for ${esc(String(line?.item || 'this').split(/\s[\/(]|\s-\s/)[0])}</span><span>${computed.trueTotal > (line?.planned || 0) ? 'this quote costs more' : 'this quote fits'}</span></div>
      </div>` : ''}
    </section>

    ${(decoded.vague || []).length ? `
    <section class="section">
      <div class="section-head"><h2 class="section-title">Pin these down</h2></div>
      ${decoded.vague.map((v) => `<div class="qa"><div class="term">"${esc(v.term)}"</div><div class="ask">${esc(v.ask)}</div></div>`).join('')}
    </section>` : ''}

    ${(decoded.questions || []).length ? `
    <section class="section">
      <div class="section-head"><h2 class="section-title">Ask before you sign</h2></div>
      <ul class="plain-list">${decoded.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2 class="section-title">Payment schedule</h2></div>
      ${(decoded.schedule || []).length ? '' : '<p class="section-text">The quote does not say when money is due. Ask.</p>'}
      ${schedule.length ? `
        <div class="table">${schedule.map((p) => `<div class="tr">
          <div class="td-main"><div class="td-name">${esc(p.label || 'Payment')}${p.pct != null ? ` <span class="mark">${esc(String(p.pct))}%</span>` : ''}</div>
            <div class="td-sub">${p.rule ? esc(p.rule) + '. ' : ''}${p.dueDate ? fmtDate(p.dueDate) : `<label>Pick a date <input type="date" data-date-for="${p.idx}" value="${esc(state.pickedDates[p.idx] || '')}" style="min-height:34px;padding:4px 8px;width:auto;display:inline-block;margin-left:6px"></label>`}</div></div>
          <div class="td-num"><div class="num-main">${money(p.amount)}</div></div></div>`).join('')}</div>
        ${Number(sched.unscheduled) > 0 ? `<p class="tiny mt-s">${money(sched.unscheduled)} of the bill has no date on the quote.</p>` : ''}
        ${sched.warnings.map((w) => `<p class="tiny mt-s">${esc(w)}</p>`).join('')}` : ''}
      ${decoded.cancellation ? `<p class="callout mt"><strong>If you cancel:</strong> ${esc(decoded.cancellation)}</p>` : ''}
    </section>

    <div class="row between mt-l">
      <button class="btn secondary" type="button" id="back">Another quote</button>
      ${state.saved ? `<span class="mark good">In your plan</span>` : `<button class="btn lg" type="button" id="add" ${undated ? 'disabled' : ''}>Add to plan</button>`}
    </div>
    ${undated && !state.saved ? `<p class="tiny right mt-s">Pick a date for each payment first.</p>` : ''}`;

  body.querySelector('#talk')?.addEventListener('click', () => {
    // Opens (or starts) the thread with this vendor. The decoded quote rides along so the
    // negotiator chips work even before the quote is added to the plan.
    openThreadWith({ name: decoded.vendor, category: decoded.category || '', decoded });
    navigate('/thread/' + encodeURIComponent(vendorIdFor(decoded.vendor)));
  });
  body.querySelector('#line-pick').addEventListener('change', (e) => { state.lineId = e.target.value; paintResult(body, plan, navigate); });
  body.querySelectorAll('[data-date-for]').forEach((inp) => inp.addEventListener('change', () => {
    state.pickedDates[Number(inp.dataset.dateFor)] = inp.value;
    paintResult(body, plan, navigate);
  }));
  body.querySelector('#back').addEventListener('click', () => { state.mode = 'idle'; state.saved = null; state.sample = false; state.pickedDates = {}; paintInput(body, plan, navigate); });
  body.querySelector('#add')?.addEventListener('click', () => {
    const payments = schedule.map(({ idx, needsDate, ...p }) => p);
    addQuoteToPlan({ decoded, lineId: state.lineId, trueTotal: computed.trueTotal, payments });
    state = freshState(state.template);
    toast(`Added to the plan with ${payments.length} ${payments.length === 1 ? 'payment' : 'payments'}`);
    navigate('/payments');
  });
}

function quoteLine(l) {
  // The label already says what the line is; only a discount needs a word, and only when there is no note.
  const kind = l.kind === 'discount' && !l.note ? 'Discount' : '';
  const subs = [kind, l.note].filter(Boolean);
  return `<div class="tr">
    <div class="td-main"><div class="td-name">${esc(l.label)} ${l.estimated ? '<span class="mark accent">estimate</span>' : ''}</div>
      ${subs.length ? `<div class="td-sub">${subs.map(esc).join('. ')}</div>` : ''}</div>
    <div class="td-num"><div class="num-main ${l.amount == null ? 'muted' : ''}">${l.amount == null ? 'no price' : money(l.amount)}</div></div>
  </div>`;
}

// Best budget line for this quote: same category text, biggest planned amount.
function bestLine(decoded, lines) {
  const cat = String(decoded.category || '').toLowerCase();
  const words = cat.split(/[^a-z]+/).filter((w) => w.length > 3);
  const scored = lines.map((l) => {
    const hay = `${l.category} ${l.item}`.toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score += 2;
    if (cat && l.category && l.category.toLowerCase() === cat) score += 5;
    return { l, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || (b.l.planned || 0) - (a.l.planned || 0));
  return scored[0]?.l || null;
}

// Shrinks a photo to at most 1568px on the long side as JPEG, so the upload is small.
export async function shrinkImage(file) {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { dataUrl, base64: dataUrl.split(',')[1] };
}

function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}
