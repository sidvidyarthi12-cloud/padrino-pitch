// Messages with one vendor, and the negotiator. The thread is a plain chat view. Above the
// composer sit suggestion chips built from what Padrino already knows about this vendor,
// mostly the decoded quote: ask what the service charge covers, ask to waive a fee, ask for
// an off-peak price, ask what is not included. Tapping one asks the server for a short,
// polite draft and drops it into the composer, where the couple can change it before sending.
//
// Sending never pretends. A real vendor with an email gets a mailto link; one with only a
// website or phone gets copy plus open or call. A fictional demo vendor gets a reply that is
// labeled as a demo. Nothing here is ever shown as a real vendor's words.
//
// Store functions (getThread, addMessage, updateMessage) belong to another builder and are
// guarded. Until they land, threads live in a small local fallback so the screen still works.

import * as store from '../store.js';
import { esc, money, pct, uid, timeAgo, names as coupleNames, fmtDate } from '../format.js';
import { icon, toast, openSheet } from '../ui.js';
import { findVendor, vendorIdFor, categoryOf, isDemoVendor, quoteFor, sameVendor, getAvailability, setAvailability, detectAvailability, availabilityBadge, availabilityChip, openAvailabilitySheet } from './vendors.js';

export const selfUpdating = true;

// Composer text is kept per vendor across re-renders, so a store change does not eat a draft.
let state = fresh(null);
function fresh(vendorId) {
  return { vendorId, subject: '', body: '', drafting: null, error: null, lastGoal: null, lastDetails: '', lastChip: null, pendingChip: null, handoff: null };
}

// The quote screen hands a vendor here before navigating, so an unsaved quote still powers the chips.
export function openThreadWith({ name, category = '', decoded = null } = {}) {
  const id = vendorIdFor(name);
  if (state.vendorId !== id) state = fresh(id);
  state.handoff = { name, category, decoded };
}

// The vendor deck hands a question here (usually "are you free on our date") before navigating,
// so the thread opens already writing it.
export function openThreadAsking(vendorId, chip) {
  if (state.vendorId !== vendorId) state = fresh(vendorId);
  state.pendingChip = chip || null;
}

// Thread storage: the store when it is there, a local fallback when it is not yet.

const LOCAL_KEY = 'padrino.threads.local.v1';
function storeReady() { return typeof store.getThread === 'function' && typeof store.addMessage === 'function'; }
function localThreads() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') || {}; } catch { return {}; } }
function saveLocal(all) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(all)); } catch { /* ignore */ } }

function getThread(vendorId) {
  if (storeReady()) { try { return store.getThread(vendorId) || []; } catch (e) { console.error(e); } }
  return localThreads()[vendorId] || [];
}

function addMessage(vendorId, msg) {
  const full = { id: uid('m'), at: new Date().toISOString(), status: 'sent', ...msg };
  if (storeReady()) {
    try {
      const r = store.addMessage(vendorId, full);
      if (typeof r === 'string') return r;
      if (r && typeof r === 'object' && r.id) return r.id;
      return full.id;
    } catch (e) { console.error(e); }
  }
  const all = localThreads();
  all[vendorId] = [...(all[vendorId] || []), full];
  saveLocal(all);
  return full.id;
}

function updateMessage(vendorId, id, patch) {
  if (typeof store.updateMessage === 'function') { try { store.updateMessage(vendorId, id, patch); return; } catch (e) { console.error(e); } }
  const all = localThreads();
  all[vendorId] = (all[vendorId] || []).map((m) => (m.id === id ? { ...m, ...patch } : m));
  saveLocal(all);
}

// Screen

