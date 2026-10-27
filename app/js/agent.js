// Padrino's conversation brain (browser side).
//
// What lives here:
//   buildContext()   a compact snapshot of the plan, built only from money.js (through calc.js) and the store
//   sendChat()       one turn to POST /api/chat; the answer is a short reply plus proposed actions
//   ACTIONS          every action Padrino can propose: label, preview and run, each mapped to store functions
//   runAction()      runs one approved action; nothing runs without the couple's tap
//   dailyBrief()     the opening of the conversation, built in code (never by the model)
//   askAbout()       "Ask Padrino" on a path step: a starter message plus the step's context (Round 6)
//   getChat() / clearChat()   the conversation, kept in localStorage under padrino.chat.v1
//
// No money math in this file beyond adding up what money.js already gave us. The model reads numbers from the
// context; it never works them out.
//
// Store functions come from several builders, so every call goes through call() and is guarded with typeof.

import * as store from './store.js';
import { summary, guestImpact as calcGuestImpact, paymentTimeline, pledgeSummary } from './calc.js';
import { getTemplate } from './data.js';
import { todayISO, relative, fmtDateShort, uid, names as coupleNames } from './format.js';
import * as subs from './subs.js';
import { getPath, getNode as getPathNode } from './path-data.js';
import { monthlyFreed, freedByWedding, verificationMessage, usd } from '../lib/bank.js';

export const CHAT_KEY = 'padrino.chat.v1';
const PAY_KEY = 'padrino.pay.v1'; // the Zelle, Venmo and Cash App names the Family screen keeps
const MAX_TURNS = 80; // kept on this device
const SEND_TURNS = 12; // sent to the server each turn
const NOT_READY = 'That part of the app is not ready yet.';
const STALE = 'That changed since I suggested it. Ask me again and I will look again.';

// ------------------------------------------------------------------ small helpers

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const cents = (n) => Math.round(n * 100) / 100;
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const slug = (s) => String(s || 'vendor').toLowerCase().replace(/\(demo\)/g, 'demo').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'vendor';
const nowISO = () => new Date().toISOString();
const plan = () => store.getPlan();

// Calls a store function if the build has it.
function call(name, ...args) {
  const f = store[name];
  if (typeof f !== 'function') throw new Error(NOT_READY);
  return f(...args);
}
function has(name) { return typeof store[name] === 'function'; }
function safe(name, fallback, ...args) {
  try { return has(name) ? store[name](...args) : fallback; } catch (e) { console.error(e); return fallback; }
}

// "Venue rental / site fee" -> "venue rental"
function lineShort(l) { return String(l?.item || '').split(/\s+[/-]\s+|\s*\(/)[0].trim().toLowerCase(); }
function lineById(id) { return (plan()?.lines || []).find((l) => l.id === id) || null; }
function lineName(id) { return lineShort(lineById(id)) || 'the budget'; }
function paymentById(id) { return (plan()?.payments || []).find((p) => p.id === id) || null; }
function pledgeById(id) { return (plan()?.pledges || []).find((p) => p.id === id) || null; }
const niceName = (n) => { const s = String(n || ''); return s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s; };

function navigate(path) {
  try {
    if (typeof location !== 'undefined') location.hash = '#' + (path.startsWith('/') ? path : '/' + path);
  } catch { /* not in a browser */ }
}

// ------------------------------------------------------------------ data the context needs (budget template)

let template = [];
let templatePromise = null;

// Loads the budget template once. sendChat, runAction and dailyBrief wait for it; call it early if you like.
export function ready() {
  if (!templatePromise) {
    templatePromise = getTemplate().then((t) => { template = Array.isArray(t) ? t : []; }).catch(() => { templatePromise = null; });
  }
  return templatePromise;
}

// ------------------------------------------------------------------ the conversation on this device

function blankState() { return { planId: null, turns: [], lastOpened: null, brief: null }; }

function loadState() {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return blankState();
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? { ...blankState(), ...p, turns: Array.isArray(p.turns) ? p.turns : [] } : blankState();
  } catch { return blankState(); }
}

let state = loadState();
let focus = null; // the path step the chat is about, if any: { nodeId, at }

function save() {
  try {
    if (state.turns.length > MAX_TURNS) state.turns = state.turns.slice(-MAX_TURNS);
    localStorage.setItem(CHAT_KEY, JSON.stringify(state));
  } catch { /* private mode or full: the chat still works this visit */ }
}

// A photo is too big for localStorage, so it waits here until the card that needs it is used.
const pendingImages = new Map();

const turnListeners = new Set();
// Tell the screen when the conversation changes (a done note, a cleared chat). Returns a function that stops listening.
export function onChatChange(fn) { turnListeners.add(fn); return () => turnListeners.delete(fn); }
function changed() { for (const fn of turnListeners) { try { fn(getChat()); } catch (e) { console.error(e); } } }

function addTurn(turn) {
  const t = { id: uid('t'), at: nowISO(), ...turn };
  state.turns.push(t);
  save();
  changed();
  return t;
}

export function getChat() {
  syncIdentity();
  return JSON.parse(JSON.stringify(state.turns));
}

// Wipes the conversation, today's brief and the last-opened time. The plan itself is not touched.
export function clearChat() {
  state = { ...blankState(), planId: plan()?.agentId || null };
  focus = null;
  pendingImages.clear();
  save();
  changed();
}

// Plan identity. A chat belongs to one plan. Every plan carries an agentId stamped here; "Load demo" and "Start over"
// make a plan without one (or no plan), so the chat clears. Plan objects are replaced on every change, so identity
// cannot be the object itself.
let stamping = false;
function syncIdentity() {
  const p = plan();
  if (!p) {
    if (state.planId || state.turns.length || state.brief) clearChat();
    return;
  }
  if (!p.agentId) {
    if (state.planId || state.turns.length) clearChat(); // the chat was for another plan
    stampPlan();
    return;
  }
  if (state.planId !== p.agentId) {
    if (state.planId) clearChat();
    state.planId = p.agentId;
    save();
  }
}

