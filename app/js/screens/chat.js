// The conversation. This is home: connect your bank, then talk. A compact status strip at the
// top (days to go, the budget ring), Padrino's brief for the day, then the back and forth.
// Padrino answers short and proposes actions as cards. Nothing changes until the couple taps
// Do it. The composer takes text, a photo or your voice, all in one box.
//
// agent.js (another builder's piece) holds the brain: context, chat memory, the action
// registry. Every call into it is guarded. Until it and /api/chat exist, the brief still
// renders from the plan in code and sending shows a calm "not connected yet" note.

import * as store from '../store.js';
import { getPlan, getBankData } from '../store.js';
import { getTemplate } from '../data.js';
import { summary, guestImpact, paymentTimeline, pledgeSummary } from '../calc.js';
import { money, num, esc, daysUntil, relative, plural, names } from '../format.js';
import { icon, ring, coverPct, share, toast } from '../ui.js';
import { shrinkImage } from './quotes.js';
import * as voice from '../voice.js';
import { loadPathData } from './path.js';

export const selfUpdating = true;

const CARDS_KEY = 'padrino.chat.cards.v1';
const READ_KEY = 'padrino.chat.readAloud';
const STARTERS = ['We got a quote', 'Mom sent money', 'Can we afford more guests?', 'What is due this month?'];

// Short verbs for the inline brief buttons, by action name.
const VERBS = {
  record_payment: 'Record it', record_family_money: 'Record it', add_pledge: 'Add them', record_expense: 'Add it',
  set_guests: 'Change it', update_line: 'Update it', put_freed_toward_wedding: 'Put it in', mark_subscription_cancelled: 'Mark it',
  draft_vendor_message: 'Draft it', create_padrino_link: 'Make the link', decode_quote: 'Read it', check_contract: 'Check it', open_screen: 'Open',
  accept_unplanned: 'Yes, add it', dismiss_unplanned: 'Not wedding'
};

// Where "Change" goes when the registry does not say: the screen or the plus flow, filled in.
function changeHref(action) {
  const a = action.args || {};
  const q = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  switch (action.name) {
    case 'record_payment': return '#/add?' + q({ kind: 'payment', paymentId: a.paymentId, lineId: a.lineId });
    case 'record_family_money': return '#/add?' + q({ kind: 'family_money', pledgeId: a.pledgeId, lineId: a.lineId });
    case 'record_expense': return '#/add?' + q({ kind: 'expense', lineId: a.lineId });
    case 'add_pledge': case 'create_padrino_link': return '#/family';
    case 'set_guests': case 'accept_unplanned': case 'dismiss_unplanned': return '#/home';
    case 'update_line': return '#/budget';
    case 'put_freed_toward_wedding': case 'mark_subscription_cancelled': return '#/find-money';
    case 'draft_vendor_message': return a.vendorId ? `#/thread/${encodeURIComponent(a.vendorId)}` : '#/vendors';
    case 'decode_quote': return '#/add?kind=quote';
    case 'check_contract': return '#/contract';
    case 'open_screen': return '#/' + (a.screen || 'home');
    default: return '#/add';
  }
}

// ---- the agent module, loaded when it exists

let agentLoad = null;
async function loadAgent() {
  if (!agentLoad) {
    agentLoad = import('../agent.js').then((m) => m).catch((e) => {
      console.warn('agent.js is not ready yet', e);
      agentLoad = null; // try again next time the screen opens
      return null;
    });
  }
  return agentLoad;
}

function has(agent, fn) { return Boolean(agent && typeof agent[fn] === 'function'); }

// ---- card state (done, dismissed) kept here until the chat memory carries it

function loadCards() {
  try { return JSON.parse(localStorage.getItem(CARDS_KEY) || '{}') || {}; } catch { return {}; }
}
function saveCards(c) {
  try { localStorage.setItem(CARDS_KEY, JSON.stringify(c)); } catch { /* fine */ }
}

// Kept across re-renders so typing, a photo or a half-sent message is never lost.
let draft = { text: '', image: null, preview: null };
let pending = null;      // the message just sent, until the agent has it
let thinking = false;
let errorNote = null;    // a reply that failed, shown once in the thread
let listening = null;    // the live mic session
// What this conversation is about, when a step opened it: #/talk?about=<nodeId>.
let about = null;        // { nodeId, title, starter, context }

function aboutParam() {
  try { return new URLSearchParams((location.hash.split('?')[1] || '')).get('about'); } catch { return null; }
}