export async function render(root, { plan, navigate, id }) {
  if (state.vendorId !== id) state = fresh(id);
  const vendor = await resolveVendor(id, plan);
  if (!vendor) {
    root.innerHTML = `<header class="screen-head vhead"><a class="icon-btn" href="#/vendors" aria-label="Vendors">${icon('back')}</a><h1>Messages</h1></header>
      <div class="empty"><h2>We could not find that vendor</h2><p>Pick one from the list to start a thread.</p><a class="btn secondary mt" href="#/vendors">Browse vendors</a></div>`;
    return;
  }
  const cat = categoryOf(vendor);
  const demo = isDemoVendor(vendor);
  const quoteRec = quoteFor(plan, vendor);
  // A quote handed over from the quote screen is the one the couple is looking at right now, so it
  // wins over an older one stored in the plan.
  const handed = state.handoff && sameVendor(state.handoff.name, vendor.name) ? state.handoff.decoded : null;
  const decoded = handed || quoteRec?.decoded || null;
  const line = quoteRec ? (plan.lines.find((l) => l.quoteId === quoteRec.id) || plan.lines.find((l) => sameVendor(l.vendor, vendor.name))) : plan.lines.find((l) => sameVendor(l.vendor, vendor.name));
  const ctx = { plan, navigate, vendor, cat, demo, decoded, quoteRec, line };

  root.innerHTML = `<style id="th-style">
    .th-avail { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 0 10px; border-bottom: 1px solid var(--line); font-size: 0.82rem; color: var(--muted); }
    .th-avail .status { padding: 3px 9px; font-size: 0.74rem; }
    .th-avail .status .ic { width: 12px; height: 12px; }
    .th-avail .text-btn { font-size: 0.8rem; }
    </style>
    <header class="screen-head vhead thread-head">
      <a class="icon-btn" href="#/vendors/${encodeURIComponent(vendor.id)}" aria-label="Back to ${esc(vendor.name)}">${icon('back')}</a>
      <div class="grow">
        <h1 class="thread-name">${esc(vendor.name)}</h1>
        <p class="tiny">${esc([cat?.name, vendor.area].filter(Boolean).join(' · ') || 'Vendor')}${demo ? ' · demo vendor' : ''}</p>
      </div>
    </header>
    <div class="th-avail" id="th-avail"></div>
    <div class="thread" id="thread-msgs"></div>
    <section class="negotiator" id="negotiator"></section>
    <div id="composer-box"></div>`;

  paintAvail(root, ctx);
  paintMessages(root, ctx);
  paintChips(root, ctx);
  paintComposer(root, ctx);

  // A question handed over from the vendor deck starts writing itself.
  if (state.pendingChip) { const chip = state.pendingChip; state.pendingChip = null; draft(chip, root, ctx); }

  // A store change (a message added elsewhere, a plan change) redraws the messages, never the composer.
  let count = getThread(vendor.id).length;
  const unsub = store.subscribe(() => {
    const now = getThread(vendor.id).length;
    if (now !== count) { count = now; paintMessages(root, ctx); paintChips(root, ctx); }
  });
  return () => { unsub(); };
}

// The date line under the name: what this vendor said about the wedding date, and a way to set it.
function paintAvail(root, ctx) {
  const box = root.querySelector('#th-avail');
  if (!box) return;
  const date = ctx.plan?.couple?.weddingDate || null;
  const status = getAvailability(ctx.vendor.id, date);
  const when = date ? fmtDate(date) : 'your date';
  box.innerHTML = `
    ${icon('calendar')}<span>${esc(when)}:</span>
    ${status === 'none' ? `<span class="status neutral">Not asked</span>` : availabilityBadge(status)}
    <button class="text-btn" type="button" id="th-set-avail">${status === 'none' ? 'They answered?' : 'Change'}</button>`;
  box.querySelector('#th-set-avail').addEventListener('click', () => openAvailabilitySheet(ctx.vendor, ctx.plan, () => { paintAvail(root, ctx); paintChips(root, ctx); }));
}

// Reads a reply for a yes or no about the date and records it. Returns what it found.
function noteAvailabilityFrom(text, root, ctx) {
  const found = detectAvailability(text);
  if (!found) return null;
  const date = ctx.plan?.couple?.weddingDate || null;
  setAvailability(ctx.vendor.id, found, date);
  paintAvail(root, ctx);
  toast(found === 'free' ? `${ctx.vendor.name} is free on your date. Marked it.` : `${ctx.vendor.name} is booked that day. Marked it.`, 3200);
  return found;
}