function stampPlan() {
  if (stamping || !has('update')) return;
  stamping = true;
  const run = () => {
    try {
      if (plan() && !plan().agentId) store.update((q) => { q.agentId = uid('plan'); });
    } catch (e) { console.error(e); } finally { stamping = false; }
    const p = plan();
    if (p?.agentId && state.planId !== p.agentId) { state.planId = p.agentId; save(); }
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(run); else run();
}

let unsubscribe = null;
// Listens to the store so the chat clears when the plan is replaced. Runs once when this file loads.
export function initAgent() {
  if (unsubscribe || !has('subscribe')) return;
  unsubscribe = store.subscribe(() => { try { syncIdentity(); } catch (e) { console.error(e); } });
  try { syncIdentity(); } catch (e) { console.error(e); }
}
initAgent();

// ------------------------------------------------------------------ the context

function guestCountsIn(text, current) {
  const t = String(text || '').toLowerCase();
  const found = [];
  const add = (v) => { const n = Number(v); if (n >= 10 && n <= 1500 && n !== current && !found.includes(n)) found.push(n); };
  for (const m of t.matchAll(/\b(\d{2,4})\s*(?:guests?|people|persons|attendees|invitees|heads|folks|seats)\b/g)) add(m[1]);
  for (const m of t.matchAll(/\b(?:guest count|headcount|guests)\s*(?:of|to|at|is|=)?\s*(\d{2,4})\b/g)) add(m[1]);
  return found.slice(0, 2);
}

function impactRow(p, n, today) {
  const imp = calcGuestImpact(p, n, template, today);
  return { guests: imp.guests, planTotal: imp.total, change: imp.change, perGuest: imp.perGuest, overBy: imp.overBy, onTrack: imp.overBy === 0 };
}

// The most guests the plan still covers, found with money.js (guestImpact), or null when even one guest is over.
function maxGuestsOnTrack(p, today) {
  const ok = (n) => calcGuestImpact(p, n, template, today).overBy === 0;
  if (!ok(1)) return null;
  let lo = 1; let hi = 1500;
  if (ok(hi)) return hi;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

function payHandles() {
  try {
    const h = JSON.parse(localStorage.getItem(PAY_KEY) || '{}') || {};
    const out = {};
    for (const k of ['zelle', 'venmo', 'cashapp']) if (typeof h[k] === 'string' && h[k].trim()) out[k] = h[k].trim();
    return out;
  } catch { return {}; }
}

// Vendors the couple has something with: saved vendors, quotes, and vendors named on a line.
function vendorList() {
  const p = plan();
  if (!p) return [];
  const map = new Map();
  const put = (v) => {
    const name = clip(v.name, 80);
    if (!name) return;
    const id = v.id || slug(name);
    const cur = map.get(id) || { id, name };
    map.set(id, { ...cur, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== null && x !== '')), id, name });
  };
  for (const v of safe('getSavedVendors', [])) put({ id: v.id, name: v.name, category: v.category });
  for (const q of p.quotes || []) put({ name: q.vendor, category: q.category, lineId: q.decoded?.lineId, quote: true });
  for (const l of p.lines || []) if (l.vendor) put({ name: l.vendor, lineId: l.id });
  return [...map.values()].map((v) => {
    const thread = safe('getThread', [], v.id);
    const last = thread[thread.length - 1];
    return {
      id: v.id, name: v.name, ...(v.category ? { category: clip(v.category, 40) } : {}), ...(v.lineId ? { lineId: v.lineId } : {}),
      ...(v.quote ? { hasQuote: true } : {}),
      ...(thread.length ? { messages: thread.length, last: { from: last.from, status: last.status, text: clip(last.text, 100) } } : {})
    };
  }).slice(0, 12);
}

function subscriptionList(bank, s) {
  const recurring = Array.isArray(bank?.recurring) ? bank.recurring : [];
  if (!recurring.length) return { list: [], goIds: [], totals: null };
  const { go, stay } = subs.splitSubs(recurring, bank.transactions || []);
  const rows = [...go.map((r) => ({ r, keep: 'go' })), ...stay.map((r) => ({ r, keep: 'stay' }))]
    .sort((a, b) => b.r.monthly - a.r.monthly)
    .slice(0, 12)
    .map(({ r, keep }) => ({
      id: r.id, name: niceName(r.name), monthly: r.monthly, keep,
      ...(subs.getCancelled(r.id) ? { cancelled: true } : {})
    }));
  const goMonthly = monthlyFreed(go);
  return {
    list: rows,
    goIds: go.map((r) => r.id),
    totals: { couldGoMonthly: goMonthly, couldGoByWedding: freedByWedding(goMonthly, s.monthsLeft), alreadyToWeddingMonthly: Number(plan()?.money?.freedMonthly) || 0 }
  };
}

// ------------------------------------------------------------------ the path, the buffer and the wedding style (Round 6)

// Which step the couple asked about ("Ask Padrino" on a step). It stays the focus for follow-up questions for a while.
const FOCUS_MS = 30 * 60 * 1000;

function activeFocus() {
  if (focus && Date.now() - focus.at < FOCUS_MS) return focus.nodeId;
  focus = null;
  return null;
}

// Set or clear (null) the step the chat is about. askAbout() sets it for you.
export function setChatFocus(nodeId) { focus = nodeId ? { nodeId, at: Date.now() } : null; }
export function getChatFocus() { return activeFocus(); }

// A step as the model sees it: where it is, what is in it and the researched lesson behind each part. Short.
function nodeSummary(node, section) {
  return {
    id: node.id, title: node.title, section: section?.title || '', status: node.status,
    ...(node.short ? { about: clip(node.short, 120) } : {}),
    ...(node.doneNote ? { doneNote: clip(node.doneNote, 120) } : {}),
    ...(node.lockedNote ? { lockedNote: node.lockedNote } : {}),
    ...(node.bookNote ? { bookNote: node.bookNote } : {}),
    ...(node.manual ? { markedDoneByCouple: true } : {}),
    ...(node.problem ? { problem: clip(node.problem.reason, 160) || 'reopened' } : {}),
    ...(node.tradition ? { weddingStyle: node.tradition } : {}),
    steps: node.steps.map((st) => ({
      id: st.id, kind: st.kind, title: clip(st.title, 70), body: clip(st.body, 220), done: Boolean(st.done),
      ...(st.lesson ? { lesson: clip(st.lesson, 160) } : {})
    }))
  };
}

function pathContext(today, aboutId) {
  let path;
  try { path = getPath({ today }); } catch (e) { console.error(e); return null; }
  const all = path.sections.flatMap((s) => s.nodes.map((n) => ({ n, s })));
  const cur = all.find((x) => x.n.id === path.current);
  const out = { progress: { done: path.progress.done, total: path.progress.total }, current: cur ? nodeSummary(cur.n, cur.s) : null };
  const hit = aboutId ? all.find((x) => x.n.id === aboutId) : null;
  if (hit) out.about = nodeSummary(hit.n, hit.s);
  const problems = all.filter((x) => x.n.problem).slice(0, 3).map((x) => ({ id: x.n.id, title: x.n.title, reason: clip(x.n.problem.reason, 120) }));
  if (problems.length) out.reopened = problems;
  return out;
}

