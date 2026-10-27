// Bank connection. The server holds the Plaid keys and the access token.
// This file talks to the server and hands the result to the store.
//
// Server routes (owned by the server builder):
//   GET  /api/bank              -> { connected, sandbox, cash, accounts[], recurring[], recurringMonthly, transactions[] }
//   POST /api/plaid/test-bank   -> connects the Plaid Sandbox bank in one tap, then GET /api/bank again
//   POST /api/plaid/link-token  -> { link_token } for the real Plaid Link flow (needs the Link script on the page)
//   POST /api/plaid/exchange    -> { public_token } from Link, server stores the access token
//
// The math helpers (matching payments, cancel candidates, freed money) live in /lib/bank.js.
//
// Every refresh also runs verifyWithBank() from the store: payments and family money get checked against the
// transactions, the history fills in, and each new verification shows one toast.
// startBankWatch() (call it once from app.js) rechecks when the app opens and when the tab comes back.

import { setBankData, getBankData, getHistory, verifyWithBank } from './store.js';
import { toast } from './ui.js';
import { verificationMessage } from '../lib/bank.js';

export { matchPayments, cancelCandidates, monthlyFreed, freedByWedding } from '../lib/bank.js';

export const ROUTES = {
  bank: 'api/bank',
  testBank: 'api/plaid/test-bank',
  linkToken: 'api/plaid/link-token',
  exchange: 'api/plaid/exchange'
};

async function readJSON(res) {
  try { return await res.json(); } catch { return null; }
}

async function postJSON(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await readJSON(res);
  if (!res.ok) throw new Error((data && (data.message || data.error)) || `${url} answered ${res.status}`);
  return data;
}

let lastCheck = 0;

// One toast at a time on screen, so a batch of verifications is shown one after the other.
const TOAST_MS = 3000;
function announce(messages) {
  const list = messages.slice(0, 3);
  if (messages.length > 3) list.push(`${messages.length - 3} more verified by your bank`);
  list.forEach((m, i) => { setTimeout(() => toast(m, TOAST_MS), i * (TOAST_MS + 200)); });
}

// Reads the entries the check just settled and says what the bank found, in plain words.
export function announceVerified(result) {
  const ids = new Set([...(result?.verified || []), ...(result?.different || [])]);
  if (!ids.size) return [];
  const entries = getHistory().filter((h) => ids.has(h.id)).reverse(); // oldest first
  const messages = entries.map(verificationMessage);
  announce(messages);
  return messages;
}

// Asks the server what it has. Updates the store when the answer is clear, leaves it alone when the route
// is not there yet. Then lets the bank confirm what is in the plan (payments, family money) and toasts each
// new verification: "Verified by your bank: photographer retainer, $640."
export async function refreshBankData({ force = false } = {}) {
  if (!force && Date.now() - lastCheck < 30000) return getBankData();
  lastCheck = Date.now();
  let res;
  try { res = await fetch(ROUTES.bank); } catch { return getBankData(); }
  if (res.status === 404) return getBankData();
  const data = await readJSON(res);
  if (!res.ok || !data) return getBankData();
  if (data.connected === false) { setBankData(null); return null; }
  setBankData({ ...data, fetchedAt: new Date().toISOString() });
  announceVerified(verifyWithBank());
  return getBankData();
}

// One tap: connects the Plaid Sandbox bank, loads its data, and lets the bank verify what the plan has,
// so the couple sees it happen (refreshBankData does the checking and the toasts).
export async function connectBank() {
  await postJSON(ROUTES.testBank, {});
  return refreshBankData({ force: true });
}

// The auto recheck. Call once when the app starts. It refreshes the bank (and verifies) right away, and again
// each time the tab becomes visible, never more than once every few seconds. Returns a function that stops it.
let watching = null;
export function startBankWatch({ minGapMs = 4000 } = {}) {
  if (watching) return watching;
  let running = false;
  let last = 0;
  const check = async () => {
    if (running || Date.now() - last < minGapMs) return;
    running = true;
    try { await refreshBankData({ force: true }); } catch { /* keep what we have */ } finally { running = false; last = Date.now(); }
  };
  const onVisible = () => { if (document.visibilityState === 'visible') check(); };
  document.addEventListener('visibilitychange', onVisible);
  check();
  watching = () => {
    document.removeEventListener('visibilitychange', onVisible);
    watching = null;
  };
  return watching;
}

// The real flow, for when Plaid Link's script is on the page.
export async function connectWithPlaidLink() {
  const data = await postJSON(ROUTES.linkToken, {});
  const token = data && (data.link_token || data.linkToken);
  if (!token) throw new Error('The server did not return a link token.');
  if (!window.Plaid) throw new Error('Plaid Link is not on this page.');
  return new Promise((resolve, reject) => {
    const handler = window.Plaid.create({
      token,
      onSuccess: async (publicToken) => {
        try {
          await postJSON(ROUTES.exchange, { public_token: publicToken });
          resolve(await refreshBankData({ force: true }));
        } catch (e) { reject(e); }
      },
      onExit: (err) => {
        if (err) reject(new Error(err.display_message || err.error_message || 'Plaid Link closed with an error.'));
        else resolve(null);
      }
    });
    handler.open();
  });
}

// How often a charge lands, in plain words.
export function frequencyLabel(f) {
  const map = { WEEKLY: 'weekly', BIWEEKLY: 'every two weeks', SEMI_MONTHLY: 'twice a month', MONTHLY: 'monthly', ANNUALLY: 'yearly', UNKNOWN: '' };
  const key = String(f || '').toUpperCase();
  return map[key] ?? key.toLowerCase().replace(/_/g, ' ');
}

// Plaid's category codes, in plain words.
export function categoryLabel(c) {
  const map = {
    ENTERTAINMENT: 'Entertainment', FOOD_AND_DRINK: 'Food and drink', GENERAL_MERCHANDISE: 'Shopping',
    GENERAL_SERVICES: 'Services', PERSONAL_CARE: 'Personal care', TRAVEL: 'Travel', TRANSPORTATION: 'Transportation',
    RENT_AND_UTILITIES: 'Rent and utilities', LOAN_PAYMENTS: 'Loan payments', MEDICAL: 'Medical',
    HOME_IMPROVEMENT: 'Home', TRANSFER_OUT: 'Transfer', TRANSFER_IN: 'Transfer in', INCOME: 'Income',
    BANK_FEES: 'Bank fees', GOVERNMENT_AND_NON_PROFIT: 'Government'
  };
  const key = String(c || '').toUpperCase();
  return map[key] || (key ? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, ' ') : '');
}