async function resolveVendor(id, plan) {
  const known = await findVendor(id);
  if (known) return known;
  if (state.handoff && vendorIdFor(state.handoff.name) === id) {
    return { id, name: state.handoff.name, category: state.handoff.category || '', area: null, email: null, phone: null, website: null, demo: /\(demo\)/i.test(state.handoff.name) };
  }
  const q = (plan.quotes || []).find((x) => vendorIdFor(x.vendor) === id);
  if (q) return { id, name: q.vendor, category: q.category || '', area: null, email: null, phone: null, website: null, demo: /\(demo\)/i.test(q.vendor) };
  return null;
}

// Messages

function paintMessages(root, ctx) {
  const box = root.querySelector('#thread-msgs');
  if (!box) return;
  const msgs = getThread(ctx.vendor.id);
  if (!msgs.length) {
    box.innerHTML = `<div class="thread-empty">
      <p>${ctx.decoded ? 'You have their quote. Pick a question below and we write the first message.' : 'No messages yet. Pick a question below, or write your own.'}</p>
      ${!ctx.demo && !ctx.vendor.email ? `<p class="tiny mt-s">${ctx.vendor.website || ctx.vendor.phone ? 'They do not list an email, so we help you copy the message and open their site or call.' : 'No contact details on file. You can still draft the message here and copy it.'}</p>` : ''}
    </div>`;
    return;
  }
  box.innerHTML = msgs.map((m) => msgHtml(m, ctx)).join('');
  box.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', () => {
    const m = msgs.find((x) => x.id === b.dataset.read);
    if (m) readReply(m.text, ctx);
  }));
  box.querySelectorAll('[data-again]').forEach((b) => b.addEventListener('click', () => {
    const m = msgs.find((x) => x.id === b.dataset.again);
    if (!m) return;
    state.subject = m.subject || ''; state.body = m.text || '';
    paintComposer(root, ctx);
    root.querySelector('#composer textarea')?.focus();
  }));
  const last = box.lastElementChild;
  if (last && msgs.length > 2) last.scrollIntoView({ block: 'nearest' });
}

function msgHtml(m, ctx) {
  if (m.from === 'padrino') return `<div class="msg padrino"><div class="msg-note">${icon('spark')}${esc(m.text)}</div></div>`;
  const vendorDemo = m.from === 'vendor' && (m.channel === 'demo' || m.demo);
  const who = m.from === 'you' ? 'You' : ctx.vendor.name;
  let how = '';
  if (vendorDemo) how = 'demo reply, not a real vendor';
  else if (m.from === 'vendor') how = 'pasted from their reply';
  else if (m.status === 'draft') how = 'draft, not sent';
  else if (m.channel === 'email') how = 'sent by email';
  else if (m.channel === 'copy') how = 'copied to send';
  else if (m.channel === 'demo') how = 'sent (demo)';
  return `<div class="msg ${esc(m.from)} ${vendorDemo ? 'demo' : ''}">
    ${m.subject ? `<div class="msg-subject">${esc(m.subject)}</div>` : ''}
    <div class="msg-bubble">${esc(m.text)}</div>
    <div class="msg-meta">${esc([who, how, timeAgo(m.at)].filter(Boolean).join(' · '))}
      ${m.from === 'vendor' ? ` <button class="text-btn" type="button" data-read="${esc(m.id)}">What changed?</button>` : ''}
      ${m.from === 'you' && m.status === 'draft' ? ` <button class="text-btn" type="button" data-again="${esc(m.id)}">Edit</button>` : ''}
    </div>
  </div>`;
}

// The negotiator: suggestion chips from what Padrino knows.

