// State for the whole app. One plan object in localStorage.
// Screens read through getPlan() and change through the functions here.
// No money math in this file. Totals come from /lib/money.js.

import { getDemoCouple, getTemplate } from './data.js';
import { uid, todayISO } from './format.js';
import { summary, startingLines, PRIORITY_LINES } from './calc.js';
import {
  logPayment, undoPayment, logFamilyMoney, logExpense, logIncome, logSubscriptionCancelled, logQuote,
  markPaymentsFromBank, verifyAgainstBank, acceptUnplannedCharge, dismissUnplannedCharge,
  cleanInstructions, instructionsDiffer, describeInstructions, bufferCheck
} from '../lib/bank.js';

export const APP_NAME = 'Padrino';
export const STORAGE_KEY = 'padrino.plan.v1';

const listeners = new Set();
let plan = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? normalize(parsed) : null;
  } catch {
    return null;
  }
}

function persist() {
  try {
    if (plan) localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or full storage. The app still works for this session.
  }
}

function notify() {
  for (const fn of listeners) {
    try { fn(plan); } catch (e) { console.error(e); }
  }
}

// Fill any missing pieces so screens never see undefined arrays.
function normalize(p) {
  const out = { ...p };
  out.demo = Boolean(p.demo);
  out.couple = { names: ['', ''], weddingDate: '', city: 'El Paso', guests: 100, ...(p.couple || {}) };
  if (!Array.isArray(out.couple.names)) out.couple.names = ['', ''];
  // Wedding style: ids from traditions.json plus 'own' (Mixed or our own), and the couple's own words about it.
  out.couple.traditions = Array.isArray(out.couple.traditions) ? out.couple.traditions.filter((x) => typeof x === 'string' && x) : [];
  out.couple.traditionNotes = typeof out.couple.traditionNotes === 'string' ? out.couple.traditionNotes : '';
  out.money = { saved: 0, monthly: 0, startMonth: todayISO().slice(0, 7), ...(p.money || {}) };
  out.priorities = { a: [], b: [], top: [], ...(p.priorities || {}) };
  out.lines = Array.isArray(p.lines) ? p.lines.map(normalizeLine) : [];
  out.quotes = Array.isArray(p.quotes) ? p.quotes : [];
  out.payments = Array.isArray(p.payments) ? p.payments : [];
  out.pledges = Array.isArray(p.pledges) ? p.pledges : [];
  // What the bank verified (or is still waiting on), and the charges the couple already answered.
  // Lives in the plan so "Load demo" and "Start over" reset it with everything else.
  out.history = Array.isArray(p.history) ? p.history : [];
  out.dismissed = Array.isArray(p.dismissed) ? p.dismissed : [];
  out.unplannedSeen = Array.isArray(p.unplannedSeen) ? p.unplannedSeen : [];
  // Round 3: vendors, messages, give links, fraud alerts, cards, after the wedding, contracts. All in the plan,
  // so "Load demo" and "Start over" reset them with everything else.
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  out.savedVendors = Array.isArray(p.savedVendors) ? p.savedVendors : [];
  out.threads = obj(p.threads);
  out.giveLinks = Array.isArray(p.giveLinks) ? p.giveLinks : [];
  out.alerts = Array.isArray(p.alerts) ? p.alerts : [];
  out.payInfo = obj(p.payInfo);
  out.cardRewards = obj(p.cardRewards);
  out.afterDone = obj(p.afterDone);
  out.contracts = Array.isArray(p.contracts) ? p.contracts : [];
  out.settings = { taxRate: 0.0825, cushionPct: 0.10, ...(p.settings || {}) };
  return out;
}

function normalizeLine(l) {
  return {
    id: l.id, category: l.category || 'Other', item: l.item || l.id,
    planned: Number(l.planned) || 0, committed: Number(l.committed) || 0, paid: Number(l.paid) || 0,
    vendor: l.vendor ?? null, protected: Boolean(l.protected), forgotten: Boolean(l.forgotten),
    quoteId: l.quoteId ?? null,
    ...(l.unit ? { unit: l.unit } : {}),
    ...traditionFields(l)
  };
}

// A line that belongs to a wedding style keeps its tag and the typical range it came with (tradition lines are not
// in the budget template, so the screen reads the range from the line). traditionAdded means the app added the line,
// so it may take it away again if the style is unselected and the line was never touched.
function traditionFields(l) {
  if (!l.tradition) return {};
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const out = { tradition: String(l.tradition).slice(0, 40) };
  if (l.traditionAdded) out.traditionAdded = true;
  if (l.informational) out.informational = true;
  if (num(l.typicalLow) !== null) out.typicalLow = l.typicalLow;
  if (num(l.typicalHigh) !== null) out.typicalHigh = l.typicalHigh;
  if (typeof l.note === 'string' && l.note) out.note = l.note.slice(0, 300);
  if (typeof l.source === 'string' && l.source) out.source = l.source.slice(0, 300);
  return out;
}

export function getPlan() { return plan; }
export function hasPlan() { return plan !== null; }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setPlan(next) {
  plan = next ? normalize(next) : null;
  persist();
  notify();
}

// Change the plan in place through a function, then save and tell everyone.
export function update(fn) {
  const next = structuredClone(plan || emptyPlan());
  fn(next);
  setPlan(next);
}

export function emptyPlan() {
  return normalize({
    demo: false,
    couple: { names: ['', ''], weddingDate: '', city: 'El Paso', guests: 100 },
    money: { saved: 0, monthly: 0, startMonth: todayISO().slice(0, 7) },
    priorities: { a: [], b: [], top: [] },
    lines: [], quotes: [], payments: [], pledges: [],
    settings: { taxRate: 0.0825, cushionPct: 0.10 }
  });
}