// The buffer: money the couple always keeps in the bank. warn means a payment in the next 60 days would push the bank under it.
function bufferContext() {
  const b = safe('getBufferCheck', null);
  if (!b) return { keep: 0, connected: false };
  return {
    keep: b.keep, connected: b.connected, cash: b.cash, warn: b.warn, text: b.text,
    ...(b.warn ? { shortBy: b.shortBy } : {}),
    ...(b.lowest ? { lowest: { date: b.lowest.date, balanceAfter: b.lowest.balanceAfter } } : {}),
    upcoming: b.upcoming.slice(0, 6).map((u) => ({ date: u.date, label: clip(u.label, 40), amount: u.amount, balanceAfter: u.balanceAfter }))
  };
}

// The snapshot sent with every turn. Numbers come from money.js (through calc.js) and the store. Aim: under 14,000
// characters for the demo couple.
export function buildContext({ userText = '', about = activeFocus() } = {}) {
  const p = plan();
  const today = todayISO();
  if (!p) return { today, noPlan: true };
  const s = summary(p, template, today);
  const tl = paymentTimeline(p, today);
  const people = pledgeSummary(p).people;
  const bank = safe('getBankData', null);

  const money = (p.lines || []).filter((l) => l.id !== 'cushion');
  const lines = money.filter((l) => l.planned > 0 || l.committed > 0 || l.paid > 0)
    .map((l) => ({
      id: l.id, item: clip(l.item, 40), planned: l.planned, committed: l.committed, paid: l.paid,
      ...(l.vendor ? { vendor: clip(l.vendor, 40) } : {}), ...(l.protected ? { protected: true } : {})
    }));
  const otherLines = {};
  for (const l of money) if (!(l.planned > 0 || l.committed > 0 || l.paid > 0)) otherLines[l.id] = clip(l.item, 40);

  const open = tl.payments.filter((x) => x.status !== 'paid');
  const monthEnd = today.slice(0, 7);
  const thisMonth = open.filter((x) => !x.overdue && String(x.dueDate || '').slice(0, 7) === monthEnd);
  const { list: subList, totals } = subscriptionList(bank, s);
  const guestNow = Number(p.couple?.guests) || 0;

  const ctx = {
    today,
    couple: { names: p.couple.names, date: p.couple.weddingDate, daysToWedding: s.daysToWedding, city: p.couple.city, guests: guestNow, demo: Boolean(p.demo) },
    plan: {
      planned: s.planned, committed: s.committed, paid: s.paid, cushion: s.cushion, needed: s.needed, available: s.available,
      gap: s.gap, overBy: s.overBy, onTrack: s.onTrack, perGuest: s.perGuest, monthsLeft: s.monthsLeft,
      saved: Number(p.money?.saved) || 0, monthlySaving: Number(p.money?.monthly) || 0, savedByWedding: s.savedByWedding,
      pledged: s.pledged, pledgesReceived: s.pledgesReceived, pledgesOutstanding: s.pledgesOutstanding,
      maxGuestsOnTrack: maxGuestsOnTrack(p, today),
      forgottenOpen: s.forgottenOpen.slice(0, 5)
    },
    lines,
    otherLines,
    payments: {
      open: open.slice(0, 12).map((x) => ({ id: x.id, label: clip(x.label, 50), amount: x.amount, dueDate: x.dueDate, lineId: x.lineId, ...(x.overdue ? { overdue: true } : {}) })),
      nextDueId: tl.nextDue?.id || null,
      overdueTotal: tl.overdueTotal,
      dueRestOfThisMonth: { total: cents(thisMonth.reduce((a, x) => a + x.amount, 0)), count: thisMonth.length },
      dueNext30Days: tl.next30Total,
      paidCount: tl.payments.length - open.length
    },
    pledges: people.map((x) => ({ id: x.id, name: x.name, item: x.item, lineId: x.lineId, amount: x.amount, received: x.received, ...(x.strings ? { strings: clip(x.strings, 80) } : {}) })),
    bank: bank
      ? {
        connected: true, cash: bank.cash ?? null, checkedAt: bank.fetchedAt || null, recurringMonthly: bank.recurringMonthly ?? null,
        accounts: (bank.accounts || []).slice(0, 5).map((a) => ({ name: clip(a.name, 30), type: a.type, balance: a.current ?? null }))
      }
      : { connected: false },
    subscriptions: subList,
    ...(totals ? { subscriptionTotals: totals } : {}),
    history: safe('getHistory', []).slice(0, 10).map((h) => ({ id: h.id, date: h.date, kind: h.kind, title: clip(h.title, 50), amount: h.amount, status: h.status, ...(h.note ? { note: clip(h.note, 100) } : {}) })),
    unplanned: safe('getUnplanned', []).slice(0, 5),
    alerts: safe('getAlerts', []).filter((a) => a.kind !== 'buffer').slice(0, 3).map((a) => ({ id: a.id, vendor: a.vendor, text: clip(a.text, 200) })),
    buffer: bufferContext(),
    traditions: (() => { const t = safe('getTraditions', { ids: [], names: [], notes: '' }); return { ids: t.ids, names: t.names, ...(t.notes ? { notes: clip(t.notes, 300) } : {}) }; })(),
    path: pathContext(today, about),
    vendors: vendorList(),
    contracts: safe('getContracts', []).map((c) => clip(c.vendor || c.vendorName, 60)).slice(0, 6),
    canMakeSponsorLink: Object.keys(payHandles()).length > 0
  };
  const asked = guestCountsIn(userText, guestNow);
  if (asked.length) ctx.whatIf = asked.map((n) => impactRow(p, n, today));
  return ctx;
}

// ------------------------------------------------------------------ checking an action against the plan as it is now

// Which argument holds which kind of id. Returns the list of things that no longer exist.
function missingRefs(args) {
  const p = plan();
  if (!p) return ['plan'];
  const gone = [];
  const open = new Set((p.payments || []).map((x) => x.id));
  const lines = new Set((p.lines || []).map((x) => x.id));
  const pledges = new Set((p.pledges || []).map((x) => x.id));
  const bank = safe('getBankData', null);
  const subIds = new Set((bank?.recurring || []).map((r) => r.id));
  const tx = new Set(safe('getUnplanned', []).map((u) => u.transactionId));
  const alerts = new Set(safe('getAlerts', []).map((a) => a.id));
  const check = (key, set) => { if (args[key] && !set.has(args[key])) gone.push(key); };
  check('paymentId', open); check('lineId', lines); check('pledgeId', pledges);
  check('subscriptionId', subIds); check('transactionId', tx); check('alertId', alerts);
  if (Array.isArray(args.subscriptionIds)) for (const id of args.subscriptionIds) if (!subIds.has(id)) gone.push('subscriptionIds');
  return gone;
}