function suggestions(ctx) {
  const d = ctx.decoded;
  const out = [];
  const seen = new Set();
  const add = (s) => { if (!seen.has(s.label)) { seen.add(s.label); out.push(s); } };
  const lower = (s) => String(s || '').toLowerCase();
  // The date question comes first until they have answered it.
  const availNow = getAvailability(ctx.vendor.id, ctx.plan?.couple?.weddingDate || null);
  if (availNow === 'none') add(availabilityChip(ctx.plan));
  if (d) {
    const charges = Array.isArray(d.charges) ? d.charges : [];
    const service = charges.find((c) => c.kind === 'service');
    if (service) {
      const rate = service.rate != null ? pct(service.rate) + ' ' : '';
      add({ goal: 'clarify_charge', label: `Ask if the ${rate}${lower(service.label) || 'service charge'} includes the tip`, details: `Ask whether the ${rate}${service.label || 'service charge'} is the staff gratuity or whether a separate tip is expected, and what the charge covers.` });
    }
    const blob = lower(JSON.stringify([d.questions || [], d.vague || [], d.items || [], charges]));
    if (/cake[- ]cutting/.test(blob)) add({ goal: 'waive_fee', label: 'Ask them to waive the cake cutting fee', details: 'the cake cutting fee' });
    if (blob.includes('corkage')) add({ goal: 'waive_fee', label: 'Ask them to waive the corkage fee', details: 'the corkage fee' });
    for (const c of charges) {
      if (c.kind === 'fee' && c.label) add({ goal: 'waive_fee', label: `Ask them to waive the ${lower(c.label)}`, details: `the ${c.label}` });
    }
    add({ goal: 'ask_discount', label: 'Ask for a Friday price', details: 'Ask whether a Friday or a Sunday date comes with a lower price.' });
    add({ goal: 'ask_question', label: 'Ask what is not included', details: 'Ask them to list everything that is not included in the quoted price, so there are no surprises.', ask: 'Could you list everything that is not included in the quoted price? We would rather know now than be surprised later.' });
    for (const m of (d.missing || []).slice(0, 2)) {
      if (m.label) add({ goal: 'ask_question', label: `Ask about ${lower(m.label)}`, details: `${m.label}. ${m.why || ''}`.trim(), ask: `Does the quote include ${lower(m.label)}? If not, what would that cost?` });
    }
    for (const v of (d.vague || []).slice(0, 2)) {
      if (v.term && v.ask) add({ goal: 'ask_question', label: `Pin down "${v.term}"`, details: v.ask, ask: `About "${v.term}": ${v.ask}` });
    }
    if (!d.cancellation) add({ goal: 'ask_question', label: 'Ask what happens if we cancel', details: 'The quote says nothing about cancelling. Ask what is refundable and by when.', ask: 'What happens if we have to cancel or move the date? What is refundable, and until when?' });
    if (!(d.schedule || []).length) add({ goal: 'ask_question', label: 'Ask when money is due', details: 'The quote has no payment schedule. Ask how much is due at signing and when the rest is due.', ask: 'How much is due at signing, and when is the rest due?' });
  } else {
    add({ goal: 'ask_discount', label: 'Ask for a Friday price', details: 'Ask whether a Friday or a Sunday date comes with a lower price.' });
    add({ goal: 'ask_question', label: 'Ask what is not included', details: 'Ask what is not included in their usual price, so there are no surprises.', ask: 'What is not included in your usual price? We would rather know now than be surprised later.' });
    add({ goal: 'ask_question', label: 'Ask about their payment schedule', details: 'Ask how much is due at signing, when the rest is due, and what happens if we cancel.', ask: 'How much is due at signing, when is the rest due, and what happens if we have to cancel?' });
  }
  const msgs = getThread(ctx.vendor.id);
  const lastYou = [...msgs].reverse().find((m) => m.from === 'you' && m.status !== 'draft');
  const lastVendor = [...msgs].reverse().find((m) => m.from === 'vendor');
  if (lastYou && (!lastVendor || lastVendor.at < lastYou.at) && Date.now() - new Date(lastYou.at).getTime() > 2 * 86400000) {
    out.unshift({ goal: 'follow_up', label: 'Follow up', details: 'A gentle nudge about the last message.' });
  }
  return out.slice(0, 7);
}

function paintChips(root, ctx) {
  const box = root.querySelector('#negotiator');
  if (!box) return;
  const chips = suggestions(ctx);
  box.innerHTML = `
    <div class="neg-head">${icon('spark')}<span>Padrino suggests</span><span class="tiny">${ctx.decoded ? 'from their quote' : 'to get started'}</span></div>
    <div class="neg-chips">${chips.map((c, i) => `<button type="button" class="kind-chip neg-chip" data-chip="${i}" ${state.drafting ? 'disabled' : ''}>${esc(c.label)}</button>`).join('')}</div>`;
  box.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => draft(chips[Number(b.dataset.chip)], root, ctx)));
}

// Composer

function sendLabel(ctx) {
  if (ctx.demo) return 'Send (demo)';
  if (ctx.vendor.email) return 'Send by email';
  return 'Copy and send';
}