// Demo couple for the pitch. Always carries the Demo tag.
// A fresh demo also unlinks the test bank, so "Connect your bank" (and the payment that
// marks itself paid) happens live every time the demo is shown.
async function unlinkBank() {
  try { await fetch('api/plaid/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* offline is fine */ }
  setBankData(null);
}

// Things kept outside the plan that belong to one plan: the vendor swipe passes and availability answers (vendors screen)
// and the chat. A new plan (Load demo, Start over) starts without them.
const PLAN_SIDE_KEYS = ['padrino.vendors.passed.v1', 'padrino.vendors.availability.v1', 'padrino.chat.v1'];
function clearSideKeys() {
  for (const k of PLAN_SIDE_KEYS) {
    try { localStorage.removeItem(k); } catch { /* private mode: nothing to clear */ }
  }
}

export async function loadDemo() {
  const demo = await getDemoCouple();
  const p = demo && demo.plan ? demo.plan : demo;
  await unlinkBank();
  const next = { ...structuredClone(p), demo: true };
  // A demo cushion and a demo wedding style, so the money buffer and the "Your wedding style" step have an answer on
  // stage. "Mixed or our own" adds no lines and no milestones, so the path the pitch walks through is unchanged.
  // Pick a style live to show it add lines. Anything the demo file sets itself wins.
  next.money = { ...next.money };
  if (next.money.keepInBank === undefined) next.money.keepInBank = 1500;
  next.couple = { ...next.couple };
  if (!Array.isArray(next.couple.traditions) || !next.couple.traditions.length) next.couple.traditions = [MIXED_TRADITION.id];
  // One saved demo vendor with a short thread, so the message channel is not empty on stage.
  if (!next.savedVendors && !next.threads) Object.assign(next, demoVendorThread());
  clearSideKeys();
  setPlan(next);
  return plan;
}

// The demo couple's one vendor thread: a sent question and a labeled demo reply. Sample Hall is made up.
// Times are a couple of days back so the thread reads like it has been going for a bit.
function demoVendorThread() {
  const ago = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const id = 'sample-hall-demo';
  return {
    savedVendors: [{
      id, name: 'Sample Hall (demo)', category: 'Venues', area: 'El Paso', website: null, phone: null, email: null,
      priceInfo: null, about: 'A made up hall for the demo couple. Nothing here is a real business.', source: null,
      checked: null, demo: true, savedAt: ago(96)
    }],
    threads: {
      [id]: [
        {
          id: 'm_demo1', at: ago(50), from: 'you', status: 'sent', channel: 'demo',
          subject: 'Question about the service charge',
          text: 'Hi Sample Hall team,\n\nWe are Ana and Luis, getting married on June 12, 2027 with about 120 guests. We saw a 22% service charge on the food and drinks. Does that 22% include the tip for your staff, or should we plan to tip on top of it?\n\nCould you answer in writing so we can plan the budget?\n\nThanks,\nAna and Luis'
        },
        {
          id: 'm_demo2', at: ago(27), from: 'vendor', status: 'received', channel: 'demo', demo: true,
          text: 'Demo reply, not from a real business. Hi Ana and Luis, the 22% goes to our service staff and the house, so it is not a tip. Guests often add a little on top for the bartenders. If you pick a Friday we can lower the service charge to 18%. Let us know and we will send a new quote.'
        }
      ]
    }
  };
}

export function startOver() {
  unlinkBank();
  clearSideKeys();
  setPlan(null);
}

// Build a fresh plan from the setup answers and the budget template.
// The first split comes from the couple's own money (saved, monthly, pledges), not averages,
// so a new plan starts on track. money.js does the split.
export async function createPlanFromSetup({ couple, money, priorities }) {
  const template = await getTemplate();
  const base = normalize({
    demo: false,
    couple: { ...couple },
    money: { ...money },
    priorities: { ...priorities },
    lines: [], quotes: [], payments: [], pledges: [],
    settings: { taxRate: 0.0825, cushionPct: 0.10 }
  });
  const available = summary(base, template).available;
  base.lines = startingLines(template, available, base.settings.cushionPct).map(normalizeLine);
  applyProtection(base);
  setPlan(base);
  if (base.couple.traditions.length) { // chosen in setup: the lines follow once the list is in
    try { await loadTraditions(); reconcileTraditions(); } catch (e) { console.error(e); }
  }
  return plan;
}

// The combined top 3 become protected lines, using the priority to line map in money.js.
export function applyProtection(p) {
  const top = p.priorities?.top || [];
  const ids = new Set();
  for (const pid of top) for (const id of PRIORITY_LINES[pid] || []) ids.add(id);
  for (const line of p.lines) line.protected = ids.has(line.id);
}

export function setPriorities(priorities) {
  update((p) => {
    p.priorities = { ...p.priorities, ...priorities };
    applyProtection(p);
  });
}

export function setCouple(patch) {
  update((p) => { p.couple = { ...p.couple, ...patch }; });
}

export function setMoney(patch) {
  update((p) => { p.money = { ...p.money, ...patch }; });
}

// The buffer: money the couple always keeps in the bank to live on. It never counts toward the wedding, and
// getBufferCheck() warns before a payment would push the bank under it. Dollars; 0 means no buffer. Returns what was
// saved, or null when the amount is not a number from zero up (or there is no plan yet).
export function setKeepInBank(n) {
  if (!plan || n === '' || n === null || n === undefined) return null;
  const v = Number(typeof n === 'string' ? n.replace(/[$,\s]/g, '') : n);
  if (!Number.isFinite(v) || v < 0 || v > 10000000) return null;
  const amount = Math.round(v * 100) / 100;
  update((p) => { p.money.keepInBank = amount; });
  return amount;
}

export function getKeepInBank() {
  return Math.max(0, Number(plan?.money?.keepInBank) || 0);
}

// Guest count change. money.js hands back the lines that move with headcount
// as { id, from, to, committed }; "to" becomes the new amount on each one.
export function setGuests(guests, scaledLines) {
  update((p) => {
    p.couple.guests = Math.max(1, Math.round(Number(guests) || 1));
    for (const s of scaledLines || []) {
      const line = p.lines.find((l) => l.id === s.id);
      if (!line || typeof s.to !== 'number') continue;
      line.planned = s.to;
      if (Number(line.committed) > 0) line.committed = s.to;
    }
  });
}

// Money freed from cancelled subscriptions joins the monthly wedding savings. The freed part
// is kept on its own (freedMonthly) so it can be changed or undone without touching the rest.
const cents = (n) => Math.round(n * 100) / 100;

export function putFreedTowardWedding({ monthly, names = [] }) {
  update((p) => {
    const before = Number(p.money.freedMonthly) || 0;
    p.money.monthly = cents((Number(p.money.monthly) || 0) - before + monthly);
    p.money.freedMonthly = cents(monthly);
    p.money.freedNames = names;
  });
}

export function undoFreed() {
  update((p) => {
    const before = Number(p.money.freedMonthly) || 0;
    p.money.monthly = cents(Math.max(0, (Number(p.money.monthly) || 0) - before));
    delete p.money.freedMonthly;
    delete p.money.freedNames;
  });
}

export function updateLine(id, patch) {
  update((p) => {
    const line = p.lines.find((l) => l.id === id);
    if (!line) return;
    Object.assign(line, patch);
    // A gift between people (like the mahr) is shown for information and never counts toward the budget.
    if (line.informational) { line.planned = 0; line.committed = 0; }
  });
}

export function addLine(line) {
  update((p) => {
    p.lines.push(normalizeLine({ id: line.id || uid('line'), ...line }));
  });
}

// Payments

export function addPayment(payment) {
  const id = payment.id || uid('p');
  update((p) => {
    p.payments.push({
      id, lineId: payment.lineId || null, label: payment.label || 'Payment',
      amount: Number(payment.amount) || 0, dueDate: payment.dueDate || todayISO(),
      status: payment.status || 'due', paidOn: payment.paidOn || null, source: payment.source || 'manual'
    });
  });
  return id;
}

// Ticking a payment off is the same as saying "I paid it": the line shows it, and the bank gets to confirm.
export function markPaid(id, paidOn = todayISO()) {
  if (!plan?.payments.some((x) => x.id === id)) return;
  update((p) => { logPayment(p, { paymentId: id, date: paidOn }, ctx()); });
  verifyWithBank();
}

export function markUnpaid(id) {
  update((p) => { undoPayment(p, id); });
}

export function removePayment(id) {
  update((p) => {
    p.payments = p.payments.filter((x) => x.id !== id);
    p.history = p.history.filter((h) => h.ref?.paymentId !== id || h.status !== 'waiting');
  });
}

// Bank data. Null until the couple connects a bank (js/bank.js talks to the server).
// Shape, as GET /api/bank returns it:
//   { connected: true, sandbox: bool, cash: number, fetchedAt: ISO,
//     accounts:     [{ id, name, mask, type, subtype, balance }],
//     recurring:    [{ id, name, category, frequency, amount, monthly, nextDate }],
//     recurringMonthly: number,
//     transactions: [{ id, date, name, amount, category }] }
// Kept apart from the plan so "Start over" on the plan does not drop the bank link.
const BANK_KEY = 'padrino.bank.v1';
let bank = loadBank();

function loadBank() {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function getBankData() { return bank; }
export function hasBank() { return bank !== null; }

export function setBankData(data) {
  bank = data ? { accounts: [], recurring: [], transactions: [], ...data } : null;
  try {
    if (bank) localStorage.setItem(BANK_KEY, JSON.stringify(bank));
    else localStorage.removeItem(BANK_KEY);
  } catch { /* ignore */ }
  notify();
}

export function clearBankData() { setBankData(null); }

// Bank sync for payments. Matches money-out transactions to due payments (amount within 1%, or the same
// vendor with a different amount; from 45 days before to 10 days after the due date; the rules live in
// /lib/bank.js), marks those payments paid from the bank, updates the line's paid amount and files the history.
// Returns { matched: [{ paymentId, transactionId, paidOn, amount, merchant, planned, different, difference, historyId }],
//           unmatched: [transactionIds] }.
// verifyWithBank() does this and more; refreshBankData() in js/bank.js already calls it.
export function markPaidFromBank(transactions) {
  const list = Array.isArray(transactions) ? transactions : (bank?.transactions || []);
  if (!plan) return { matched: [], unmatched: list.map((t) => t.id) };
  const next = structuredClone(plan);
  const matched = markPaymentsFromBank(next, { ...(bank || {}), transactions: list }, ctx());
  if (matched.length) setPlan(next);
  const used = new Set(matched.map((m) => m.transactionId));
  return { matched, unmatched: list.filter((t) => !used.has(t.id)).map((t) => t.id) };
}

// ---------------------------------------------------------------------------------------------
// History: what happened to the money, and whether the bank has confirmed it. Lives in the plan.
//   { id, at, date, kind: 'payment'|'family'|'quote'|'subscription'|'expense'|'income', title, amount,
//     status: 'verified'|'waiting'|'different', source: 'bank'|'you',
//     bank: { account, mask, date, merchant, amount, transactionId } | null, note,
//     expected, expectedFrom: 'plan'|'you'|'pledge', who, ref: { paymentId, pledgeId, lineId }, verifiedAt }
// "waiting": you said it happened and the bank has not shown it yet. "different": the bank shows another
// amount than the plan (or than you wrote down), and the note says how. Quotes are filed as verified with
// source 'you': there is nothing at the bank to check.

function ctx() { return { today: todayISO(), newId: uid }; }

// Newest first, by the date it happened.
export function getHistory() {
  const list = (plan?.history || []).map((h) => ({ ...h }));
  return list.sort((a, b) => {
    const da = a.date || a.at || '';
    const db = b.date || b.at || '';
    if (da !== db) return da < db ? 1 : -1;
    return (a.at || '') < (b.at || '') ? 1 : (a.at || '') > (b.at || '') ? -1 : 0;
  });
}

// Changes one history entry (for example Builder C flips a subscription to verified).
export function updateHistory(id, patch) {
  update((p) => {
    const h = p.history.find((x) => x.id === id);
    if (h) Object.assign(h, patch);
  });
}

// Saves a record, then lets the bank data we already have confirm it right away if it can.
function record(fn) {
  let id = null;
  update((p) => { id = fn(p, ctx()); });
  verifyWithBank();
  return id;
}

// You paid a vendor. Marks the payment paid (or files a new one when there is no paymentId), puts the amount on
// the line, and waits for the bank. Returns the history id.
export function recordPayment({ paymentId, lineId, amount, date, who } = {}) {
  return record((p, c) => logPayment(p, { paymentId, lineId, amount, date, who }, c));
}

// Money from family. Adds it to the pledge (found by id or by name, or a new pledge) and waits for the bank.
export function recordFamilyMoney({ pledgeId, name, amount, date, item } = {}) {
  return record((p, c) => logFamilyMoney(p, { pledgeId, name, amount, date, item }, c));
}

// Money out for the wedding that is not a scheduled payment.
export function recordExpense({ lineId, amount, date, who, note } = {}) {
  return record((p, c) => logExpense(p, { lineId, amount, date, who, note }, c));
}

// Other money in for the wedding (not a pledge). Counts toward what you have saved.
export function recordIncome({ amount, date, who, note } = {}) {
  return record((p, c) => logIncome(p, { amount, date, who, note }, c));
}

// A cancelled subscription. Waits until the bank shows no new charge. Optional date, default today.
export function recordSubscriptionCancelled({ name, monthly, date } = {}) {
  return record((p, c) => logSubscriptionCancelled(p, { name, monthly, date }, c));
}

// Runs after every bank refresh. Confirms what you said and what is scheduled against the transactions, and
// collects spending that looks like the wedding but is in no plan. Saves only when something changed.
// Returns { verified: [historyIds], different: [historyIds], unplanned: [...], unplannedNew: [transactionIds] }.
export function verifyWithBank() {
  const none = { verified: [], different: [], unplanned: [], unplannedNew: [] };
  if (!plan || !bank || !Array.isArray(bank.transactions)) return none;
  const next = structuredClone(plan);
  const r = verifyAgainstBank(next, bank, ctx());
  if (r.changed) setPlan(next);
  return { verified: r.verified, different: r.different, unplanned: r.unplanned, unplannedNew: r.unplannedNew };
}

// Wedding-looking charges the plan does not have: [{ transactionId, date, merchant, amount, guessLineId }].
export function getUnplanned() {
  if (!plan || !bank || !Array.isArray(bank.transactions)) return [];
  return verifyAgainstBank(structuredClone(plan), bank, ctx()).unplanned;
}

// Yes, it was for the wedding: files it as a verified expense on that line (lineId may be null for the guess).
// Returns the history id, or null when the charge is gone or already counted.
export function acceptUnplanned(transactionId, lineId) {
  const tx = bank?.transactions?.find((t) => t.id === transactionId);
  if (!tx || !plan) return null;
  let id = null;
  update((p) => { id = acceptUnplannedCharge(p, tx, lineId, bank, ctx()); });
  return id;
}

// No, that was not the wedding: the charge never shows up again.
export function dismissUnplanned(transactionId) {
  const tx = bank?.transactions?.find((t) => t.id === transactionId);
  if (!tx || !plan) return;
  update((p) => { dismissUnplannedCharge(p, tx); });
}

// Quotes

// Adds a decoded quote to the plan: commits the line, records the quote,
// and files the dated payments money.js produced.
export function addQuoteToPlan({ decoded, lineId, trueTotal, payments }) {
  const quoteId = uid('q');
  update((p) => {
    p.quotes.push({
      id: quoteId, vendor: decoded.vendor || 'Vendor', category: decoded.category || '',
      decoded, createdAt: new Date().toISOString()
    });
    const line = p.lines.find((l) => l.id === lineId);
    if (line) {
      line.committed = Number(trueTotal) || 0;
      line.vendor = decoded.vendor || line.vendor;
      line.quoteId = quoteId;
    }
    for (const pay of payments || []) {
      p.payments.push({
        id: pay.id || uid('p'), lineId: lineId || null, label: pay.label || 'Payment',
        amount: Number(pay.amount) || 0, dueDate: pay.dueDate || pay.date || todayISO(),
        status: 'due', paidOn: null, source: 'quote'
      });
    }
    logQuote(p, { vendor: decoded.vendor, amount: trueTotal, quoteId, lineId }, ctx());
  });
  return quoteId;
}

// Pledges (padrino style)

export function addPledge(pledge) {
  const id = pledge.id || uid('f');
  update((p) => {
    p.pledges.push({
      id, name: pledge.name || '', relation: pledge.relation || '', lineId: pledge.lineId || null,
      item: pledge.item || '', amount: Number(pledge.amount) || 0, received: Number(pledge.received) || 0,
      strings: pledge.strings || ''
    });
  });
  return id;
}

export function updatePledge(id, patch) {
  update((p) => {
    const f = p.pledges.find((x) => x.id === id);
    if (f) Object.assign(f, patch);
  });
}

export function removePledge(id) {
  update((p) => { p.pledges = p.pledges.filter((x) => x.id !== id); });
}

// ---------------------------------------------------------------------------------------------
// Round 3: vendors, messages, give links, fraud alerts, cards, after the wedding, contracts.
// Everything lives in the plan (see normalize), so Load demo resets it. These need a plan: with none yet they
// do nothing and return an empty answer instead of quietly making an empty plan.

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const nowISO = () => new Date().toISOString();
const slug = (s) => String(s || '').toLowerCase().replace(/\(demo\)/g, ' demo ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const clipText = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const copy = (v) => { try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); } };

// Vendors the couple saved.

export function getSavedVendors() {
  return copy(plan?.savedVendors || []);
}

// Saves a vendor (an entry from vendors.json, or { name } for one the couple typed). Saving twice keeps one.
// Returns the saved vendor, or null when there is no name.
export function saveVendor(vendor) {
  if (!plan) return null;
  const v = typeof vendor === 'string' ? { name: vendor } : vendor && typeof vendor === 'object' ? copy(vendor) : null;
  const name = clipText(v?.name, 120).trim();
  if (!name) return null;
  const id = clipText(v.id, 80) || slug(name);
  const saved = { ...v, id, name, savedAt: nowISO() };
  update((p) => {
    const i = p.savedVendors.findIndex((x) => x.id === id);
    if (i >= 0) p.savedVendors[i] = { ...p.savedVendors[i], ...saved, savedAt: p.savedVendors[i].savedAt || saved.savedAt };
    else p.savedVendors.push(saved);
  });
  return plan.savedVendors.find((x) => x.id === id) || saved;
}

export function unsaveVendor(id) {
  if (!plan) return;
  update((p) => { p.savedVendors = p.savedVendors.filter((x) => x.id !== id); });
}

// Messages with each vendor. A message: { id, at, from: 'you'|'vendor'|'padrino', text, status: 'draft'|'sent'|'received',
// channel: 'email'|'demo'|'copy', subject?, demo? ...extra fields are kept }. Oldest first.

export function getThread(vendorId) {
  const list = plan?.threads?.[vendorId];
  if (!Array.isArray(list)) return [];
  return copy(list).sort((a, b) => (a.at || '') < (b.at || '') ? -1 : (a.at || '') > (b.at || '') ? 1 : 0);
}

// Every vendor that has messages: [{ vendorId, messages }].
export function getThreads() {
  return Object.keys(plan?.threads || {}).filter((id) => plan.threads[id]?.length).map((vendorId) => ({ vendorId, messages: getThread(vendorId) }));
}

// Adds a message and returns it (with its id). A given id or time is kept.
export function addMessage(vendorId, msg = {}) {
  if (!plan || !vendorId) return null;
  const from = ['you', 'vendor', 'padrino'].includes(msg.from) ? msg.from : 'you';
  const message = {
    ...copy(msg),
    id: clipText(msg.id, 60) || uid('m'),
    at: clipText(msg.at, 40) || nowISO(),
    from,
    text: clipText(msg.text, 20000),
    status: clipText(msg.status, 20) || (from === 'vendor' ? 'received' : 'draft'),
    channel: clipText(msg.channel, 20) || 'email'
  };
  update((p) => {
    const list = Array.isArray(p.threads[vendorId]) ? p.threads[vendorId] : (p.threads[vendorId] = []);
    const i = list.findIndex((m) => m.id === message.id);
    if (i >= 0) list[i] = message;
    else list.push(message);
  });
  return copy(message);
}

// Changes a message (for example a draft that was sent). Returns the new message, or null when it is not there.
export function updateMessage(vendorId, id, patch = {}) {
  const found = plan?.threads?.[vendorId]?.some((m) => m.id === id);
  if (!found) return null;
  let out = null;
  update((p) => {
    const m = p.threads[vendorId].find((x) => x.id === id);
    const { id: _ignored, ...rest } = copy(patch);
    if ('text' in rest) rest.text = clipText(rest.text, 20000);
    Object.assign(m, rest);
    out = copy(m);
  });
  return out;
}

// Give links (padrino links and guest pages). The server stores what the page shows; this keeps our copy.

export function getGiveLinks() {
  return copy(plan?.giveLinks || []).sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1));
}

// spec: { kind: 'padrino'|'guest', couple?: { names, date, city? }, items: [{ id, label, amount, pledgeId? }],
//         pay: { zelle?, venmo?, cashapp? }, note, to? }. couple defaults to the plan's.
// Resolves to { id, url, path, kind, couple, items, pay, note, createdAt }. Throws an Error with the server's plain
// message when the link is not made (for example a missing way to pay).
export async function createGiveLink(spec = {}) {
  const c = plan?.couple || {};
  const body = {
    ...spec,
    couple: { names: c.names, date: c.weddingDate, city: c.city, ...(spec.couple || {}) }
  };
  let res;
  try {
    res = await fetch('api/give', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Could not reach the server. Is it running?');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data?.id) throw new Error((data && data.message) || 'Could not make that link. Try again.');
  const at = nowISO();
  const link = {
    id: data.id, url: data.url || data.path, path: data.path || `give.html?id=${data.id}`,
    kind: body.kind, ...(body.to ? { to: body.to } : {}), couple: body.couple, items: copy(body.items || []),
    pay: copy(body.pay || {}), note: body.note || '', createdAt: at, at
  };
  if (plan) update((p) => { p.giveLinks.push(link); });
  return copy(link);
}

// Fraud warning. The last way a vendor asked to be paid is kept per vendor. When a document names a different
// account or handle, an alert is raised and the new details become the ones on file.
// instr: { method, bankLast4, handle } as /api/intake and /api/contract return it. Returns
// { changed, before, after, alertId? }. before is null the first time.

const vendorKey = (name) => String(name || '').toLowerCase().replace(/\(demo\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export function notePaymentInstructions(vendorName, instr) {
  const after = cleanInstructions(instr);
  const key = vendorKey(vendorName);
  if (!plan || !after || !key) return { changed: false, before: null, after: after || null };
  const before = cleanInstructions(plan.payInfo[key]?.instructions);
  const changed = Boolean(before) && instructionsDiffer(before, after);
  let alertId = null;
  update((p) => {
    // New details replace the old ones. The same details keep what was first on file and fill in what was missing.
    const merged = changed || !before ? after : { method: before.method || after.method, bankLast4: before.bankLast4 || after.bankLast4, handle: before.handle || after.handle };
    p.payInfo[key] = { vendor: clipText(String(vendorName), 120), instructions: merged, at: nowISO() };
    if (!changed) return;
    const nowWords = describeInstructions(after);
    const dup = p.alerts.find((a) => !a.dismissed && a.kind === 'payment_instructions' && a.key === key && a.nowWords === nowWords);
    if (dup) { alertId = dup.id; return; }
    const vendor = clipText(String(vendorName), 120);
    alertId = uid('al');
    p.alerts.push({
      id: alertId, at: nowISO(), kind: 'payment_instructions', key, vendor, before, after, nowWords, dismissed: false,
      title: `Check before you pay ${vendor}`,
      text: `${vendor} changed how to pay. Before: ${describeInstructions(before)}. Now: ${nowWords}. Call them on a number you already had before you send any money. Do not use a number from the new message.`
    });
  });
  return { changed, before, after, ...(alertId ? { alertId } : {}) };
}

// Alerts that are still open: [{ id, at, kind, vendor, title, text, before, after }]. Payment alerts come first, newest
// first. When the buffer check warns there is one more at the end, { id: 'buffer', kind: 'buffer', title, text, buffer },
// where buffer is what getBufferCheck() returned. It is worked out fresh each time, so it goes away on its own when the
// picture changes. dismissAlert('buffer') quiets it until the picture changes (a different payment, date or amount).
export function getAlerts() {
  const list = copy((plan?.alerts || []).filter((a) => !a.dismissed)).sort((a, b) => (a.at < b.at ? 1 : -1));
  const check = getBufferCheck();
  if (check.warn && plan?.bufferAck !== bufferSignature(check)) {
    list.push({ id: BUFFER_ALERT, at: nowISO(), kind: 'buffer', vendor: null, title: 'Your cushion', text: check.text, buffer: check });
  }
  return list;
}

export function dismissAlert(id) {
  if (id === BUFFER_ALERT) {
    const check = getBufferCheck();
    if (plan && check.warn) update((p) => { p.bufferAck = bufferSignature(check); });
    return;
  }
  if (!plan?.alerts?.some((a) => a.id === id)) return;
  update((p) => {
    const a = p.alerts.find((x) => x.id === id);
    if (a) { a.dismissed = true; a.dismissedAt = nowISO(); }
  });
}

// ---------------------------------------------------------------------------------------------
// The buffer check. Math lives in /lib/bank.js (bufferCheck). Uses the cash in checking and savings (never credit),
// the payments due in the next `days` days (60 unless you say otherwise), and plan.money.keepInBank.
// Returns { connected, cash, keep, days, upcoming: [{ id, date, dueDate, label, amount, balanceAfter, overdue?, waiting? }],
//           lowest: { date, balanceAfter, label, count, amount, shortBy } | null, warn, shortBy, text, caveat }.
// cash is null (and warn false) until a bank is connected. text is one plain sentence, like
// "Paying the venue balance on May 13 would leave about $900, under your $1,500 cushion."
const BUFFER_ALERT = 'buffer';

export function getBufferCheck({ today, days } = {}) {
  return bufferCheck(plan, bank, { today: today || todayISO(), days: days || 60 });
}

const bufferSignature = (c) => `${c.lowest?.date}|${c.lowest?.label || c.lowest?.count}|${Math.round(c.lowest?.balanceAfter ?? 0)}|${c.keep}`;

// Cards. The credit accounts the bank shows, plus the rewards rate the couple typed in (a percent: 2 means 2%).
// The demo couple gets a labeled demo rate until they pick one. Everyone else sees null until they set it.

const DEMO_REWARD_PCT = 2;

export function getCards() {
  const accounts = Array.isArray(bank?.accounts) ? bank.accounts : [];
  return accounts
    .filter((a) => a.type === 'credit')
    .map((a) => {
      const chosen = plan?.cardRewards?.[a.id];
      const own = isNum(chosen);
      return {
        id: a.id, name: a.name || 'Credit card', mask: a.mask || null,
        balance: isNum(a.current) ? a.current : 0,
        limit: isNum(a.limit) ? a.limit : null,
        available: isNum(a.available) ? a.available : null,
        rewardPct: own ? chosen : plan?.demo ? DEMO_REWARD_PCT : null,
        rewardSource: own ? 'you' : plan?.demo ? 'demo' : null
      };
    });
}

// pct is a percent from 0 to 20. null or '' goes back to no rate. Returns what was saved.
export function setCardReward(accountId, pct) {
  if (!plan || !accountId) return null;
  const n = pct === null || pct === '' || pct === undefined ? null : Number(pct);
  if (n !== null && !(Number.isFinite(n) && n >= 0 && n <= 20)) return null;
  update((p) => {
    if (n === null) delete p.cardRewards[accountId];
    else p.cardRewards[accountId] = Math.round(n * 100) / 100;
  });
  return n === null ? null : Math.round(n * 100) / 100;
}

// After the wedding. The steps themselves live in /data/after-wedding.json; the plan keeps which are done.

// The steps marked done: [{ id, done: true, doneAt }].
export function getAfterChecklist() {
  return Object.entries(plan?.afterDone || {}).map(([id, doneAt]) => ({ id, done: true, doneAt }));
}

// Flips one step. Returns true when it is now done.
export function toggleAfterItem(id) {
  if (!plan || !id) return false;
  const key = clipText(String(id), 80);
  let done = false;
  update((p) => {
    if (p.afterDone[key]) delete p.afterDone[key];
    else { p.afterDone[key] = todayISO(); done = true; }
  });
  return done;
}

// Contracts the couple checked. Oldest first; one per vendor (checking the same vendor again replaces it).
// The payment details in the analysis go through the fraud check as well; the result is in paymentCheck.

export function getContracts() {
  return copy(plan?.contracts || []);
}

export function saveContract(vendorName, analysis) {
  const name = clipText(String(vendorName || analysis?.vendor || ''), 120).trim();
  if (!plan || !name || !analysis || typeof analysis !== 'object') return null;
  const record = { id: uid('ct'), vendor: name, vendorName: name, savedAt: nowISO(), analysis: copy(analysis) };
  update((p) => {
    p.contracts = p.contracts.filter((c) => vendorKey(c.vendor) !== vendorKey(name));
    p.contracts.push(record);
  });
  const paymentCheck = analysis.paymentInstructions ? notePaymentInstructions(name, analysis.paymentInstructions) : null;
  return { ...copy(record), paymentCheck };
}

// ---------------------------------------------------------------------------------------------
// Round 6: wedding style (traditions). The couple picks one or more styles, in their own words if they like.
//   plan.couple.traditions      ['mexican', 'catholic', 'own'] (ids from /data/traditions.json, plus 'own' for "Mixed or our own")
//   plan.couple.traditionNotes  their own notes, as typed
// Each style brings budget lines (planned 0, with the typical range it came with) and path milestones. The list of
// styles is /data/traditions.json (research by Builder M1). It loads lazily and may be missing: then the picker shows a
// plain list of names, nothing is added, and the choice is still kept. Lines catch up as soon as the file loads.

export const MIXED_TRADITION = Object.freeze({ id: 'own', name: 'Mixed or our own', blurb: 'A blend, or something that is only yours. Say it in your own words.', photo: null });
const FALLBACK_STYLES = [
  ['mexican', 'Mexican'], ['indian', 'Indian'], ['christian', 'Christian'], ['catholic', 'Catholic'], ['jewish', 'Jewish'],
  ['muslim', 'Muslim'], ['japanese', 'Japanese'], ['chinese', 'Chinese'], ['nigerian', 'Nigerian'], ['civil', 'Courthouse or civil']
];
const STYLE_SECTIONS = ['foundation', 'big-three', 'team', 'money', 'paper', 'final', 'after'];

let traditionCatalog = [];
let traditionsLoaded = false;
let traditionsPromise = null;
let templateIds = new Set(); // lines from the budget template are base lines: a style may tag them but never takes them away

// Plain text only: no long dashes, no angle brackets, trimmed.
function plainText(v, n) {
  if (typeof v !== 'string') return '';
  return v.replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1 to $2').replace(/\s*[\u2013\u2014]\s*/g, ', ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
}
const idText = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const rangeNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function cleanStep(s) {
  if (!s || typeof s !== 'object') return null;
  const title = plainText(s.title, 90);
  const body = plainText(s.body, 420);
  if (!title && !body) return null;
  const out = { kind: ['info', 'choice', 'input', 'route'].includes(s.kind) ? s.kind : 'info', title: title || body.slice(0, 60), body: body || title };
  if (Array.isArray(s.options)) {
    out.options = s.options.map((o) => ({ id: idText(o?.id ?? o?.label), label: plainText(o?.label, 60), ...(plainText(o?.hint, 120) ? { hint: plainText(o.hint, 120) } : {}) })).filter((o) => o.id && o.label).slice(0, 6);
  }
  if (s.field && typeof s.field === 'object') {
    const type = ['text', 'money', 'number', 'percent', 'date'].includes(s.field.type) ? s.field.type : 'text';
    out.field = { name: idText(s.field.name) || 'answer', label: plainText(s.field.label, 80) || 'Your answer', type };
  }
  if (typeof s.route === 'string') out.route = s.route.slice(0, 80);
  if (plainText(s.cta, 30)) out.cta = plainText(s.cta, 30);
  if (plainText(s.lesson, 200)) out.lesson = plainText(s.lesson, 200);
  return out;
}

// A milestone gets at most 3 steps. More than that are grouped in order: the group keeps its first step's title and
// kind, and the bodies run together (each later step adds "Title. Body"). Nothing is dropped.
function fitText(text, n) {
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  const end = cut.lastIndexOf('. ');
  return end > n * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '');
}

function groupSteps(steps) {
  if (steps.length <= 3) return steps;
  const base = Math.floor(steps.length / 3);
  const extra = steps.length % 3; // the first groups take the extra steps
  const out = [];
  let at = 0;
  for (let g = 0; g < 3; g++) {
    const group = steps.slice(at, at + base + (g < extra ? 1 : 0));
    at += group.length;
    const [first, ...rest] = group;
    const body = [first.body, ...rest.map((x) => `${x.title.replace(/[.!?]+$/, '')}. ${x.body}`)].join(' ');
    out.push({ ...first, kind: 'info', body: fitText(body, 700) });
  }
  return out;
}

// Lines that describe a gift or a custom between people, not something the wedding pays for. They are kept at $0 and
// marked informational, so they never add to the budget total.
const INFORMATIONAL_LINES = new Set(['mahr']);

function cleanTradition(t) {
  const id = idText(t?.id);
  const name = plainText(t?.name, 50);
  if (!id || !name || id === MIXED_TRADITION.id || id === 'mixed') return null;
  const lines = (Array.isArray(t.lines) ? t.lines : []).map((l) => {
    const lid = idText(l?.id);
    const item = plainText(l?.item, 80);
    if (!lid || !item) return null;
    return {
      id: lid, category: plainText(l.category, 40) || 'Wedding style', item,
      typicalLow: rangeNum(l.typicalLow), typicalHigh: rangeNum(l.typicalHigh), note: plainText(l.note, 300), source: typeof l.source === 'string' ? l.source.slice(0, 300) : ''
    };
  }).filter(Boolean).slice(0, 30);
  const milestones = (Array.isArray(t.milestones) ? t.milestones : []).map((m) => {
    const mid = idText(m?.id);
    const title = plainText(m?.title, 80);
    const steps = groupSteps((Array.isArray(m?.steps) ? m.steps : []).map(cleanStep).filter(Boolean));
    if (!mid || !title || !STYLE_SECTIONS.includes(m.section) || !steps.length) return null;
    return { id: mid, section: m.section, title, short: plainText(m.short, 160), steps };
  }).filter(Boolean).slice(0, 12);
  return {
    id, name, blurb: plainText(t.blurb, 200), photo: typeof t.photo === 'string' && /^https?:\/\//.test(t.photo) ? t.photo : null,
    lines, milestones, vendorCategories: (Array.isArray(t.vendorCategories) ? t.vendorCategories : []).map((v) => plainText(String(v), 40)).filter(Boolean).slice(0, 12)
  };
}

function cleanCatalog(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.traditions) ? data.traditions : [];
  const seen = new Set();
  return list.map(cleanTradition).filter((t) => t && !seen.has(t.id) && seen.add(t.id));
}

// Loads /data/traditions.json once. Resolves with the cleaned list, or [] when the file is not there (and tries again
// on the next call). Lines catch up for a style chosen before the file arrived.
export function loadTraditions({ force = false } = {}) {
  if (!traditionsPromise || force) {
    traditionsPromise = (async () => {
      try {
        if (typeof fetch !== 'function') throw new Error('no fetch');
        const res = await fetch('data/traditions.json');
        if (!res.ok) throw new Error('missing');
        traditionCatalog = cleanCatalog(await res.json());
        traditionsLoaded = traditionCatalog.length > 0;
        try { templateIds = new Set((await getTemplate()).map((r) => r.id)); } catch { /* no template: every line counts as ours */ }
      } catch {
        traditionCatalog = [];
        traditionsLoaded = false;
        traditionsPromise = null;
      }
      try { reconcileTraditions(); } catch (e) { console.error(e); }
      return traditionCatalog;
    })();
  }
  return traditionsPromise;
}

export function traditionsReady() { return traditionsPromise || loadTraditions(); }

// The loaded styles, or [] until the file is in.
export function getTraditionCatalog() { return copy(traditionCatalog); }

// What the picker shows: [{ id, name, blurb, photo }]. The styles from the file, or a plain list of names until it is in,
// and always "Mixed or our own" last.
export function getTraditionOptions() {
  const base = traditionsLoaded
    ? traditionCatalog.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb, photo: t.photo }))
    : FALLBACK_STYLES.map(([id, name]) => ({ id, name, blurb: '', photo: null }));
  return [...base, { ...MIXED_TRADITION }];
}

function traditionName(id) {
  return getTraditionOptions().find((t) => t.id === id)?.name || FALLBACK_STYLES.find(([x]) => x === id)?.[1] || id;
}

// The couple's choice: { ids, names, notes }.
export function getTraditions() {
  const ids = [...(plan?.couple?.traditions || [])];
  return { ids, names: ids.map(traditionName), notes: plan?.couple?.traditionNotes || '' };
}

// Milestones of the chosen styles, for the path: [{ tradition, id, section, title, short, steps }].
export function getTraditionMilestones() {
  const ids = plan?.couple?.traditions || [];
  return traditionCatalog.filter((t) => ids.includes(t.id)).flatMap((t) => t.milestones.map((m) => ({ ...copy(m), tradition: t.id })));
}

// Vendor category names the chosen styles point at (as written in traditions.json), without repeats.
export function getTraditionVendorCategories() {
  const ids = plan?.couple?.traditions || [];
  return [...new Set(traditionCatalog.filter((t) => ids.includes(t.id)).flatMap((t) => t.vendorCategories))];
}

// Makes the plan's lines match the chosen styles, on the plan object in hand.
//  - a line a style asks for and the plan lacks is added: planned 0, the typical range kept, line.tradition set
//  - a line the plan already has (the budget template shares some ids, like lazo) is tagged, never added twice
//  - a style that is no longer chosen: lines the app added are removed only while they are still $0 and unbooked
//    (no committed or paid money, vendor, quote, payment or pledge); anything touched stays
// Returns { changed, added: [lineIds], removed: [lineIds], kept: [lineIds] }.
function syncTraditionLines(p, ids, catalog) {
  const chosen = catalog.filter((t) => ids.includes(t.id));
  const wanted = new Map();
  for (const t of chosen) for (const row of t.lines) if (!wanted.has(row.id)) wanted.set(row.id, { tradition: t.id, row });
  const out = { changed: false, added: [], removed: [], kept: [] };

  for (const [id, { tradition, row }] of wanted) {
    const line = p.lines.find((l) => l.id === id);
    if (!line) {
      p.lines.push(normalizeLine({
        id, category: row.category, item: row.item, planned: 0, tradition, traditionAdded: !templateIds.has(id),
        typicalLow: row.typicalLow, typicalHigh: row.typicalHigh, note: row.note, source: row.source,
        informational: INFORMATIONAL_LINES.has(id)
      }));
      out.added.push(id);
      out.changed = true;
    } else if (!line.tradition || (!ids.includes(line.tradition) && line.tradition !== tradition)) {
      line.tradition = tradition;
      out.changed = true;
    }
  }

  const touched = (l) => Number(l.planned) > 0 || Number(l.committed) > 0 || Number(l.paid) > 0 || l.vendor || l.quoteId
    || p.payments.some((x) => x.lineId === l.id) || p.pledges.some((x) => x.lineId === l.id);
  for (const l of [...p.lines]) {
    if (!l.tradition || ids.includes(l.tradition) || wanted.get(l.id)?.tradition === l.tradition) continue;
    if (l.traditionAdded && !touched(l)) {
      p.lines = p.lines.filter((x) => x !== l);
      out.removed.push(l.id);
      out.changed = true;
    } else if (l.traditionAdded) {
      out.kept.push(l.id);
    } else {
      delete l.tradition;
      out.changed = true;
    }
  }
  return out;
}

function reconcileTraditions() {
  if (!plan || !traditionsLoaded) return null;
  const next = structuredClone(plan);
  const r = syncTraditionLines(next, next.couple.traditions, traditionCatalog);
  if (r.changed) setPlan(next);
  return r;
}

// Saves the couple's wedding style and what they said about it, and brings the budget lines in line with it.
// ids: an array of style ids (unknown ones are dropped once the list is loaded; 'own', "Mixed or our own", always counts). notes: their
// own words; leave it out to keep what is there. Returns { ids, names, notes, added, removed, kept, pending } or null with
// no plan. added, removed and kept are budget line ids; pending is true while the list is still loading (the lines
// follow on their own). The path picks up the milestones by itself.
export function setTraditions(ids, notes) {
  if (!plan) return null;
  const known = new Set(traditionCatalog.map((t) => t.id));
  const list = [...new Set((Array.isArray(ids) ? ids : typeof ids === 'string' && ids ? [ids] : []).map(idText).map((id) => (id === 'mixed' ? MIXED_TRADITION.id : id)).filter(Boolean))]
    .filter((id) => id === MIXED_TRADITION.id || (traditionsLoaded ? known.has(id) : true))
    .slice(0, 12);
  const text = notes === undefined || notes === null ? plan.couple.traditionNotes || '' : plainText(String(notes), 600);
  let r = { added: [], removed: [], kept: [] };
  update((p) => {
    p.couple.traditions = list;
    p.couple.traditionNotes = text;
    if (traditionsLoaded) r = syncTraditionLines(p, list, traditionCatalog);
  });
  if (!traditionsLoaded) loadTraditions();
  return { ids: list, names: list.map(traditionName), notes: text, added: r.added, removed: r.removed, kept: r.kept, pending: !traditionsLoaded };
}