// Asks agent.askAbout(nodeId) for a starter line and context. Without it, the step's own title
// still makes a chip and a plain starter, so Padrino at least knows what the couple is looking at.
async function resolveAbout(agent, nodeId) {
  let title = '';
  try {
    const pd = await loadPathData();
    if (pd && typeof pd.getNode === 'function') { const r = pd.getNode(nodeId); if (r && r.node) title = r.node.title || ''; }
  } catch { /* fine */ }
  let starter = title ? `Help me with "${title}".` : 'Help me with this step.';
  let context = { nodeId, title };
  if (has(agent, 'askAbout')) {
    try {
      const r = await agent.askAbout(nodeId);
      if (typeof r === 'string') starter = r;
      else if (r && typeof r === 'object') {
        starter = r.message || r.text || r.starter || r.prompt || starter;
        title = r.title || r.about || title;
        context = r.context || r;
      }
    } catch (e) { console.error(e); }
  }
  return { nodeId, title: title || 'this step', starter, context, prefilled: false };
}

export async function render(root, { navigate }) {
  const plan = getPlan();
  const template = await getTemplate().catch(() => []);
  const agent = await loadAgent();
  const cards = loadCards();

  const wanted = aboutParam();
  if (wanted && (!about || about.nodeId !== wanted)) about = await resolveAbout(agent, wanted);
  if (!wanted && about && !about.keep) about = null;

  root.innerHTML = `
    <div class="talk" id="talk">
      <a class="talk-status" id="talk-status" href="#/home" aria-label="Open your plan"></a>
      <div class="talk-thread" id="talk-thread" aria-live="polite"></div>
      <div class="talk-foot" id="talk-foot">
        <div id="about-root"></div>
        <div class="tchips" id="tchips" hidden></div>
        <form class="tcomp" id="tcomp">
          <div class="tcomp-photo" id="tcomp-photo" hidden></div>
          <label class="sr-only" for="tcomp-text">Talk to Padrino</label>
          <textarea id="tcomp-text" rows="1" placeholder="What happened? Or ask anything" autocomplete="off"></textarea>
          <div class="tcomp-tools">
            <input type="file" id="tcomp-file" accept="image/*" capture="environment" class="sr-only">
            <label class="icon-btn tcomp-tool" for="tcomp-file" title="Snap or upload a photo" aria-label="Snap or upload a photo">${icon('camera')}</label>
            ${voice.canListen() ? `<button class="icon-btn tcomp-tool" type="button" id="tcomp-mic" aria-label="Talk instead of typing" aria-pressed="false">${micIcon()}</button>` : ''}
            ${voice.canSpeak() ? `<button class="text-btn muted tcomp-read" type="button" id="tcomp-read" aria-pressed="false">Read aloud: off</button>` : ''}
            <button class="tcomp-send" type="submit" id="tcomp-send" aria-label="Send">${icon('arrow')}</button>
          </div>
        </form>
      </div>
    </div>`;

  const statusEl = root.querySelector('#talk-status');
  const threadEl = root.querySelector('#talk-thread');
  const chipsEl = root.querySelector('#tchips');
  const form = root.querySelector('#tcomp');
  const ta = root.querySelector('#tcomp-text');
  const sendBtn = root.querySelector('#tcomp-send');
  const micBtn = root.querySelector('#tcomp-mic');
  const readBtn = root.querySelector('#tcomp-read');
  const photoEl = root.querySelector('#tcomp-photo');

  // ---- paint

  function paintStatus() {
    const p = getPlan();
    if (!p) return;
    let s = null;
    try { s = summary(p, template); } catch (e) { console.error(e); }
    const days = daysUntil(p.couple?.weddingDate);
    const pct = s ? coverPct(s.available, s.needed) : 0;
    const cls = s ? ringCls(s.overBy, s.needed, s.available) : '';
    statusEl.innerHTML = `
      <div class="ring-wrap">${ring(pct, { size: 30, stroke: 4, cls, label: 'How much of the wedding your money covers' })}</div>
      <span class="ts-days">${esc(daysLine(days))}</span>
      <span class="ts-word ${cls}">${s ? esc(statusWord(s)) : ''}</span>
      ${icon('chevron', 'chev')}`;
  }

  function paintThread() {
    const p = getPlan();
    const msgs = readChat(agent);
    const brief = buildBrief(agent, p, template);
    const parts = [];
    parts.push(briefHtml(brief, cards));
    cardIndex.clear();
    // Done notes for a card that already shows its done line would say the same thing twice.
    const shownDone = new Set();
    for (const m of msgs) for (const a of m.actions || []) if (a.id && (a.status === 'done' || cards[a.id]?.status === 'done')) shownDone.add(a.id);
    for (const k of Object.keys(cards)) if (cards[k].status === 'done') shownDone.add(k);
    let prevFrom = 'brief';
    msgs.forEach((m, i) => {
      if (m.role === 'done' && m.actionId && shownDone.has(m.actionId)) return;
      (m.actions || []).forEach((a, ai) => { cardIndex.set(a.id || `${i}:${ai}`, a); });
      parts.push(msgHtml(m, i, cards, prevFrom !== 'padrino'));
      prevFrom = m.role === 'user' ? 'you' : 'padrino';
    });
    if (pending) { parts.push(msgHtml(pending, 'pending', cards, false)); prevFrom = 'you'; }
    if (thinking) parts.push(`<div class="tmsg padrino"><div class="bubble typing" aria-label="Padrino is thinking"><i></i><i></i><i></i></div></div>`);
    if (errorNote && !thinking) parts.push(`<div class="tmsg padrino"><div class="bubble note">${esc(errorNote)}</div></div>`);
    threadEl.innerHTML = parts.join('');
    // Starter chips stay until the couple has said something themselves.
    const empty = !msgs.some((m) => m.role === 'user') && !pending && !thinking;
    chipsEl.hidden = !empty;
    chipsEl.innerHTML = empty ? STARTERS.map((t) => `<button type="button" class="chip" data-starter="${esc(t)}">${esc(t)}</button>`).join('') : '';
    wireThread();
    scrollToLatest();
  }

  // The chip above the composer: "About: Lock the photographer". Dropping it clears the context.
  function paintAbout() {
    const el = root.querySelector('#about-root');
    if (!el) return;
    if (!about) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="about-chip" id="about-chip">${icon('path')}<span>About: ${esc(about.title)}</span><button type="button" id="about-clear" aria-label="Stop talking about this step">${icon('close')}</button></div>`;
    el.querySelector('#about-clear').addEventListener('click', () => {
      about = null;
      if (aboutParam()) location.replace('#/talk'); else paintAbout();
      ta.focus();
    });
    if (!about.prefilled) {
      about.prefilled = true;
      about.keep = true;
      if (!ta.value.trim()) { ta.value = about.starter || ''; draft.text = ta.value; autoGrow(ta); updateSend(); }
    }
  }

  function paintPhoto() {
    photoEl.hidden = !draft.preview;
    photoEl.innerHTML = draft.preview ? `<img src="${draft.preview}" alt="Your photo"><button class="text-btn muted" type="button" id="tcomp-clear">Remove</button>` : '';
    photoEl.querySelector('#tcomp-clear')?.addEventListener('click', () => { draft.image = null; draft.preview = null; paintPhoto(); updateSend(); });
  }

  function updateSend() {
    sendBtn.disabled = thinking || (!ta.value.trim() && !draft.image);
  }

  // ---- wiring inside the thread (cards, brief buttons, open links)

  function wireThread() {
    threadEl.querySelectorAll('[data-card]').forEach((card) => {
      const key = card.dataset.card;
      const action = findAction(key);
      card.querySelector('[data-do]')?.addEventListener('click', () => doAction(key, action, card));
      card.querySelector('[data-change]')?.addEventListener('click', () => {
        const href = registryChange(agent, action) || changeHref(action);
        navigate(href.replace(/^#/, ''));
      });
      card.querySelector('[data-skip]')?.addEventListener('click', () => {
        if (action && action.id && has(agent, 'skipAction')) { try { agent.skipAction(action); } catch (e) { console.error(e); } }
        cards[key] = { status: 'skipped' };
        saveCards(cards);
        paintThread();
      });
    });
    threadEl.querySelectorAll('[data-brief-act]').forEach((btn) => {
      const key = btn.dataset.briefAct;
      const action = briefActions.get(key);
      if (!action) return;
      btn.addEventListener('click', () => doAction(key, action, btn.closest('.brief-item')));
    });
  }

  // Runs an approved action through the registry. The card turns into a quiet done line.
  async function doAction(key, action, el) {
    if (!action) return;
    if (!has(agent, 'runAction')) { toast('Padrino is not connected yet. Use Change to do it by hand.', 3400); return; }
    el?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      const result = await agent.runAction(action);
      cards[key] = { status: 'done', result: typeof result === 'string' ? result : labelOf(agent, action) };
      saveCards(cards);
      if (readAloud()) voice.speak(cards[key].result);
    } catch (e) {
      console.error(e);
      toast(e?.message ? plainError(e) : 'Could not do that', 3400);
    }
    paintThread();
  }

  // Actions live in two places: a chat turn (indexed while painting) or today's brief.
  const briefActions = new Map();
  const cardIndex = new Map();
  function findAction(key) {
    if (briefActions.has(key)) return briefActions.get(key);
    return cardIndex.get(key) || null;
  }

  function buildBrief(agentMod, p, tpl) {
    briefActions.clear();
    let brief = null;
    if (has(agentMod, 'dailyBrief')) {
      try { brief = agentMod.dailyBrief(); } catch (e) { console.error(e); brief = null; }
    }
    if (!brief || !Array.isArray(brief.items)) brief = localBrief(p, tpl);
    brief.items.forEach((it, i) => {
      if (!it.action) return;
      const id = briefKey(it);
      if (!it.action.id) it.action.id = id;
      briefActions.set(id, it.action);
    });
    return brief;
  }

  // ---- sending

  async function send(text) {
    const t = (text ?? ta.value).trim();
    if (!t && !draft.image) { ta.focus(); return; }
    if (thinking) return;
    if (listening) stopListening();
    const image = draft.image;
    const preview = draft.preview;
    draft = { text: '', image: null, preview: null };
    ta.value = ''; autoGrow(ta); paintPhoto(); updateSend();
    errorNote = null;
    pending = { role: 'user', text: t, preview, at: new Date().toISOString() };
    thinking = true;
    paintThread();

    if (!has(agent, 'sendChat')) {
      await wait(500);
      thinking = false;
      errorNote = 'Padrino is not connected yet. The brief above still works, and the plus flow records anything by hand.';
      paintThread();
      return;
    }
    try {
      const res = await agent.sendChat(t, { image, about: about ? about.context : undefined, aboutNode: about ? about.nodeId : undefined });
      pending = null;
      thinking = false;
      paintThread();
      if (readAloud() && res && res.reply) voice.speak(res.reply);
    } catch (e) {
      console.warn('Padrino did not answer', e?.code || '', e?.status || '');
      thinking = false;
      // Nothing was stored, so the words go back in the box for another try.
      pending = null;
      draft = { text: t, image, preview };
      ta.value = t; autoGrow(ta); paintPhoto(); updateSend();
      errorNote = plainError(e);
      paintThread();
    }
  }

  // ---- composer wiring

  ta.value = draft.text;
  autoGrow(ta);
  updateSend();
  ta.addEventListener('input', () => { draft.text = ta.value; autoGrow(ta); updateSend(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  chipsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-starter]');
    if (b) send(b.dataset.starter);
  });

  root.querySelector('#tcomp-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const { dataUrl, base64 } = await shrinkImage(file);
      draft.image = { mediaType: 'image/jpeg', data: base64 };
      draft.preview = dataUrl;
    } catch (err) {
      console.error(err);
      toast('Could not read that photo. Try another one.');
    }
    e.target.value = '';
    paintPhoto(); updateSend(); ta.focus();
  });
  paintPhoto();

  // Mic: tap to talk, the words land in the box as you say them, tap again to stop.
  function stopListening() {
    if (listening) { listening.stop(); listening = null; }
    if (micBtn) { micBtn.classList.remove('listening'); micBtn.setAttribute('aria-pressed', 'false'); micBtn.setAttribute('aria-label', 'Talk instead of typing'); }
    ta.placeholder = 'What happened? Or ask anything';
  }
  if (micBtn) {
    micBtn.addEventListener('click', () => {
      if (listening) { stopListening(); return; }
      const before = ta.value.trim();
      listening = voice.listen({
        onText: ({ text }) => { ta.value = (before ? before + ' ' : '') + text; draft.text = ta.value; autoGrow(ta); updateSend(); },
        onEnd: () => { stopListening(); updateSend(); if (ta.value.trim()) ta.focus(); },
        onError: (code) => toast(voice.micErrorText(code), 3600)
      });
      if (!listening) { toast(voice.micErrorText('start-failed'), 3000); return; }
      micBtn.classList.add('listening');
      micBtn.setAttribute('aria-pressed', 'true');
      micBtn.setAttribute('aria-label', 'Stop listening');
      ta.placeholder = 'Listening. Tap the mic when you are done.';
    });
  }

  if (readBtn) {
    const paintRead = () => { const on = readAloud(); readBtn.textContent = `Read aloud: ${on ? 'on' : 'off'}`; readBtn.setAttribute('aria-pressed', String(on)); readBtn.classList.toggle('on', on); };
    readBtn.addEventListener('click', () => { setReadAloud(!readAloud()); paintRead(); if (!readAloud()) voice.hush(); });
    paintRead();
  }

  if (has(agent, 'ready')) { try { agent.ready(); } catch { /* fine */ } }
  paintStatus();
  paintThread();
  paintAbout();

  // Plan changes (an action ran, the bank verified something) refresh the strip and the brief, never the typing.
  const unsub = store.subscribe(() => { paintStatus(); paintThread(); });
  const unsubChat = has(agent, 'onChatChange') ? agent.onChatChange(() => paintThread()) : () => {};
  return () => { unsub(); unsubChat(); stopListening(); voice.hush(); };
}

// ---- the brief, built in code from the plan when agent.js has not given us one

function localBrief(plan, template) {
  const items = [];
  if (!plan) return { greeting: greeting(), items };
  let s = null; let tl = null; let ps = null;
  try { s = summary(plan, template); } catch (e) { console.error(e); }
  try { tl = paymentTimeline(plan, new Date()); } catch { tl = { payments: [], overdue: [], next30: [] }; }
  try { ps = pledgeSummary(plan); } catch { ps = { people: [] }; }

  const bank = getBankData();
  const history = safe(() => store.getHistory(), []);
  const recent = history.filter((h) => h.status === 'verified' && h.bank && daysAgo(h.at) <= 3);
  for (const h of recent.slice(0, 2)) {
    items.push({ kind: 'good', text: `Your bank confirmed ${lower(h.title)}, ${money(h.amount)}.` });
  }
  const different = history.filter((h) => h.status === 'different' && daysAgo(h.at) <= 7).slice(0, 1);
  for (const h of different) items.push({ kind: 'warn', text: h.note || `${h.title} came through at a different amount than planned.`, href: '#/payments', verb: 'See it' });

  for (const a of safe(() => store.getAlerts(), []).slice(0, 1)) {
    items.push({ kind: 'bad', text: a.text || a.title || 'A vendor changed their payment instructions. Check before you pay.', href: '#/payments', verb: 'Look' });
  }

  const un = safe(() => store.getUnplanned(), []);
  if (un.length) items.push({ kind: 'warn', text: `${num(un.length)} ${plural(un.length, 'charge')} in your bank ${un.length === 1 ? 'looks' : 'look'} like wedding spending nobody planned${un[0]?.merchant ? `, starting with ${titleWords(un[0].merchant)}` : ''}.`, href: '#/home', verb: 'Sort it' });

  for (const p of (tl.overdue || []).slice(0, 1)) items.push({ kind: 'bad', text: `The ${lower(p.label)} was due ${relative(p.dueDate)}, ${money(p.amount)}.`, href: `#/add?kind=payment&paymentId=${encodeURIComponent(p.id)}`, verb: 'I paid it' });
  const soon = (tl.payments || []).filter((p) => p.status !== 'paid' && !p.overdue && p.daysUntil != null && p.daysUntil <= 30).slice(0, 1);
  for (const p of soon) items.push({ kind: 'accent', text: `The ${lower(p.label)} is due ${relative(p.dueDate)}, ${money(p.amount)}.`, href: `#/add?kind=payment&paymentId=${encodeURIComponent(p.id)}`, verb: 'I paid it' });

  const waiting = (ps.people || []).filter((f) => Number(f.outstanding) > 0);
  if (waiting.length) items.push({ kind: 'neutral', text: `${money(waiting[0].outstanding)} from ${waiting[0].name} has not come in yet${waiting.length > 1 ? `, and ${num(waiting.length - 1)} more ${plural(waiting.length - 1, 'pledge is', 'pledges are')} still open` : ''}.`, href: `#/add?kind=family_money&pledgeId=${encodeURIComponent(waiting[0].id)}`, verb: 'It came in' });

  if (!bank) items.push({ kind: 'accent', text: 'Connect your bank and payments get verified on their own.', href: '#/payments', verb: 'Connect' });

  if (s && Number(s.overBy) > 0) items.push({ kind: 'warn', text: `The plan is over by ${money(s.overBy)}. Ask me to close it, or open the fixer.`, href: '#/fixer', verb: 'Fixer' });
  else if (s) items.push({ kind: 'good', text: 'Your plan is on track. Nothing needs you today beyond the above.' });

  return { greeting: `${greeting()}, ${names(plan)}.`, items: items.slice(0, 6) };
}

// The brief shows one thing: the most important item that still needs them, with its button.
// Everything else folds away under "See more" so nobody has to read a wall of text.
function briefHtml(brief, cards) {
  const rows = (brief.items || []).map((it) => {
    const key = briefKey(it);
    const state = it.action ? (cards[key] || (it.action.status === 'done' ? { status: 'done', result: it.action.result } : null)) : null;
    const done = Boolean(state && state.status === 'done');
    let btn = '';
    if (done) {
      btn = `<div class="brief-done"><span class="done-line small">${icon('check')}${esc(state.result || 'Done')}</span></div>`;
    } else if (it.action) {
      btn = `<button class="btn secondary sm" type="button" data-brief-act="${esc(key)}">${esc(it.verb || VERBS[it.action.name] || 'Do it')}</button>`;
    } else if (it.href) {
      btn = `<a class="btn secondary sm" href="${esc(it.href)}">${esc(it.verb || 'Open')}</a>`;
    }
    const row = (text) => `<div class="brief-item ${done ? 'done' : ''}"><span class="brief-dot ${esc(dotKind(it.kind))}" aria-hidden="true"></span><p class="brief-text" title="${esc(it.text)}">${esc(text)}</p>${btn}</div>`;
    return { html: row(it.text), short: row(it.short || it.text), done, actionable: Boolean(it.action || it.href) };
  });
  const topIndex = Math.max(0, rows.findIndex((r) => !r.done && r.actionable));
  const top = rows[topIndex];
  const rest = rows.filter((_, i) => i !== topIndex);
  return `<div class="tmsg padrino brief">
    <div class="from">Padrino</div>
    <div class="bubble">
      <p class="brief-greet">${esc(brief.greeting || greeting())}</p>
      ${top ? `<div class="brief-items">${top.short}</div>` : `<p class="muted">Nothing new today. Ask me anything about the wedding money.</p>`}
      ${rest.length ? `<details class="brief-more" style="margin-top:6px"><summary style="cursor:pointer;font-size:.85rem;font-weight:600;color:var(--accent);list-style-position:inside;padding:4px 0">See ${rest.length} more</summary><div class="brief-items">${rest.map((r) => r.html).join('')}</div></details>` : ''}
    </div>
  </div>`;
}

// ---- messages

function readChat(agent) {
  if (!has(agent, 'getChat')) return [];
  try {
    const list = agent.getChat();
    return Array.isArray(list) ? list.map(normalizeMsg).filter(Boolean) : [];
  } catch (e) { console.error(e); return []; }
}

function normalizeMsg(m) {
  if (!m) return null;
  if (typeof m === 'string') return { role: 'padrino', text: m };
  const role = m.role === 'user' || m.role === 'you' || m.from === 'you' ? 'user'
    : (m.role === 'done' || m.kind === 'done' || m.type === 'done') ? 'done' : 'padrino';
  return {
    role,
    id: m.id || null,
    actionId: m.actionId || null,
    text: m.text ?? m.reply ?? m.content ?? '',
    actions: Array.isArray(m.actions) ? m.actions : [],
    show: m.show || null,
    preview: m.preview || (m.image && m.image.data ? `data:${m.image.mediaType || 'image/jpeg'};base64,${m.image.data}` : null),
    at: m.at || m.time || null
  };
}

function msgHtml(m, index, cards, showName) {
  if (m.role === 'done') {
    return `<div class="tmsg padrino"><span class="done-line">${icon('check')}${esc(m.text)}</span></div>`;
  }
  if (m.role === 'user') {
    return `<div class="tmsg you">
      ${m.preview ? `<img class="tphoto" src="${m.preview}" alt="Your photo">` : ''}
      ${m.text ? `<div class="bubble">${esc(m.text)}</div>` : ''}
    </div>`;
  }
  // A card's "why" often repeats the reply word for word; only show it when it adds something.
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const actions = (m.actions || [])
    .map((a) => (same(a.why, m.text) ? { ...a, why: '' } : a))
    .map((a, ai) => cardHtml(a, a.id || `${index}:${ai}`, cards)).join('');
  const show = m.show ? `<a class="open-link" href="#/${esc(m.show)}">${icon('arrow')}Open ${esc(screenName(m.show))}</a>` : '';
  return `<div class="tmsg padrino">
    ${showName ? '<div class="from">Padrino</div>' : ''}
    ${m.text ? `<div class="bubble">${esc(m.text)}</div>` : ''}
    ${actions}${show}
  </div>`;
}

function cardHtml(action, key, cards) {
  if (!action || !action.name) return '';
  const state = action.status && action.status !== 'proposed' ? { status: action.status, result: action.result } : cards[key];
  const label = action.label || prettyLabel(action);
  if (state && state.status === 'done') {
    return `<div class="acard done" data-card="${esc(key)}"><span class="done-line">${icon('check')}${esc(state.result || label)}</span></div>`;
  }
  if (state && state.status === 'skipped') {
    return `<div class="acard skipped" data-card="${esc(key)}"><p class="tiny">${esc(label)}<span class="acard-skip"> left for later</span></p></div>`;
  }
  return `<div class="acard" data-card="${esc(key)}">
    <p class="acard-label">${esc(label)}</p>
    ${action.why ? `<p class="acard-why">${esc(action.why)}</p>` : ''}
    ${previewHtml(action)}
    <div class="acard-btns">
      <button class="btn sm" type="button" data-do>Do it</button>
      <button class="btn secondary sm" type="button" data-change>Change</button>
      <button class="text-btn muted" type="button" data-skip>Not now</button>
    </div>
  </div>`;
}

// A small preview under the label. Guests get the before and after ring, drawn from money.js.
let previewAgent = null;
function previewHtml(action) {
  if (action.name === 'set_guests') return guestPreview(action.args || {});
  if (previewAgent && typeof previewAgent.previewAction === 'function') {
    try {
      const out = previewAgent.previewAction(action);
      return out ? `<div class="acard-preview">${esc(String(out))}</div>` : '';
    } catch (e) { console.error(e); }
  }
  if (previewAgent && previewAgent.ACTIONS && previewAgent.ACTIONS[action.name] && typeof previewAgent.ACTIONS[action.name].preview === 'function') {
    try {
      const out = previewAgent.ACTIONS[action.name].preview(action.args || {});
      if (!out) return '';
      const s = String(out);
      return `<div class="acard-preview">${/^\s*</.test(s) ? s : esc(s)}</div>`;
    } catch (e) { console.error(e); }
  }
  return '';
}

function guestPreview(args) {
  const plan = getPlan();
  const g = Number(args.guests);
  if (!plan || !g) return '';
  let before = null; let after = null;
  try { before = summary(plan, cachedTemplate); after = guestImpact(plan, g, cachedTemplate); } catch (e) { console.error(e); return ''; }
  const tiny = (s, lbl, n) => `<div class="gprev">
      <div class="ring-wrap">${ring(coverPct(s.available, s.needed), { size: 54, stroke: 6, cls: ringCls(s.overBy, s.needed, s.available), label: lbl })}
        <div class="ring-center"><div class="gnum">${num(n)}</div></div></div>
      <span class="tiny">${esc(lbl)}</span></div>`;
  return `<div class="acard-preview gprev-row">
    ${tiny(before, 'now', plan.couple.guests)}
    ${icon('arrow')}
    ${tiny(after, Number(after.overBy) > 0 ? `over by ${money(after.overBy)}` : 'fits', g)}
  </div>`;
}

let cachedTemplate = [];
getTemplate().then((t) => { cachedTemplate = Array.isArray(t) ? t : []; }).catch(() => {});
loadAgent().then((a) => { previewAgent = a; });

// ---- small helpers

function labelOf(agent, action) {
  if (action.label) return action.label;
  if (agent && agent.ACTIONS && agent.ACTIONS[action.name] && typeof agent.ACTIONS[action.name].label === 'function') {
    try { return agent.ACTIONS[action.name].label(action.args || {}); } catch { /* fall through */ }
  }
  return prettyLabel(action);
}

function registryChange(agent, action) {
  const entry = agent && agent.ACTIONS && agent.ACTIONS[action.name];
  if (entry && typeof entry.change === 'function') {
    try { return entry.change(action.args || {}); } catch { return null; }
  }
  return null;
}

function prettyLabel(action) {
  if (previewAgent && typeof previewAgent.labelAction === 'function') {
    try { const l = previewAgent.labelAction(action); if (l) return l; } catch { /* fall through */ }
  }
  if (previewAgent && previewAgent.ACTIONS && previewAgent.ACTIONS[action.name] && typeof previewAgent.ACTIONS[action.name].label === 'function') {
    try { return previewAgent.ACTIONS[action.name].label(action.args || {}); } catch { /* fall through */ }
  }
  const a = action.args || {};
  const amt = a.amount != null ? money(a.amount) : '';
  switch (action.name) {
    case 'record_payment': return `Record ${amt}${a.who ? ' to ' + a.who : ''} as paid`;
    case 'record_family_money': return `Record ${amt} from ${a.name || 'family'}${a.item ? ' toward the ' + lower(a.item) : ''}`;
    case 'add_pledge': return `Add ${a.name || 'a padrino'}${amt ? ', ' + amt : ''}${a.item ? ' for the ' + lower(a.item) : ''}`;
    case 'record_expense': return `Add ${amt}${a.who ? ' at ' + a.who : ''} to the plan`;
    case 'set_guests': return `Change the guest list to ${num(a.guests)}`;
    case 'update_line': return `Set ${a.item || a.lineId || 'that line'} to ${amt}`;
    case 'put_freed_toward_wedding': return `Put ${a.monthly != null ? money(a.monthly) + ' a month' : 'the freed money'} toward the wedding`;
    case 'mark_subscription_cancelled': return `Mark ${a.name || 'that subscription'} cancelled`;
    case 'draft_vendor_message': return `Draft a message to ${a.vendorName || a.vendor || 'the vendor'}`;
    case 'create_padrino_link': return `Make a Padrino link${a.item ? ' for the ' + lower(a.item) : ''}`;
    case 'decode_quote': return 'Read this quote for hidden costs';
    case 'check_contract': return 'Check this contract before you sign';
    case 'open_screen': return `Open ${screenName(a.screen)}`;
    default: return String(action.name).replace(/_/g, ' ');
  }
}

function screenName(s) {
  const map = { home: 'your plan', budget: 'the budget', payments: 'payments', family: 'family', vendors: 'vendors', 'find-money': 'Find money', fixer: 'the fixer', contract: 'the contract check', after: 'After the wedding', quotes: 'quotes' };
  return map[s] || String(s || 'the plan').replace(/-/g, ' ');
}

function plainError(e) {
  const code = e?.code || e?.error || '';
  const status = e?.status;
  if (status === 404 || code === 'no_route' || code === 'not_found') return 'Padrino is not connected yet. The brief above still works, and the plus flow records anything by hand.';
  if (status === 503 || code === 'no_key') return 'Talking is not switched on. Add GEMINI_API_KEY to app/.env and restart the server.';
  if (code === 'bad_key') return 'The API key is not valid. Check GEMINI_API_KEY in app/.env.';
  if (code === 'busy' || code === 'rate_limited' || status === 429) return 'Padrino is busy. Give it a few seconds and try again.';
  if (code === 'timeout') return 'That took too long. Try a smaller photo or plainer words.';
  if (code === 'network' || e instanceof TypeError) return 'Could not reach the server. Is node server.mjs running?';
  return e?.message ? String(e.message) : 'Something went wrong. Try again.';
}

function micIcon() {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>`;
}

// Keyed by what the item is, not where it sits, so a done mark stays on its own item
// when new items (money in, alerts) push the list around.
function briefKey(it) {
  const what = it && it.action
    ? `${it.action.name}:${JSON.stringify(it.action.args || {})}`
    : `${it?.kind || ''}:${it?.text || ''}`;
  return `brief:${new Date().toISOString().slice(0, 10)}:${what.slice(0, 120)}`;
}

// The brief's kinds (from agent.js or the local one) to a dot color.
function dotKind(kind) {
  const k = String(kind || '');
  if (k === 'alert' || k === 'bad') return 'bad';
  if (k === 'unplanned' || k === 'warn') return 'warn';
  if (k === 'verified' || k === 'money_in' || k === 'good') return 'good';
  if (k === 'payment' || k === 'accent') return 'accent';
  if (k === 'gap') {
    const p = getPlan();
    try { const s = summary(p, cachedTemplate); return Number(s.overBy) > 0 ? 'warn' : 'good'; } catch { return 'neutral'; }
  }
  return 'neutral';
}

function readAloud() { try { return localStorage.getItem(READ_KEY) === 'on'; } catch { return false; } }
function setReadAloud(on) { try { localStorage.setItem(READ_KEY, on ? 'on' : 'off'); } catch { /* fine */ } }

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(160, Math.max(28, ta.scrollHeight)) + 'px';
}

function scrollToLatest() {
  requestAnimationFrame(() => {
    const doc = document.scrollingElement || document.documentElement;
    doc.scrollTop = doc.scrollHeight;
  });
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function safe(fn, fallback) { try { const v = fn(); return v == null ? fallback : v; } catch { return fallback; } }
function daysAgo(iso) { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? (Date.now() - d.getTime()) / 86400000 : Infinity; }
function lower(s) { const t = String(s || ''); return t ? t.charAt(0).toLowerCase() + t.slice(1) : t; }
function titleWords(s) { return String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()); }

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function daysLine(days) {
  if (days === null) return 'Your wedding';
  if (days < 0) return `Married ${num(-days)} ${plural(-days, 'day')} ago`;
  if (days === 0) return 'Today is the day';
  if (days === 1) return 'Tomorrow is the day';
  return `${num(days)} days to go`;
}

function ringCls(overBy, needed, available) {
  if (Number(overBy) > 0) return Number(overBy) <= Number(available) * 0.08 ? 'warn' : 'bad';
  return share(needed, available) >= 92 ? 'warn' : 'good';
}

function statusWord(s) {
  if (Number(s.overBy) > 0) return Number(s.overBy) <= Number(s.available) * 0.08 ? 'A little over' : `Over by ${money(s.overBy)}`;
  if (share(s.needed, s.available) >= 92) return 'Tight, on track';
  return 'On track';
}