function paintComposer(root, ctx) {
  const box = root.querySelector('#composer-box');
  if (!box) return;
  box.innerHTML = `
    ${state.error ? draftError(state.error) : ''}
    <form class="composer ${state.drafting ? 'busy' : ''}" id="composer">
      ${state.drafting ? `<div class="composer-wait"><span class="spinner" aria-hidden="true"></span><span>Writing: ${esc(state.drafting.toLowerCase())}</span></div>` : ''}
      <label class="sr-only" for="c-subject">Subject</label>
      <input id="c-subject" name="subject" type="text" placeholder="Subject" value="${esc(state.subject)}" ${state.drafting ? 'disabled' : ''}>
      <label class="sr-only" for="c-body">Message</label>
      <textarea id="c-body" name="body" rows="5" placeholder="Write to them, or tap a suggestion above and we draft it." ${state.drafting ? 'disabled' : ''}>${esc(state.body)}</textarea>
      <div class="composer-tools">
        <button class="text-btn muted" type="button" id="they-replied">They replied</button>
        <span class="grow"></span>
        ${state.body.trim() ? `<button class="text-btn muted" type="button" id="clear-draft">Clear</button>` : ''}
        <button class="btn sm" type="submit" ${state.drafting ? 'disabled' : ''}>${icon('send')} ${esc(sendLabel(ctx))}</button>
      </div>
    </form>
    <p class="tiny mt-s composer-note">${ctx.demo ? 'A demo vendor answers with a labeled demo reply. Real vendors never get a fake one.' : 'You read every draft before it goes. Nothing is sent without you.'}</p>`;

  const form = box.querySelector('#composer');
  const subj = form.querySelector('#c-subject');
  const body = form.querySelector('#c-body');
  subj.addEventListener('input', () => { state.subject = subj.value; });
  body.addEventListener('input', () => {
    state.body = body.value;
    const clear = box.querySelector('#clear-draft');
    if (clear && !body.value.trim()) clear.remove();
  });
  box.querySelector('#clear-draft')?.addEventListener('click', () => { state.subject = ''; state.body = ''; state.error = null; paintComposer(root, ctx); });
  box.querySelector('#they-replied').addEventListener('click', () => openReplySheet(root, ctx));
  form.addEventListener('submit', (e) => { e.preventDefault(); send(root, ctx); });
}

function draftError(err) {
  let title; let text;
  if (err.code === 'no_route') { title = 'The writer is not switched on yet'; text = 'The server needs a restart to pick it up. A plain start is in the box below; change it as you like.'; }
  else if (err.code === 'no_key' || err.status === 503) { title = 'The writer is not switched on'; text = 'Add GEMINI_API_KEY to app/.env and restart the server. A plain start is in the box below.'; }
  else if (err.code === 'network') { title = 'Could not reach the server'; text = 'Is node server.mjs running? A plain start is in the box below.'; }
  else { title = 'Could not write that one'; text = (err.message || 'Try again.') + ' A plain start is in the box below.'; }
  return `<div class="callout mb" style="border-left-color:var(--warn)"><strong>${esc(title)}.</strong> ${esc(text)}</div>`;
}

// Asks the server for a draft and fills the composer. Falls back to a plain local start.
async function draft(chip, root, ctx) {
  if (!chip || state.drafting) return;
  state.drafting = chip.label; state.error = null;
  state.lastGoal = chip.goal; state.lastDetails = chip.details; state.lastChip = chip;
  paintChips(root, ctx); paintComposer(root, ctx);
  const payload = {
    vendor: { name: ctx.vendor.name, category: ctx.vendor.category || ctx.cat?.name || '' },
    goal: chip.goal,
    details: chip.details,
    couple: { names: ctx.plan.couple.names, date: ctx.plan.couple.weddingDate, guests: ctx.plan.couple.guests }
  };
  if (ctx.decoded) payload.quote = ctx.decoded;
  try {
    const res = await fetch('api/draft-message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.ok && data && data.body) {
      state.subject = data.subject || state.subject || plainSubject(chip, ctx);
      state.body = data.body;
    } else {
      state.error = res.status === 404 ? { code: 'no_route' } : { status: res.status, code: data?.error || data?.code, message: data?.message };
      fillPlain(chip, ctx);
    }
  } catch {
    state.error = { code: 'network' };
    fillPlain(chip, ctx);
  }
  state.drafting = null;
  paintChips(root, ctx); paintComposer(root, ctx);
  root.querySelector('#c-body')?.focus();
}

