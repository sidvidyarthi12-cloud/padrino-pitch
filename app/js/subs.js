// Subscriptions: which repeat charges could go and which stay, the cancel guide, and whether a
// cancelled one really stopped. Keeps its own localStorage key. The sums come from /lib/bank.js.
// Nothing here cancels anything. The app shows how, then watches the bank to check it worked.

import { cancelCandidates } from '../lib/bank.js';
import { todayISO } from './format.js';

export const SUBS_KEY = 'padrino.subs.v1';

function blank() {
  return { linkedAt: null, choices: {}, byName: {}, cancelled: {} };
}

function load() {
  try {
    const raw = localStorage.getItem(SUBS_KEY);
    if (!raw) return blank();
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? { ...blank(), ...p } : blank();
  } catch {
    return blank();
  }
}

let state = load();

function save() {
  try { localStorage.setItem(SUBS_KEY, JSON.stringify(state)); } catch { /* private mode: still works for this visit */ }
}

// Names

const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
const flat = (s) => words(s).join('');

// "PELOTON APP" and "Peloton" are the same merchant for our purposes.
export function sameMerchant(a, b) {
  const fa = flat(a); const fb = flat(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const [short, long] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
  return short.length >= 4 && long.includes(short);
}

// A new bank link (for example a fresh demo) starts the subscription story over.
export function syncWith(bank) {
  const stamp = bank && bank.linkedAt ? String(bank.linkedAt) : null;
  if (!stamp) return;
  if (state.linkedAt && state.linkedAt !== stamp) {
    state = { ...blank(), linkedAt: stamp };
    save();
  } else if (!state.linkedAt) {
    state.linkedAt = stamp;
    save();
  }
}

// Could go or stays

export function getChoice(subId) {
  const v = state.choices[subId];
  return v === 'go' || v === 'stay' ? v : null;
}

export function setChoice(subId, choice, sub = null) {
  if (choice !== 'go' && choice !== 'stay') {
    delete state.choices[subId];
    if (sub) delete state.byName[flat(sub.name)];
  } else {
    state.choices[subId] = choice;
    if (sub) state.byName[flat(sub.name)] = choice;
  }
  save();
}

// The couple's own choice for a charge, by id first and then by name (ids change when a bank is linked again).
export function choiceFor(sub) {
  const byId = getChoice(sub.id);
  if (byId) return byId;
  const v = state.byName[flat(sub.name)];
  return v === 'go' || v === 'stay' ? v : null;
}

// The app's first guess. Uses cancelCandidates from /lib/bank.js. Plaid often files a repeat
// charge as TRANSFER_OUT with no merchant, so in that case look at how the same name was filed
// in the transactions before deciding.
export function defaultChoice(sub, transactions = []) {
  if (cancelCandidates([sub]).length) return 'go';
  const cat = String(sub.category || '').toUpperCase();
  if (cat === 'TRANSFER_OUT' && !sub.merchant) {
    const t = (transactions || []).find((x) => Number(x.amount) > 0 && x.category && sameMerchant(x.name, sub.name));
    const tcat = t ? String(t.category).toUpperCase() : '';
    if (tcat && tcat !== 'TRANSFER_OUT') {
      return cancelCandidates([{ ...sub, category: tcat, merchant: true }]).length ? 'go' : 'stay';
    }
  }
  return 'stay';
}

export function effectiveChoice(sub, transactions = []) {
  return choiceFor(sub) || defaultChoice(sub, transactions);
}

// Splits the repeat charges into what could go and what stays, biggest first.
export function splitSubs(recurring, transactions = []) {
  const go = [];
  const stay = [];
  for (const r of recurring || []) {
    if (!(Number(r.monthly) > 0)) continue;
    (effectiveChoice(r, transactions) === 'go' ? go : stay).push(r);
  }
  const big = (a, b) => b.monthly - a.monthly;
  return { go: go.sort(big), stay: stay.sort(big) };
}

// Dates. Plain "YYYY-MM-DD" strings, worked out in UTC so a day never shifts.

const toDate = (isoStr) => {
  const [y, m, d] = String(isoStr).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
};
const toISO = (dt) => dt.toISOString().slice(0, 10);

export function addDays(isoStr, n) {
  const dt = toDate(isoStr);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toISO(dt);
}

function addMonths(isoStr, n) {
  const dt = toDate(isoStr);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return toISO(dt);
}

function addPeriod(isoStr, frequency) {
  switch (String(frequency || '').toUpperCase()) {
    case 'WEEKLY': return addDays(isoStr, 7);
    case 'BIWEEKLY': return addDays(isoStr, 14);
    case 'SEMI_MONTHLY': return addDays(isoStr, 15);
    case 'ANNUALLY': return addMonths(isoStr, 12);
    default: return addMonths(isoStr, 1);
  }
}

function daysBetween(a, b) {
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}

// Cancelled

export function getCancelled(subId) {
  return state.cancelled[subId] || null;
}

export function allCancelled() {
  return Object.values(state.cancelled);
}

// Remembers the cancel date and what the charge looked like, so the bank can be checked later.
export function markCancelled(sub, { today = todayISO() } = {}) {
  const rec = {
    id: sub.id,
    name: sub.name,
    monthly: Number(sub.monthly) || 0,
    amount: Number(sub.amount) || Number(sub.monthly) || 0,
    frequency: sub.frequency || null,
    lastDate: sub.lastDate || null,
    nextDate: sub.nextDate || null,
    cancelledOn: today,
    skipTo: null
  };
  state.cancelled[sub.id] = rec;
  save();
  setChoice(sub.id, 'go', sub);
  return rec;
}

export function unmarkCancelled(subId) {
  delete state.cancelled[subId];
  save();
}

// When the next charge should have landed if the cancel did not work.
export function nextExpected(rec) {
  let d = rec.nextDate || (rec.lastDate ? addPeriod(rec.lastDate, rec.frequency) : null) || addDays(rec.cancelledOn, 31);
  for (let guard = 0; d <= rec.cancelledOn && guard < 60; guard++) d = addPeriod(d, rec.frequency);
  return d;
}

// Demo shortcut: pretend the next charge date has passed, so the verified state can be shown
// without waiting a month. Only the display changes. The bank is still the one that decides.
export function skipAhead(subId) {
  const rec = state.cancelled[subId];
  if (!rec) return null;
  rec.skipTo = addDays(nextExpected(rec), 3);
  save();
  return rec;
}

// What the bank says about a cancelled charge.
//   verified: no charge since the cancel date, and the next expected date has passed
//   waiting: nothing yet, the next expected date has not passed
//   charged-again: the same charge came through after the cancel date
// Returns detail too: { state, next, chargedOn, amount, soon, days }.
export function cancelCheck(rec, transactions = [], { today = todayISO(), fetchedAt = null } = {}) {
  const amt = Number(rec.amount) || Number(rec.monthly) || 0;
  const tol = Math.max(1, amt * 0.2);
  const again = (transactions || [])
    .filter((t) => Number(t.amount) > 0 && String(t.date) > rec.cancelledOn && sameMerchant(t.name, rec.name) && Math.abs(Number(t.amount) - amt) <= tol)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const next = nextExpected(rec);
  if (again.length) {
    return { state: 'charged-again', next, chargedOn: again[0].date, amount: Number(again[0].amount), soon: daysBetween(rec.cancelledOn, again[0].date) <= 10 };
  }
  const ready = addDays(next, 2);
  const now = rec.skipTo && rec.skipTo > today ? rec.skipTo : today;
  // The bank must have been looked at after the date passed, or we only know the past.
  const looked = rec.skipTo ? true : (!fetchedAt || String(fetchedAt).slice(0, 10) >= ready);
  if (now >= ready && looked) return { state: 'verified', next };
  return { state: 'waiting', next, days: daysBetween(today, next) };
}

export function cancelState(sub, transactions = [], opts = {}) {
  const rec = getCancelled(sub.id) || (sub.cancelledOn ? sub : null);
  if (!rec) return null;
  return cancelCheck(rec, transactions, opts).state;
}

// The cancel guide

let guidePromise = null;

export function loadGuide() {
  if (!guidePromise) {
    guidePromise = fetch('data/cancel-guide.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((g) => (Array.isArray(g) ? g : []))
      .catch(() => []);
  }
  return guidePromise;
}

// Finds the guide for a charge name. A match token has to line up with whole words in the name,
// so "apple" finds APPLE.COM/BILL and does not find a pineapple stand. The longest match wins.
export function guideFor(name, guide = []) {
  const padded = ' ' + words(name).join(' ') + ' ';
  let best = null;
  let bestLen = 0;
  for (const g of guide) {
    for (const m of g.match || []) {
      const t = words(m).join(' ');
      if (t && padded.includes(' ' + t + ' ') && t.length > bestLen) { best = g; bestLen = t.length; }
    }
  }
  return best;
}

export function searchUrl(name) {
  return 'https://www.google.com/search?q=' + encodeURIComponent('how to cancel ' + name);
}

// What to show for any charge: the researched guide, or a plain fallback with a web search.
export function guideOrFallback(name, guide = []) {
  const g = guideFor(name, guide);
  if (g) return { ...g, fallback: false };
  return {
    fallback: true,
    name,
    cancelUrl: searchUrl(name),
    urlKind: 'search',
    steps: [],
    heads_up: null,
    source: null,
    text: 'We do not have a cancel guide for this one yet. Search for how to cancel it, or sign in on the company\'s site and look under Account or Billing.'
  };
}
