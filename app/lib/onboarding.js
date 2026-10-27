// Pure helpers for the onboarding flow. No DOM, no network.
// Bank data comes in the shape GET /api/bank returns (see js/store.js). Out come two gentle
// suggestions, what is already saved for the wedding and what can go toward it each month,
// plus a count of subscriptions for the "what we found" step. Nothing here is shown as fact;
// the couple can change every number before the plan is built.

import { bankCash } from './bank.js';

const dayMs = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function words(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function balanceOf(a) {
  return num(a.available ?? a.current ?? a.balance);
}

function pick(a) {
  return { id: a.id ?? null, name: a.name || 'Savings', mask: a.mask || '' };
}

// Rounds to the nearest step, for numbers people will read and edit ($575 reads better than $583).
export function roundTo(n, step = 25) {
  if (!step) return Math.round(num(n));
  return Math.round(num(n) / step) * step;
}

// Money already set aside. A savings account named for the wedding wins. Otherwise every
// savings account counts. No savings account means zero, and the couple types it in.
//
// With { keepInBank }, the money the couple always keeps in the bank to live on never counts. The buffer is taken
// out of the bank's cash as a whole (checking first, since that is where everyday money sits), so a buffer that
// checking already covers does not shrink the savings. When most of the cash is in savings, the savings give up the
// rest. Same shape as before, plus keepInBank and heldBack (how much the buffer took off the suggestion).
export function suggestSaved(bank, { keepInBank = 0 } = {}) {
  const accounts = Array.isArray(bank?.accounts) ? bank.accounts : [];
  const savings = accounts.filter((a) => {
    const sub = String(a.subtype || '').toLowerCase();
    return sub === 'savings' || sub === 'money market' || /saving/i.test(String(a.name || ''));
  });
  const named = savings.find((a) => /wedding|boda/i.test(String(a.name || '')));
  let out;
  if (named) out = { amount: Math.round(balanceOf(named)), account: pick(named), count: 1, reason: 'named' };
  else if (savings.length) {
    const total = savings.reduce((s, a) => s + balanceOf(a), 0);
    out = { amount: Math.round(total), account: savings.length === 1 ? pick(savings[0]) : null, count: savings.length, reason: 'savings' };
  } else out = { amount: 0, account: null, count: 0, reason: 'none' };

  const keep = Math.max(0, num(keepInBank));
  const cash = bankCash(bank);
  if (!keep || cash === null) return { ...out, keepInBank: keep, heldBack: 0 };
  const amount = Math.min(out.amount, Math.max(0, Math.round(cash - keep)));
  return { ...out, amount, keepInBank: keep, heldBack: out.amount - amount };
}

// A cushion to start from: about one month of regular spending, read from the bank (wedding charges left out, the
// same way suggestMonthly counts). Rounded to the nearest $100. Zero with no transactions to read.
// Returns { amount, spending, months, reason: 'spending' | 'none' }.
export function suggestBuffer(bank, { today = null } = {}) {
  const m = suggestMonthly(bank, { today });
  if (!m.months || !(m.spending > 0)) return { amount: 0, spending: 0, months: 0, reason: 'none' };
  return { amount: roundTo(m.spending, 100), spending: m.spending, months: m.months, reason: 'spending' };
}

// Charges that are wedding spending, not everyday life. They sit outside "regular spending"
// so a venue deposit last month does not make the couple look broke.
const WEDDING_WORDS = /wedding|boda|\bhall\b|venue|photograph|bridal|florist|flower|\bdj\b|cater|cake|bakery|party city|invitation|jewel|retainer|deposit/i;

// What the couple can likely set aside each month: about three months of money in, minus
// regular spending, split by the months covered. We suggest half of what is left, so life
// still has room. Plaid amounts: positive is money out, negative is money in.
export function suggestMonthly(bank, { months = 3, today = null } = {}) {
  const txns = Array.isArray(bank?.transactions) ? bank.transactions : [];
  const empty = { amount: 0, income: 0, spending: 0, leftover: 0, wedding: 0, months: 0, half: true };
  if (!txns.length) return empty;

  const dates = txns.map((t) => new Date(t.date).getTime()).filter((n) => Number.isFinite(n));
  if (!dates.length) return empty;
  const end = today ? new Date(today).getTime() : Math.max(...dates);
  const start = end - months * 30.4 * dayMs;

  let income = 0;
  let spending = 0;
  let wedding = 0;
  let earliest = end;
  for (const t of txns) {
    const when = new Date(t.date).getTime();
    if (!Number.isFinite(when) || when < start || when > end) continue;
    earliest = Math.min(earliest, when);
    const amt = num(t.amount);
    if (amt < 0) income += -amt;
    else if (WEDDING_WORDS.test(String(t.name || ''))) wedding += amt;
    else spending += amt;
  }
  if (!income && !spending) return empty;

  const spanDays = (end - earliest) / dayMs;
  const covered = Math.max(1, Math.min(months, Math.round(spanDays / 30.4) || 1));
  const incomeMo = income / covered;
  const spendingMo = spending / covered;
  const leftover = incomeMo - spendingMo;
  return {
    amount: Math.max(0, roundTo(leftover / 2, 25)),
    income: Math.round(incomeMo),
    spending: Math.round(spendingMo),
    leftover: Math.round(leftover),
    wedding: round2(wedding),
    months: covered,
    half: true
  };
}

// Recurring charges that read as subscriptions: small, steady, and not rent, utilities,
// loans, medical, groceries or meals. Plaid's recurring list often labels everything
// TRANSFER_OUT, so the category is borrowed from a matching transaction when it can be.
const NOT_SUBS = new Set([
  'RENT_AND_UTILITIES', 'LOAN_PAYMENTS', 'MEDICAL', 'GOVERNMENT_AND_NON_PROFIT', 'BANK_FEES',
  'INCOME', 'TRANSFER_IN', 'FOOD_AND_DRINK', 'TRANSPORTATION'
]);
const ESSENTIAL_WORDS = /\brent\b|mortgage|electric|utilit|water|gas co|insurance|loan|payroll|\birs\b|tax/i;
const MEAL_WORDS = /burger|taco|pizza|grill|cafe|coffee|starbucks|albertsons|walmart|target|h-e-b|\bheb\b|grocery|market|chick|mcdonald|sonic|wendy/i;

function categoryFor(stream, txns) {
  if (stream.category && stream.category !== 'TRANSFER_OUT') return stream.category;
  const key = words(stream.name)[0];
  if (!key) return null;
  const hit = txns.find((t) => words(t.name)[0] === key);
  return hit ? hit.category || null : null;
}

export function subscriptionSummary(bank) {
  const recurring = Array.isArray(bank?.recurring) ? bank.recurring : [];
  const txns = Array.isArray(bank?.transactions) ? bank.transactions : [];
  const items = recurring.filter((r) => {
    const monthly = num(r.monthly);
    if (monthly <= 0 || monthly > 150) return false;
    const cat = categoryFor(r, txns);
    if (cat && NOT_SUBS.has(cat)) return false;
    const name = String(r.name || '');
    if (ESSENTIAL_WORDS.test(name) || MEAL_WORDS.test(name)) return false;
    return true;
  });
  return { count: items.length, monthly: round2(items.reduce((s, r) => s + num(r.monthly), 0)), items };
}

// "We have not picked a date yet": a season becomes the middle of that season, so every
// deadline still has something to count back from.
const SEASON_MID = { spring: '04-15', summer: '07-15', fall: '10-15', winter: '01-15' };
export const SEASONS = ['spring', 'summer', 'fall', 'winter'];

export function seasonDate(season, year) {
  const key = String(season || '').toLowerCase();
  const mid = SEASON_MID[key] || SEASON_MID.summer;
  const y = Number(year) || new Date().getFullYear() + 1;
  return `${y}-${mid}`;
}

// A word for the size of the party, so the slider reads as a feeling and not a figure.
export function guestsWord(n) {
  const g = num(n);
  if (g < 50) return 'Just the closest people';
  if (g < 100) return 'Family and good friends';
  if (g < 160) return 'A classic wedding';
  if (g < 250) return 'A big celebration';
  return 'The whole town';
}