function plainSubject(chip, ctx) {
  const date = ctx.plan.couple.weddingDate ? fmtDate(ctx.plan.couple.weddingDate) : '';
  if (chip.goal === 'follow_up') return 'Checking in';
  if (ctx.decoded) return 'A question about our quote';
  return date ? `Our wedding, ${date}` : 'Our wedding';
}

// A plain start written here, in the couple's own voice, when the server cannot write one.
function fillPlain(chip, ctx) {
  const who = coupleNames(ctx.plan);
  const first = String(ctx.vendor.name || '').replace(/\s*\(demo\)\s*/i, '').trim();
  const hi = `Hi ${first},\n\n`;
  const bye = `\n\nThank you,\n${who}`;
  let middle;
  switch (chip.goal) {
    case 'clarify_charge':
      middle = `Thank you for the quote. Could you tell us what the service charge covers? Is it the tip for your staff, or is a separate gratuity expected?`;
      break;
    case 'waive_fee':
      middle = `We are close to booking with you. Would you be able to waive ${chip.details || 'that fee'}? It would help us a lot.`;
      break;
    case 'ask_discount':
      middle = `We love what you do. Our date has some room. Is there a better price for a Friday or a Sunday?`;
      break;
    case 'follow_up':
      middle = `Just checking in on our last message. Could you let us know when you have a moment?`;
      break;
    default:
      middle = chip.ask || 'We have a quick question about your quote.';
  }
  state.subject = plainSubject(chip, ctx);
  state.body = hi + middle + bye;
}

// Sending