// Plain checks before anything runs. Returns { ok, message }.
export function checkAction(action) {
  const def = ACTIONS[action?.name];
  if (!def) return { ok: false, message: 'I do not know how to do that one.' };
  const args = action.args && typeof action.args === 'object' ? action.args : {};
  if (missingRefs(args).length) return { ok: false, message: STALE };
  const amountOk = args.amount === undefined || (isNum(Number(args.amount)) && Number(args.amount) > 0);
  if (!amountOk) return { ok: false, message: 'That amount does not look right. Tell me the amount again.' };
  if (action.name === 'update_line' && !(Number(args.planned) >= 0)) return { ok: false, message: 'That amount does not look right. Tell me the amount again.' };
  if (action.name === 'set_guests' && !(Number(args.guests) >= 1)) return { ok: false, message: 'Tell me how many guests.' };
  if (action.name === 'put_freed_toward_wedding' && !pickSubs(args).length) return { ok: false, message: 'There is nothing to move yet. Pick which subscriptions could go in Find money.' };
  return { ok: true, message: '' };
}

// ------------------------------------------------------------------ the actions

// What a finished record says, in the bank's own status words. Every record function returns a history id.
function recordedText(id, lead) {
  const h = safe('getHistory', []).find((x) => x.id === id);
  if (!h) return `${lead} I will watch your bank for it.`;
  if (h.status === 'verified') return `${lead} Your bank already shows it.`;
  if (h.status === 'different') return `${lead} ${h.note}`;
  return `${lead} I will watch your bank for it.`;
}

function subById(id) { return (safe('getBankData', null)?.recurring || []).find((r) => r.id === id) || null; }

function goIds() {
  const bank = safe('getBankData', null);
  if (!bank?.recurring?.length) return [];
  return subs.splitSubs(bank.recurring, bank.transactions || []).go.map((r) => r.id);
}