function send(root, ctx) {
  const subject = state.subject.trim();
  const text = state.body.trim();
  if (!text) { toast('Write something first, or tap a suggestion'); root.querySelector('#c-body')?.focus(); return; }
  const v = ctx.vendor;
  // Asking about the date: the vendor now shows as "Asked" until their answer is recorded.
  const askedDate = Boolean(state.lastChip?.availability);
  const markAsked = () => { if (askedDate) { setAvailability(v.id, 'asked', ctx.plan?.couple?.weddingDate || null); paintAvail(root, ctx); } };
  const goalTag = askedDate ? 'availability' : (state.lastGoal || null);
  if (ctx.demo) {
    addMessage(v.id, { from: 'you', text, subject, status: 'sent', channel: 'demo', goal: goalTag });
    const goal = state.lastGoal; const details = state.lastDetails; const chip = state.lastChip;
    markAsked();
    clearComposer(root, ctx);
    toast('Sent to the demo vendor');
    setTimeout(() => {
      const reply = demoReply(goal, details, ctx, chip);
      addMessage(v.id, { from: 'vendor', text: reply, status: 'received', channel: 'demo', demo: true });
      paintMessages(root, ctx); paintChips(root, ctx);
      if (chip?.availability) noteAvailabilityFrom(reply, root, ctx);
    }, 1400);
    return;
  }
  if (v.email) {
    addMessage(v.id, { from: 'you', text, subject, status: 'sent', channel: 'email', goal: goalTag });
    markAsked();
    const href = `mailto:${encodeURIComponent(v.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    const a = document.createElement('a');
    a.href = href; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    clearComposer(root, ctx);
    toast('Opened in your email app');
    return;
  }
  // No email on file: copy, then open their site or call.
  const mid = addMessage(v.id, { from: 'you', text, subject, status: 'draft', channel: 'copy', goal: goalTag });
  const dlg = openSheet(`
    <h2>Send it your way</h2>
    <p class="muted">${esc(v.name)} does not list an email. Copy the message, then paste it into their contact form or read it to them on the phone.</p>
    <div class="vcontact mt">
      <button type="button" class="vc-btn" data-act="copy">${icon('copy')}<span>Copy the message</span></button>
      ${v.website ? `<a href="${esc(v.website)}" target="_blank" rel="noopener" data-act="site">${icon('globe')}<span>Open their website</span>${icon('external', 'ext')}</a>` : ''}
      ${v.phone ? `<a href="tel:${esc(String(v.phone).replace(/[^\d+]/g, ''))}" data-act="call">${icon('phone')}<span>Call ${esc(v.phone)}</span></a>` : ''}
    </div>
    <div class="row end mt"><button class="btn secondary" type="button" data-act="close">Done</button></div>`);
  const markSent = () => { updateMessage(v.id, mid, { status: 'sent' }); markAsked(); paintMessages(root, ctx); };
  dlg.querySelector('[data-act="copy"]').addEventListener('click', async () => {
    const full = subject ? `${subject}\n\n${text}` : text;
    try { await navigator.clipboard.writeText(full); toast('Copied. Paste it into their form.'); markSent(); }
    catch { toast('Could not copy on this device. Select the text and copy it.'); }
  });
  dlg.querySelector('[data-act="site"]')?.addEventListener('click', markSent);
  dlg.querySelector('[data-act="call"]')?.addEventListener('click', markSent);
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { clearComposer(root, ctx); });
}

function clearComposer(root, ctx) {
  state.subject = ''; state.body = ''; state.error = null; state.lastGoal = null; state.lastDetails = ''; state.lastChip = null;
  paintMessages(root, ctx); paintChips(root, ctx); paintComposer(root, ctx);
}

// Demo replies for the fictional demo vendors only. Always labeled in the thread.
function demoReply(goal, details, ctx, chip = null) {
  const svc = (ctx.decoded?.charges || []).find((c) => c.kind === 'service');
  const rate = svc && svc.rate != null ? pct(svc.rate) + ' ' : '';
  const venueLike = ['venues', 'catering'].includes(ctx.cat?.slug);
  if (chip?.availability) {
    const date = ctx.plan?.couple?.weddingDate ? fmtDate(ctx.plan.couple.weddingDate) : 'that date';
    const guests = Number(ctx.plan?.couple?.guests) > 0 ? ` for about ${ctx.plan.couple.guests} guests` : '';
    return `Good news, ${date} is open on our calendar. We can hold it for you for two weeks. We will send an all-in quote${guests} by the end of the week.`;
  }
  switch (goal) {
    case 'clarify_charge':
      return `Thanks for asking. The ${rate}service charge covers our staff, setup and cleanup. It is not a tip, so any gratuity for the servers is up to you.`;
    case 'waive_fee':
      return `Good news. We can waive ${details || 'that fee'} for your date. We will send an updated quote without it.`;
    case 'ask_discount':
      return `We have Fridays open that month. For a Friday we can take $400 off the price on your quote. Let us know if that works for you.`;
    case 'ask_question':
      return venueLike
        ? `Not included in the quote: cake cutting, corkage if you bring your own wine, and valet. Setup, cleanup, tables and chairs are in. Happy to walk you through it.`
        : `Not included in the quote: time past the hours listed and travel outside El Paso. Everything on the quote is in.`;
    case 'follow_up':
      return `Sorry for the wait, it has been a busy week. Your date is still open. Let us know when you want to lock it in.`;
    default:
      return `Thanks for reaching out. Your date is open on our calendar. What else can we answer?`;
  }
}

// They replied: paste it in, the server reads it, we show what changed.

function openReplySheet(root, ctx) {
  const dlg = openSheet(`
    <h2>What did they say?</h2>
    <p class="muted">Paste their reply. We read it and show what changed: a fee waived, a new total, a new date.</p>
    <form id="reply-form" class="mt">
      <label class="sr-only" for="reply-text">Their reply</label>
      <textarea id="reply-text" name="text" rows="6" placeholder="Paste the email or text here"></textarea>
      <div class="row end mt">
        <button class="btn secondary" type="button" data-act="no">Cancel</button>
        <button class="btn" type="submit">Read it</button>
      </div>
    </form>`);
  dlg.querySelector('[data-act="no"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('#reply-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = dlg.querySelector('#reply-text').value.trim();
    if (!text) { toast('Paste their reply first'); return; }
    addMessage(ctx.vendor.id, { from: 'vendor', text, status: 'received', channel: 'email' });
    paintMessages(root, ctx); paintChips(root, ctx);
    dlg.close();
    const found = noteAvailabilityFrom(text, root, ctx);
    readReply(text, ctx, found);
  });
}

async function readReply(text, ctx, availFound = null) {
  openSheet(`<h2>Reading their reply</h2><div class="loading"><span class="spinner" aria-hidden="true"></span><span>A few seconds.</span></div>`);
  const payload = { text, vendor: { name: ctx.vendor.name, category: ctx.vendor.category || ctx.cat?.name || '' } };
  if (ctx.decoded) payload.quote = ctx.decoded;
  let data = null; let err = null;
  try {
    const res = await fetch('api/read-reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok || !data) { err = res.status === 404 ? { code: 'no_route' } : { status: res.status, code: data?.error || data?.code, message: data?.message }; data = null; }
  } catch { err = { code: 'network' }; }

  if (err) {
    let title; let body;
    if (err.code === 'no_route') { title = 'The reader is not switched on yet'; body = 'The server needs a restart to pick it up. Their reply is saved in the thread.'; }
    else if (err.code === 'no_key' || err.status === 503) { title = 'The reader is not switched on'; body = 'Add GEMINI_API_KEY to app/.env and restart the server. Their reply is saved in the thread.'; }
    else if (err.code === 'network') { title = 'Could not reach the server'; body = 'Is node server.mjs running? Their reply is saved in the thread.'; }
    else { title = 'Could not read that reply'; body = err.message || 'Try again in a moment. Their reply is saved in the thread.'; }
    const dlg = openSheet(`<h2>${esc(title)}</h2><p class="muted">${esc(body)}</p><div class="row end mt"><button class="btn secondary" type="button" data-act="close">Close</button></div>`);
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    return;
  }

  const changes = Array.isArray(data.changes) ? data.changes : [];
  const newTotal = typeof data.newTotal === 'number' ? data.newTotal : null;
  const canApply = Boolean(ctx.line) && newTotal != null && typeof store.updateLine === 'function';
  const dlg = openSheet(`
    <h2>What changed</h2>
    ${availFound ? `<p class="mb">${availabilityBadge(availFound)} <span class="tiny">marked from their words. Change it under their name if we read it wrong.</span></p>` : ''}
    ${data.summary ? `<p>${esc(data.summary)}</p>` : ''}
    ${changes.length ? `<div class="table mt">${changes.map((c) => `<div class="tr"><div class="td-main"><div class="td-name">${esc(c.label || 'Change')}</div><div class="td-sub">${c.from != null && c.from !== '' ? `was ${esc(fmtVal(c.from))}, ` : ''}now ${esc(fmtVal(c.to))}</div></div></div>`).join('')}</div>` : `<p class="muted mt-s">No change to the price or terms that we could find.</p>`}
    ${newTotal != null ? `<div class="answer mt">${money(newTotal)}</div><div class="answer-sub">new total, as they wrote it${ctx.line && Number(ctx.line.committed) > 0 ? `, was ${money(ctx.line.committed)} in your plan` : ''}</div>` : ''}
    ${data.nextStep ? `<p class="callout mt"><strong>Next:</strong> ${esc(data.nextStep)}</p>` : ''}
    <div class="row end mt">
      <button class="btn secondary" type="button" data-act="close">Close</button>
      ${canApply ? `<button class="btn" type="button" data-act="apply">Apply to the plan</button>` : ''}
    </div>
    ${!canApply && newTotal != null ? `<p class="tiny right mt-s">Add their quote to the plan first, then this can update it.</p>` : ''}`);
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-act="apply"]')?.addEventListener('click', () => {
    try {
      store.updateLine(ctx.line.id, { committed: newTotal });
      addMessage(ctx.vendor.id, { from: 'padrino', text: `Plan updated: ${shortItem(ctx.line.item)} is now ${money(newTotal)}. Payments keep their old amounts until you change them.`, status: 'sent', channel: 'demo' });
      toast('Plan updated');
    } catch (e) { console.error(e); toast('Could not update the plan'); }
    dlg.close();
  });
}

function fmtVal(v) {
  if (typeof v === 'number') return money(v);
  return String(v ?? '');
}

function shortItem(s) { return String(s || '').split(/\s[\/(]|\s-\s/)[0].trim(); }