function titleList(list) {
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

const SCREEN_LABEL = {
  budget: 'the budget', payments: 'payments', family: 'family', vendors: 'vendors', 'find-money': 'Find money',
  fixer: 'the fixer', contract: 'the contract check', after: 'after the wedding'
};


function resolveVendor(args) {
  const list = vendorList();
  if (args.vendorId) {
    const v = list.find((x) => x.id === args.vendorId);
    if (v) return { id: v.id, name: v.name, category: v.category || args.category || '' };
  }
  const name = clip(args.vendorName, 100);
  const id = slug(name);
  const known = list.find((x) => x.id === id);
  return { id, name: known?.name || name, category: known?.category || args.category || '' };
}

function quoteOf(vendorName) {
  const id = slug(vendorName);
  const q = (plan()?.quotes || []).find((x) => slug(x.vendor) === id);
  return q?.decoded || null;
}

function imageFor(action) {
  const img = action?.image || (action?.id ? pendingImages.get(action.id) : null);
  if (!img?.data) return null;
  return { mediaType: img.mediaType || 'image/jpeg', data: img.data, preview: img.preview || `data:${img.mediaType || 'image/jpeg'};base64,${img.data}` };
}

export const ACTIONS = {
  record_payment: {
    label(a) {
      const pay = paymentById(a.paymentId);
      const amount = isNum(Number(a.amount)) && Number(a.amount) > 0 ? Number(a.amount) : pay?.amount;
      const what = pay?.label || a.who || lineName(a.lineId);
      return amount ? `Record ${usd(amount)} paid: ${what}` : `Record paid: ${what}`;
    },
    preview(a) {
      const pay = paymentById(a.paymentId);
      if (!pay) return 'Marks it paid, then waits for your bank to show it.';
      const said = Number(a.amount);
      if (said > 0 && cents(said) !== pay.amount) {
        const diff = cents(said - pay.amount);
        return `The plan has ${usd(pay.amount)}. You said ${usd(said)}, which is ${usd(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'}. Then I wait for your bank.`;
      }
      return `Marks it paid at ${usd(pay.amount)}, then waits for your bank to show it.`;
    },
    async run(a) {
      const id = call('recordPayment', { paymentId: a.paymentId, lineId: a.lineId, amount: a.amount, date: a.date, who: a.who });
      const pay = paymentById(a.paymentId);
      return recordedText(id, `Recorded${pay ? `: ${pay.label}, ${usd(pay.amount)}.` : '.'}`);
    }
  },

  record_family_money: {
    label(a) {
      const pledge = pledgeById(a.pledgeId);
      const who = pledge?.name || a.name || 'family';
      const item = (a.item || pledge?.item || '').toLowerCase();
      return `Record ${usd(a.amount)} from ${who}${item ? ` toward the ${item}` : ''}`;
    },
    preview(a) {
      const pledge = pledgeById(a.pledgeId);
      if (!pledge) return `Starts a new pledge for ${a.name || 'them'} and waits for your bank to show the money.`;
      const after = cents((Number(pledge.received) || 0) + Number(a.amount));
      const verb = /\band\b|&/i.test(pledge.name) ? 'have' : 'has';
      return `${pledge.name} ${verb} given ${usd(pledge.received || 0)} of ${usd(pledge.amount)}. After this: ${usd(after)}. Then I wait for your bank.`;
    },
    async run(a) {
      const id = call('recordFamilyMoney', { pledgeId: a.pledgeId, name: a.name || pledgeById(a.pledgeId)?.name, amount: a.amount, date: a.date, item: a.item });
      return recordedText(id, `Recorded ${usd(a.amount)} from ${a.name || pledgeById(a.pledgeId)?.name || 'family'}.`);
    }
  },

  add_pledge: {
    label(a) { return `Add ${a.name}'s ${usd(a.amount)}${a.item ? ` for the ${a.item.toLowerCase()}` : ''} to Family`; },
    preview(a) { return `A new pledge: ${a.name}, ${usd(a.amount)}${a.item ? `, ${a.item.toLowerCase()}` : ''}. Nothing is received yet.${a.strings ? ` Strings: ${a.strings}` : ''}`; },
    async run(a) {
      call('addPledge', { name: a.name, relation: a.relation || '', lineId: a.lineId || null, item: a.item || '', amount: a.amount, received: 0, strings: a.strings || '' });
      return `Added ${a.name} to Family: ${usd(a.amount)} promised.`;
    }
  },

  record_expense: {
    label(a) { return `Record ${usd(a.amount)} spent${a.who ? ` at ${a.who}` : ''}${a.lineId ? ` on ${lineName(a.lineId)}` : ''}`; },
    preview(a) { return `Adds it to ${a.lineId ? lineName(a.lineId) : 'the budget'} as money out, then waits for your bank to show it.`; },
    async run(a) {
      const id = call('recordExpense', { lineId: a.lineId || null, amount: a.amount, date: a.date, who: a.who || '', note: a.note || '' });
      return recordedText(id, `Recorded ${usd(a.amount)}${a.who ? ` at ${a.who}` : ''}.`);
    }
  },

  set_guests: {
    label(a) { return `Change the guest count to ${a.guests}`; },
    preview(a) {
      const p = plan();
      if (!p) return '';
      const imp = calcGuestImpact(p, a.guests, template);
      const move = imp.change === 0 ? 'The plan total stays the same' : `The plan total moves ${imp.change > 0 ? 'up' : 'down'} by ${usd(Math.abs(imp.change))}`;
      const tail = imp.overBy > 0 ? ` You would be ${usd(imp.overBy)} over.` : ' You stay on track.';
      const booked = imp.hasCommitted ? ' Some booked prices would change, so check with those vendors.' : '';
      return `${p.couple.guests} to ${a.guests} guests. ${move}.${tail}${booked}`;
    },
    async run(a) {
      const p = plan();
      const imp = calcGuestImpact(p, a.guests, template);
      call('setGuests', a.guests, imp.scaledLines);
      return `Guest count is now ${a.guests}. The plan total moved ${imp.change >= 0 ? 'up' : 'down'} by ${usd(Math.abs(imp.change))}.`;
    }
  },

  update_line: {
    label(a) { return `Set aside ${usd(a.planned)} for ${lineName(a.lineId)}`; },
    preview(a) {
      const l = lineById(a.lineId);
      if (!l) return '';
      const hold = Math.max(Number(l.committed) || 0, Number(l.paid) || 0);
      const note = hold > a.planned ? ` It is already booked at ${usd(hold)}, so the plan total will not go below that.` : '';
      return `${lineName(a.lineId)} goes from ${usd(l.planned)} to ${usd(a.planned)}.${note}`;
    },
    async run(a) {
      call('updateLine', a.lineId, { planned: a.planned });
      return `${lineName(a.lineId)} is now ${usd(a.planned)} in the plan.`;
    }
  },

  put_freed_toward_wedding: {
    label(a) {
      const picked = pickSubs(a);
      return `Put ${usd(monthlyFreed(picked))} a month${picked.length ? ` from ${titleList(picked.map((r) => niceName(r.name)))}` : ''} toward the wedding`;
    },
    preview(a) {
      const picked = pickSubs(a);
      const p = plan();
      const s = p ? summary(p, template) : { monthsLeft: 0 };
      const m = monthlyFreed(picked);
      return `${usd(m)} a month is about ${usd(freedByWedding(m, s.monthsLeft))} by the wedding. This only moves the number in your plan. You still cancel each one yourself.`;
    },
    async run(a) {
      const picked = pickSubs(a);
      const m = monthlyFreed(picked);
      if (!m) throw new Error('There is nothing to move yet. Pick which subscriptions could go in Find money.');
      call('putFreedTowardWedding', { monthly: m, names: picked.map((r) => niceName(r.name)) });
      return `${usd(m)} a month now goes toward the wedding savings.`;
    }
  },

  mark_subscription_cancelled: {
    label(a) { const r = subById(a.subscriptionId); return `Mark ${niceName(r?.name || 'it')} as cancelled`; },
    preview(a) {
      const r = subById(a.subscriptionId);
      return r ? `${niceName(r.name)}, ${usd(r.monthly)} a month. I will watch your bank for a new charge.` : '';
    },
    async run(a) {
      const r = subById(a.subscriptionId);
      if (!r) throw new Error(STALE);
      subs.markCancelled(r);
      if (has('recordSubscriptionCancelled')) call('recordSubscriptionCancelled', { name: niceName(r.name), monthly: Number(r.monthly) || 0 });
      return `Marked ${niceName(r.name)} as cancelled. I will watch your bank and tell you if a charge still shows up.`;
    }
  },

  draft_vendor_message: {
    label(a) { return `Draft a message to ${resolveVendor(a).name}`; },
    preview(a) {
      const about = clip(a.details, 200);
      const tail = about ? ` About: ${about.charAt(0).toUpperCase()}${about.slice(1)}${/[.!?]$/.test(about) ? '' : '.'}` : '';
      return `I write it. You read it, change what you like, and send it yourself.${tail}`;
    },
    async run(a) {
      const v = resolveVendor(a);
      const p = plan();
      const body = {
        vendor: { name: v.name, category: v.category },
        goal: a.goal,
        details: a.details || '',
        couple: { names: p.couple.names, date: p.couple.weddingDate, guests: p.couple.guests }
      };
      const quote = quoteOf(v.name);
      if (quote) body.quote = quote;
      let res; let data = null;
      try {
        res = await fetch('api/draft-message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        data = await res.json().catch(() => null);
      } catch { throw new Error('Could not reach the server. Is it running?'); }
      if (!res.ok || !data?.body) throw new Error(data?.message || 'Could not write that message. Try again.');
      if (has('saveVendor')) call('saveVendor', { id: v.id, name: v.name, category: v.category });
      call('addMessage', v.id, { from: 'you', text: data.body, subject: data.subject || '', status: 'draft', channel: 'copy', goal: a.goal });
      navigate(`/thread/${v.id}`);
      return `Draft saved in your messages with ${v.name}. Read it, change what you like, then send it yourself.`;
    }
  },

  create_padrino_link: {
    label(a) { return `Make a link for ${a.forName || 'a relative'} to sponsor the ${a.item.toLowerCase()}, ${usd(a.amount)}`; },
    preview() {
      const have = Object.keys(payHandles());
      return have.length
        ? `A page where they can sponsor it. They pay you by ${titleList(have.map((k) => ({ zelle: 'Zelle', venmo: 'Venmo', cashapp: 'Cash App' }[k])))}, straight to you, and your bank shows it when it arrives. You send the link yourself.`
        : 'You need a Zelle, Venmo or Cash App name first. I will take you to Family to add one.';
    },
    async run(a) {
      const pay = payHandles();
      if (!Object.keys(pay).length) {
        navigate('/family');
        throw new Error('Add your Zelle, Venmo or Cash App name on the Family screen first, then ask me again.');
      }
      const link = await call('createGiveLink', {
        kind: 'padrino', ...(a.forName ? { to: a.forName } : {}),
        items: [{ id: slug(a.item), label: a.item, amount: a.amount, ...(a.pledgeId ? { pledgeId: a.pledgeId } : {}) }],
        pay,
        note: a.note || `If you would like to help with the ${a.item.toLowerCase()}, this is the real cost. Thank you.`
      });
      try { await navigator.clipboard?.writeText(link.url); } catch { /* the link is in the message anyway */ }
      return `Link ready: ${link.url}. Send it to ${a.forName || 'them'} yourself. They pay you directly and your bank shows it when it arrives.`;
    }
  },

  decode_quote: {
    label() { return 'Read this quote'; },
    preview(a, action) { return imageFor(action) || a.text ? 'Opens the quote reader and shows what it really costs, with the extras in.' : 'Opens the quote reader. You add the photo or text there.'; },
    async run(a, action) {
      const { prefillQuote } = await import('./screens/quotes.js');
      const image = imageFor(action);
      prefillQuote({ text: a.text || '', image: image ? { mediaType: image.mediaType, data: image.data } : null, preview: image?.preview || null });
      navigate('/quotes');
      return 'Opening the quote reader.';
    }
  },

  check_contract: {
    label() { return 'Check this contract'; },
    preview(a, action) { return imageFor(action) || a.text ? 'Opens the contract check: what you owe if you cancel, date changes, red flags.' : 'Opens the contract check. You add the photo or text there.'; },
    async run(a, action) {
      const { prefillContract } = await import('./screens/contract.js');
      const image = imageFor(action);
      prefillContract({ text: a.text || '', image: image ? { mediaType: image.mediaType, data: image.data } : null, preview: image?.preview || null });
      navigate('/contract');
      return 'Opening the contract check.';
    }
  },

  open_screen: {
    label(a) { return `Open ${SCREEN_LABEL[a.screen] || a.screen}`; },
    preview() { return ''; },
    async run(a) {
      navigate(`/${a.screen}`);
      return `Opening ${SCREEN_LABEL[a.screen] || a.screen}.`;
    }
  },

  accept_unplanned: {
    label(a) {
      const u = unplannedOf(a.transactionId);
      const line = a.lineId || u?.guessLineId;
      return `Add ${u ? `${usd(u.amount)} at ${niceName(u.merchant)}` : 'that charge'} to ${line ? lineName(line) : 'the budget'}`;
    },
    preview() { return 'Files it as wedding spending your bank already shows.'; },
    async run(a) {
      const u = unplannedOf(a.transactionId);
      const lineId = a.lineId || u?.guessLineId || null;
      const id = call('acceptUnplanned', a.transactionId, lineId);
      if (!id) throw new Error('That charge is already counted or gone.');
      return `Added${u ? ` ${usd(u.amount)} at ${niceName(u.merchant)}` : ''} to ${lineId ? lineName(lineId) : 'the budget'}.`;
    }
  },

  dismiss_unplanned: {
    label(a) { const u = unplannedOf(a.transactionId); return `Not the wedding${u ? `: ${usd(u.amount)} at ${niceName(u.merchant)}` : ''}`; },
    preview() { return 'It will not show up again.'; },
    async run(a) { call('dismissUnplanned', a.transactionId); return 'Got it. I will not ask about that charge again.'; }
  },

  dismiss_alert: {
    label(a) { const al = safe('getAlerts', []).find((x) => x.id === a.alertId); return `Close the alert${al?.vendor ? ` about ${al.vendor}` : ''}`; },
    preview() { return 'Only close it once you have called the vendor on a number you already had.'; },
    async run(a) { call('dismissAlert', a.alertId); return 'Alert closed.'; }
  }
};

function unplannedOf(id) { return safe('getUnplanned', []).find((u) => u.transactionId === id) || null; }

function pickSubs(a) {
  const bank = safe('getBankData', null);
  const all = bank?.recurring || [];
  const ids = Array.isArray(a.subscriptionIds) && a.subscriptionIds.length ? a.subscriptionIds : goIds();
  return ids.map((id) => all.find((r) => r.id === id)).filter(Boolean);
}

export const ACTION_NAMES = Object.keys(ACTIONS);

// What the card shows under the label: a small preview in plain text (escape it before putting it in HTML).
export function previewAction(action) {
  const def = ACTIONS[action?.name];
  if (!def?.preview) return '';
  try { return def.preview(action.args || {}, action) || ''; } catch (e) { console.error(e); return ''; }
}

export function labelAction(action) {
  const def = ACTIONS[action?.name];
  if (!def) return '';
  try { return def.label(action.args || {}, action); } catch (e) { console.error(e); return action.name; }
}

function setActionStatus(actionId, status, result) {
  if (!actionId) return;
  for (const t of state.turns) {
    const a = (t.actions || []).find((x) => x.id === actionId);
    if (a) { a.status = status; if (result) a.result = result; }
  }
  save();
}

// Runs one approved action. Resolves with a short result sentence and files a "done" note in the chat.
// Throws an Error with a plain message when it cannot (the plan changed, the server is down). Nothing is
// filed as done in that case.
export async function runAction(action) {
  await ready();
  syncIdentity();
  const check = checkAction(action);
  if (!check.ok) throw new Error(check.message);
  const def = ACTIONS[action.name];
  const text = await def.run(action.args || {}, action);
  setActionStatus(action.id, 'done', text);
  if (action.id) pendingImages.delete(action.id);
  addTurn({ role: 'padrino', kind: 'done', text, actionId: action.id || null });
  return text;
}

// "Not now" on a card. The model is told, so it does not suggest the same thing again straight away.
export function skipAction(action) {
  setActionStatus(action?.id, 'skipped');
  if (action?.id) pendingImages.delete(action.id);
  changed();
}

// ------------------------------------------------------------------ talking to the server

function chatError(res, data) {
  const missing = res?.status === 404 && !(data && data.message);
  const e = new Error(missing ? 'Chat is not switched on yet. The server needs a restart.' : (data && data.message) || 'Padrino could not answer just now. Try again.');
  e.status = res?.status || 0;
  e.code = missing ? 'no_route' : (data && data.error) || 'chat_failed';
  return e;
}

// What each past turn looks like to the model: the words, plus a note on any card still open or turned down.
function serverMessages() {
  const out = [];
  const b = state.brief;
  if (b && b.date === todayISO() && b.text) out.push({ role: 'padrino', text: b.text });
  for (const t of state.turns.filter((x) => !x.failed).slice(-SEND_TURNS)) {
    let text = t.text || '';
    const notes = [];
    for (const a of t.actions || []) {
      if (a.status === 'skipped') notes.push(`They said not now to: ${labelAction(a)}.`);
      else if (a.status === 'proposed') notes.push(`Waiting for their tap: ${labelAction(a)}.`);
    }
    if (notes.length) text = `${text}\n(System note, never repeat it: ${notes.join(' ')})`;
    out.push({ role: t.role === 'user' ? 'user' : 'padrino', text, ...(t.hasImage ? { image: { omitted: true } } : {}) });
  }
  return out;
}

// Sends one turn. image is { mediaType, data (base64), preview? }. about is a path node id (see askAbout) and aboutNode
// is the context askAbout() gave back: the context then carries that step so Padrino answers about it. Resolves with { reply, actions, show, turnId }.
// Each action is { id, name, args, why, status: 'proposed' }. On a failure nothing is stored; the Error has
// .code and .status (503 no_key, 422, 500), and the couple's text should stay in the box.
export async function sendChat(text, { image = null, about, aboutNode } = {}) {
  await ready();
  syncIdentity();
  const clean = String(text || '').trim();
  if (!clean && !image) throw new Error('Say something or add a photo.');

  const messages = serverMessages();
  messages.push({ role: 'user', text: clean, ...(image?.data ? { image: { mediaType: image.mediaType || 'image/jpeg', data: image.data } } : {}) });
  // The step they asked about stays the topic for follow-ups. aboutNode is the context askAbout() returned (or just
  // a node id); it works the same as about.
  const aboutId = about || (typeof aboutNode === 'string' ? aboutNode : aboutNode?.id) || null;
  if (aboutId) setChatFocus(aboutId);
  const context = buildContext({ userText: clean, about: aboutId || activeFocus() });
  if (aboutNode && typeof aboutNode === 'object' && aboutNode.id && context.path && !context.path.about) {
    context.path.about = { ...aboutNode, steps: Array.isArray(aboutNode.steps) ? aboutNode.steps.slice(0, 5) : [] }; // the step is gone from the path, but they asked about it
  }

  let res; let data = null;
  try {
    res = await fetch('api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, context }) });
    data = await res.json().catch(() => null);
  } catch {
    const e = new Error('Could not reach the server. Is it running?');
    e.code = 'network'; e.status = 0;
    throw e;
  }
  if (!res.ok || !data || typeof data.reply !== 'string') throw chatError(res, data);

  addTurn({ role: 'user', text: clean, hasImage: Boolean(image?.data) });
  const actions = [];
  for (const a of Array.isArray(data.actions) ? data.actions : []) {
    if (!ACTIONS[a?.name]) continue;
    const action = { id: uid('act'), name: a.name, args: a.args && typeof a.args === 'object' ? a.args : {}, why: clip(a.why, 160), status: 'proposed' };
    if (missingRefs(action.args).length) continue; // the plan moved while the model was thinking
    if (image?.data && (a.name === 'decode_quote' || a.name === 'check_contract')) pendingImages.set(action.id, { ...image });
    actions.push(action);
  }
  const show = typeof data.show === 'string' ? data.show : null;
  const turn = addTurn({ role: 'padrino', text: data.reply, actions, show });
  return { reply: data.reply, actions, show, turnId: turn.id };
}

// ------------------------------------------------------------------ the daily brief

const moneyKinds = new Set(['family', 'income']);
const THAN = { plan: 'than planned', you: 'than you wrote down', pledge: 'than pledged' };
const after = (iso, since) => Boolean(iso) && String(iso) > since;

function greetingFor(p) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const who = p?.couple?.names?.filter(Boolean).length ? coupleNames(p) : '';
  return who ? `${part}, ${who}.` : `${part}.`;
}

function gapWords(s) {
  if (!s.planned) return 'Your plan has no amounts yet, so there is no gap to show.';
  if (s.onTrack) return s.gap >= 1 ? `You are on track, with about ${usd(Math.round(s.gap))} to spare.` : 'You are right on track.';
  const small = s.needed > 0 && s.overBy / s.needed <= 0.03;
  return `You are ${small ? 'a little over' : 'over'} what you have for the wedding. The gap is about ${usd(Math.round(s.overBy))}.`;
}

function nextStep(p, s, tl, bank, goMonthly, alerts, unplanned) {
  if (tl.overdue.length) {
    const o = tl.overdue[0];
    return { kind: 'next', text: `If you already paid ${o.label}, tell me and I will record it.` };
  }
  if (alerts.length) return { kind: 'next', text: `Before you pay ${alerts[0].vendor || 'that vendor'}, call them on a number you already had.` };
  if (!s.onTrack) return { kind: 'next', text: 'Open the fixer to see what to trim first, starting with the things you will miss least.', action: { name: 'open_screen', args: { screen: 'fixer' }, why: 'Ranked ways to close the gap.' } };
  if (!bank) return { kind: 'next', text: 'Connect your bank and I can check every payment for you.' };
  if (goMonthly > 0 && !(Number(p.money?.freedMonthly) > 0)) {
    return { kind: 'next', text: `Subscriptions you could drop add up to ${usd(goMonthly)} a month. Take a look in Find money.`, action: { name: 'open_screen', args: { screen: 'find-money' }, why: 'Pick which ones could go.' } };
  }
  if (s.forgottenOpen.length) {
    const l = lineById(s.forgottenOpen[0]);
    return { kind: 'next', text: `Couples often forget ${lineShort(l) || 'a few costs'}. Worth a look in the budget.`, action: { name: 'open_screen', args: { screen: 'budget' }, why: 'Costs people forget.' } };
  }
  if (!p.payments.length && !p.quotes.length) return { kind: 'next', text: 'Send me a photo of a vendor quote and I will show what it really costs.' };
  if (unplanned.length) return { kind: 'next', text: 'Tell me about the charges above and your numbers will be right.' };
  return { kind: 'next', text: 'Nothing needs you right now. Ask me anything.' };
}

// The opening of the conversation: { greeting, items: [{ kind, text, action? }] }, five items at most. Built from the
// store and money.js only. Kinds: alert, unplanned, verified, money_in, payment, gap, next. A warning from the buffer
// check comes as kind 'alert' with buffer: true (right after a payment-instructions alert, if there is one).
// The window "since you last opened" is pinned for the day, so asking twice gives the same story.
// pass { fresh: true } to start a new window from now.
export function dailyBrief({ fresh = false } = {}) {
  syncIdentity();
  const p = plan();
  const today = todayISO();
  if (!p) return { greeting: 'Hi.', items: [{ kind: 'next', text: 'Set up your wedding and connect your bank, and I will take it from there.' }] };

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  if (fresh || !state.brief || state.brief.date !== today) {
    state.brief = { date: today, since: state.lastOpened || weekAgo, text: '' };
  }
  const since = state.brief.since;
  state.lastOpened = nowISO();

  const s = summary(p, template, today);
  const tl = paymentTimeline(p, today);
  const bank = safe('getBankData', null);
  const history = safe('getHistory', []);
  const alerts = safe('getAlerts', []).filter((a) => a.kind !== 'buffer'); // payment warnings; the buffer has its own line
  const buffer = safe('getBufferCheck', null);
  const unplanned = safe('getUnplanned', []);
  const goMonthly = bank?.recurring?.length ? monthlyFreed(subs.splitSubs(bank.recurring, bank.transactions || []).go) : 0;

  const items = {};

  if (alerts.length) {
    const a = alerts[0];
    items.alert = { kind: 'alert', short: `${a.vendor || 'A vendor'} changed how to pay. Call before paying.`, text: `${a.vendor || 'A vendor'} changed how to pay. Call them on a number you already had before you send any money.` };
  }

  if (buffer?.warn) {
    items.buffer = { kind: 'alert', buffer: true, short: 'A payment could dip under your cushion.', text: buffer.text, action: { name: 'open_screen', args: { screen: 'payments' }, why: 'See what is due and when.' } };
  }

  if (unplanned.length) {
    const first = [...unplanned].sort((a, b) => b.amount - a.amount)[0]; // the biggest one first
    const where = `${usd(first.amount)} at ${niceName(first.merchant)}`;
    const guess = first.guessLineId ? ` I would put it under ${lineName(first.guessLineId)}.` : '';
    const text = unplanned.length === 1
      ? `Your bank shows ${where} that the plan does not have. Was that for the wedding?${guess}`
      : `Your bank shows ${unplanned.length} charges the plan does not have. The biggest is ${where}. Was that for the wedding?${guess}`;
    items.unplanned = {
      kind: 'unplanned', text, short: `${where}. For the wedding?`,
      action: { name: 'accept_unplanned', args: { transactionId: first.transactionId, ...(first.guessLineId ? { lineId: first.guessLineId } : {}) }, why: 'Your bank shows it and the plan does not have it.' }
    };
  }

  const verified = history.filter((h) => (h.status === 'verified' || h.status === 'different') && !moneyKinds.has(h.kind) && after(h.verifiedAt, since));
  if (verified.length === 1) items.verified = { kind: 'verified', short: `Your bank verified ${String(verified[0].title).toLowerCase()}.`, text: verificationMessage(verified[0]) };
  else if (verified.length > 1) {
    const odd = verified.filter((h) => h.status === 'different' && h.expected != null);
    const first = odd[0];
    const diff = first ? cents(first.amount - first.expected) : 0;
    const note = first ? ` The ${String(first.title).toLowerCase()} came to ${usd(first.amount)}. That is ${usd(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} ${THAN[first.expectedFrom] || THAN.plan}.` : '';
    items.verified = {
      kind: 'verified',
      short: `Your bank verified ${verified.length} things.`,
      text: `Your bank verified ${verified.length} things since you last opened: ${titleList(verified.slice(0, 3).map((h) => String(h.title).toLowerCase()))}.${note}`
    };
  }

  const came = history.filter((h) => moneyKinds.has(h.kind) && (after(h.at, since) || after(h.verifiedAt, since)));
  if (came.length) {
    const bits = came.slice(0, 3).map((h) => `${usd(h.amount)} from ${h.who || h.title}`);
    const allVerified = came.every((h) => h.status !== 'waiting');
    items.money_in = {
      kind: 'money_in',
      short: `Money in: ${bits[0]}${came.length > 1 ? ' and more' : ''}.`,
      text: `Money in: ${titleList(bits)}. ${allVerified ? 'Your bank shows it.' : 'I am waiting for your bank to show it.'}`
    };
  }

  const next = tl.overdue[0] || tl.nextDue;
  if (next) {
    const when = tl.overdue.length ? `was due ${relative(next.dueDate)}` : `is due ${relative(next.dueDate)}, ${fmtDateShort(next.dueDate)}`;
    items.payment = { kind: 'payment', short: `${tl.overdue.length ? 'Overdue' : 'Next'}: ${next.label}, ${relative(next.dueDate)}.`, text: `${tl.overdue.length ? 'Overdue: ' : 'Next payment: '}${next.label}, ${usd(next.amount)}, ${when}.` };
  }

  items.gap = { kind: 'gap', short: Number(s.overBy) > 0 ? `Over by ${usd(s.overBy)}.` : 'Your plan is on track.', text: gapWords(s) };
  const step = nextStep(p, s, tl, bank, goMonthly, alerts, unplanned);
  if (step) items.next = step;

  // Five at most. The gap and the next step always stay; the rest fill in by how much they need the couple.
  const order = ['alert', 'buffer', 'unplanned', 'verified', 'money_in', 'payment', 'gap', 'next'];
  const keep = ['gap', 'next'].filter((k) => items[k]);
  const room = Math.max(0, 5 - keep.length);
  const optional = ['alert', 'buffer', 'unplanned', 'verified', 'money_in', 'payment'].filter((k) => items[k]).slice(0, room);
  const picked = new Set([...keep, ...optional]);
  const list = order.filter((k) => picked.has(k)).map((k) => items[k]);

  const greeting = greetingFor(p);
  state.brief.text = [greeting, ...list.map((i) => i.text)].join(' ');
  save();
  return { greeting, items: list };
}

// ------------------------------------------------------------------ "Ask Padrino" on a path step

// For the Ask Padrino button on a step. Returns { text, context }:
//   text     the starter message for the box, like "Help me with: Lock the photographer"
//   context  the step as Padrino will see it: { id, title, section, status, steps: [{ id, kind, title, body, done,
//            lesson? }], doneNote?, lockedNote?, problem? ... }
// It also makes this step the topic of the chat, so sendChat() sends it with the next turns (for about 30 minutes, or
// until askAbout(null) or clearChat()). You can also pass it by hand: sendChat(text, { about: nodeId }).
// An unknown id gives { text: '', context: null } and clears the topic.
export function askAbout(nodeId) {
  const found = nodeId ? getPathNode(nodeId, { today: todayISO() }) : null;
  if (!found) { setChatFocus(null); return { text: '', context: null }; }
  setChatFocus(nodeId);
  return { text: `Help me with: ${found.node.title}`, context: nodeSummary(found.node, found.section) };
}
