// The path: Padrino's home. Seven sections of small milestones, worked out from real data.
//
//   getPath({ today? })  -> { progress: { done, total, pct }, current: nodeId|null, sections: [...] }
//   completeStep(nodeId, stepId, value) -> { nodeDone, message }   (a bank connect also returns pending: Promise)
//   getNode(nodeId)      -> { section, node } for the step screen, or null
//   skipNode(nodeId)     -> same shape as completeStep, for "not for us"
//   ready()              loads the budget template once (guest changes use it)
//
// Section: { id, title, subtitle, when, dates, color, photo, opensOn, locked, lockedNote, done, total, nodes }
//   when is the stage in words ("12 to 10 months out"); dates is the same window for this couple ("Jun to Aug 2026"),
//   or null when the section has no window or the wedding date is not set.
// Node:    { id, title, short, status: done|current|next|locked, verified, doneNote, lockedNote, bookNote, bookBy,
//            skippable, skipped, steps }
// Step:    { id, kind: info|choice|input|route|action, title, body, lesson?, options?, field?, fields?, route?,
//            prefill?, action?, args?, cta, done }
//   lesson   one line on why, from the wedding lessons list. Show it small under the body.
//   field    { name, label, type: money|number|percent|text|date, value?, min?, max? }. fields has more than one;
//            field is always the first. completeStep gets a plain value for one field, an object for fields.
//   prefill  for route /quotes: call prefillQuote(step.prefill) from screens/quotes.js before going there.
//
// Path control (Round 6): the couple stays in charge of the path.
//   jumpTo(nodeId)                 opens any milestone, even a locked one. The node turns "next" (jumped: true) and the
//                                  current node does not change. Returns { ok, nodeId, wasLocked, message }
//   markDone(nodeId)               done by hand: node.manual is true unless the data says it is done too
//   reopenNode(nodeId, reason)     something went wrong: node.problem = { reason, at, scope }, status back to
//                                  current or next, even when real data (a verified payment) still says done. It stays
//                                  reopened until markDone, or until the last step is finished again
//   reopenSection(sectionId, reason)  the same for every node in the section that was done (section.problem is set)
// Wedding style (Round 6): setTraditions in store.js adds budget lines; the styles' milestones show up here as nodes
// named trad-<styleId>-<milestoneId>, at the end of the section the style says (node.tradition is the style id).
//
// Status comes from real data first (bank, plan, history, subscriptions, contracts, give links, after checklist).
// Only steps with nothing behind them are kept in a small record of our own (padrino.path.v1), and that record is
// wiped whenever the plan is replaced (Load demo, Start over, a new plan). No money math here: totals come from
// calc.js and the store. Store functions come from several builders, so calls are guarded with typeof.

import * as store from './store.js';
import { summary, guestImpact, paymentTimeline, pledgeSummary } from './calc.js';
import { getTemplate } from './data.js';
import { money, todayISO, uid, fmtDateShort } from './format.js';
import * as subs from './subs.js';
import { priorityLabel } from './priorities.js';
import { monthlyFreed } from '../lib/bank.js';
import { suggestBuffer, suggestSaved } from '../lib/onboarding.js';
import { parseDate, addMonths, toISO } from '../lib/money.js';

export const PATH_KEY = 'padrino.path.v1';

// ------------------------------------------------------------------ small helpers

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const has = (name) => typeof store[name] === 'function';
function safe(name, fallback, ...args) {
  try { return has(name) ? store[name](...args) : fallback; } catch (e) { console.error(e); return fallback; }
}
function call(name, ...args) {
  if (!has(name)) throw new Error('That part of the app is not ready yet.');
  return store[name](...args);
}
const sum = (list, f) => list.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const vkey = (s) => String(s || '').toLowerCase().replace(/\(demo\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const plural = (n, one, many) => (n === 1 ? one : many);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ------------------------------------------------------------------ template (guest changes use it)

let template = [];
let templatePromise = null;
export function ready() {
  if (!templatePromise) {
    templatePromise = getTemplate().then((t) => { template = Array.isArray(t) ? t : []; }).catch(() => { templatePromise = null; });
  }
  if (has('loadTraditions')) Promise.resolve(store.loadTraditions()).catch(() => {}); // the wedding styles; fine if the file is not there
  return templatePromise;
}
ready();

// ------------------------------------------------------------------ our own small record

function blankLocal() { return { planId: null, steps: {}, skipped: {}, values: {}, jumped: {}, manual: {}, reopened: {} }; }
const LOCAL_MAPS = ['steps', 'skipped', 'values', 'jumped', 'manual', 'reopened'];

function loadLocal() {
  try {
    const raw = localStorage.getItem(PATH_KEY);
    if (!raw) return blankLocal();
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return blankLocal();
    const out = { ...blankLocal(), ...p };
    for (const k of LOCAL_MAPS) if (!out[k] || typeof out[k] !== 'object' || Array.isArray(out[k])) out[k] = {};
    return out;
  } catch { return blankLocal(); }
}

let local = loadLocal();

function saveLocal() {
  try { localStorage.setItem(PATH_KEY, JSON.stringify(local)); } catch { /* private mode: still works this visit */ }
}

// Plan identity. The record belongs to one plan. Every plan carries a pathId stamped here. Load demo, Start over and
// a new plan arrive without one (or as no plan), so the record is wiped. Plan objects are replaced on every change,
// so identity cannot be the object itself.
function resetLocal(planId) {
  local = { ...blankLocal(), planId };
  saveLocal();
}

function stampNow() {
  const p = store.getPlan();
  if (!p || p.pathId || !has('update')) return;
  store.update((q) => { q.pathId = uid('path'); });
  const next = store.getPlan();
  if (next?.pathId) resetLocal(next.pathId);
}

function syncIdentity() {
  const p = store.getPlan();
  if (!p) {
    if (local.planId || LOCAL_MAPS.some((k) => Object.keys(local[k]).length)) resetLocal(null);
    return;
  }
  if (!p.pathId) {
    resetLocal(null);
    const run = () => { try { stampNow(); } catch (e) { console.error(e); } };
    if (typeof queueMicrotask === 'function') queueMicrotask(run); else run();
    return;
  }
  if (local.planId !== p.pathId) resetLocal(p.pathId);
}

let unsubscribe = null;
export function initPath() {
  if (unsubscribe || !has('subscribe')) return;
  unsubscribe = store.subscribe(() => { try { syncIdentity(); } catch (e) { console.error(e); } });
  try { syncIdentity(); } catch (e) { console.error(e); }
}
initPath();

// The record only counts while it belongs to the plan in hand.
function liveLocal() {
  const p = store.getPlan();
  return p?.pathId && local.planId === p.pathId ? local : blankLocal();
}

// ------------------------------------------------------------------ the context every check reads

function buildCtx(today) {
  const p = store.getPlan() || store.emptyPlan();
  const bank = safe('getBankData', null);
  const rec = liveLocal();
  const lines = new Map((p.lines || []).map((l) => [l.id, l]));
  const s = summary(p, template, today);
  const c = {
    p, today, bank, s, rec,
    connected: Boolean(bank && bank.connected !== false),
    history: safe('getHistory', []),
    contracts: safe('getContracts', []),
    giveLinks: safe('getGiveLinks', []),
    afterDone: p.afterDone || {},
    cards: safe('getCards', []),
    pledges: pledgeSummary(p),
    timeline: paymentTimeline(p, today),
    cancelled: subs.allCancelled(),
    styles: safe('getTraditions', { ids: [], names: [], notes: '' }),
    styleOptions: safe('getTraditionOptions', []),
    milestones: safe('getTraditionMilestones', []),
    line: (id) => lines.get(id) || null,
    value: (key) => rec.values[key],
    seen: (nodeId, stepId) => Boolean(rec.steps[`${nodeId}.${stepId}`])
  };
  return c;
}

// What the plan says about booking one or more budget lines.
function booking(c, ids) {
  const lines = ids.map((id) => c.line(id)).filter(Boolean);
  const committed = sum(lines, (l) => l.committed);
  const paidAmount = sum(lines, (l) => l.paid);
  const paidPay = c.p.payments.some((x) => ids.includes(x.lineId) && x.status === 'paid');
  const vendor = lines.find((l) => l.vendor)?.vendor || null;
  const proved = c.history.some((h) => h.kind === 'payment' && ids.includes(h.ref?.lineId) && h.bank && (h.status === 'verified' || h.status === 'different'));
  return { vendor, committed, paidAmount, booked: committed > 0 || paidAmount > 0, paid: paidAmount > 0 || paidPay, proved, lines };
}

function contractDone(c, ids) {
  const vendor = vkey(booking(c, ids).vendor);
  if (!vendor) return false;
  return c.contracts.some((ct) => {
    const k = vkey(ct.vendor || ct.vendorName);
    return k && (k === vendor || k.includes(vendor) || vendor.includes(k));
  });
}

function bookNote(c, line) {
  if (!line || !(Number(line.committed) > 0)) return null;
  return `${line.vendor || 'Booked'}: ${money(line.committed)} booked${Number(line.paid) > 0 ? `, ${money(line.paid)} paid` : ''}.`;
}

// ------------------------------------------------------------------ step and node builders

const RUN = Symbol('run'); // what completeStep does for a step; never part of the public data
const DEFAULT_CTA = { info: 'Got it', choice: 'Continue', input: 'Save', route: 'Open', action: 'Do it' };

function step(id, kind, title, body, extra = {}) {
  const { run, ...rest } = extra;
  const s = { id, kind, title, body, cta: DEFAULT_CTA[kind], ...rest };
  if (run) s[RUN] = run;
  return s;
}

const info = (id, title, body, extra) => step(id, 'info', title, body, extra);
const route = (id, title, body, to, extra) => step(id, 'route', title, body, { route: to, ...extra });

// Months before the wedding that most couples book each thing. Mirrors bookMonthsBefore in budget-template.json
// (the tests check it). Used for the "book by" hint, never for locking.
const BOOK_MONTHS = { venue: 12, photographer: 9, caterer: 9, music: 9, florist: 8, attire: 8, beauty: 6, officiant: 9, invites: 6 };

// ------------------------------------------------------------------ the nodes

function fieldMoney(name, label, value) { return { name, label, type: 'money', value: isNum(value) && value > 0 ? value : undefined, min: 0 }; }

function validMoney(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }

// Venue, photographer, caterer: quote, contract check, deposit. Locked means a quote is in and money has moved.
function bigThree({ id, line, slug, title, short, doneMessage, quote, contract, pay, skippable }) {
  return (c) => {
    const b = booking(c, [line]);
    const row = c.line(line);
    return {
      id, title, short, doneMessage, skippable: Boolean(skippable), bookMonths: BOOK_MONTHS[id],
      check: () => (b.booked && b.paid
        ? { done: true, verified: b.proved, note: bookNote(c, row) || `${title}: booked and paid.` }
        : { done: false }),
      steps: [
        route('quote', quote.title, quote.body, '/quotes', { prefill: { lineId: line }, lesson: quote.lesson, cta: 'Read my quote', done: Number(row?.committed) > 0 }),
        route('contract', contract.title, contract.body, '/contract', { lesson: contract.lesson, cta: 'Check it', done: contractDone(c, [line]) }),
        route('pay', pay.title, pay.body, '/payments', { lesson: pay.lesson, cta: 'See my payments', done: b.paid })
      ]
    };
  };
}

// A team vendor: find options, get a loaded quote, and the line shows it is booked.
function teamVendor({ id, ids, slug, quoteLine, title, short, doneMessage, intro, find, quote, skippable = true }) {
  return (c) => {
    const b = booking(c, ids);
    return {
      id, title, short, doneMessage, skippable, bookMonths: BOOK_MONTHS[id],
      check: () => (b.booked
        ? { done: true, verified: b.proved, note: bookNote(c, b.lines.find((l) => l.committed > 0) || null) || `${title}: booked.` }
        : { done: false }),
      steps: [
        info('start', intro.title, intro.body, { lesson: intro.lesson }),
        route('find', find.title, find.body, `/vendors?cat=${slug}`, { lesson: find.lesson, cta: 'See options' }),
        route('quote', quote.title, quote.body, '/quotes', { prefill: { lineId: quoteLine }, lesson: quote.lesson, cta: 'Read my quote', done: b.booked })
      ]
    };
  };
}

function afterStep(id, title, body, afterId, c, extra = {}) {
  const done = Boolean(c.afterDone[afterId]);
  return step(id, 'action', title, body, {
    action: 'mark_after', args: { afterId }, cta: 'Done', done,
    run: () => {
      if (!c.afterDone[afterId]) call('toggleAfterItem', afterId);
      return { message: 'Checked off.' };
    },
    ...extra
  });
}

const afterAll = (c, ids) => ids.every((id) => c.afterDone[id]);

// Each entry builds a node from the context. Sections below say which nodes go where.
const NODE_BUILDERS = {
  // ---------------------------------------------------------------- 1. Set the foundation
  bank: (c) => ({
    id: 'bank', title: 'Connect your bank', short: 'So Padrino can check every payment for you.', doneMessage: 'Bank connected.',
    check: () => (c.connected
      ? { done: true, verified: true, note: c.bank.sandbox ? 'Test bank connected.' : `${(c.bank.accounts || []).length || 1} ${plural((c.bank.accounts || []).length || 1, 'account', 'accounts')} connected.` }
      : { done: false }),
    steps: [
      info('why', 'Your bank is the proof', 'Connect once. When a payment leaves your account, Padrino ticks it off and tells you. You never type it in twice.', { lesson: 'Keep every quote and payment confirmation in one place.', cta: 'Next' }),
      step('connect', 'action', 'Connect your bank', 'Padrino reads your accounts. It never moves money.', {
        action: 'connect_bank', cta: 'Connect my bank', done: c.connected,
        run: () => {
          if (c.connected) return { message: 'Your bank is already connected.' };
          const pending = import('./bank.js').then((b) => b.connectBank());
          return { message: 'Connecting your bank...', pending };
        }
      })
    ]
  }),

  number: (c) => {
    const saved = Number(c.p.money?.saved) || 0;
    const monthly = Number(c.p.money?.monthly) || 0;
    const keep = Number(c.p.money?.keepInBank) || 0;
    const keepSet = isNum(c.p.money?.keepInBank);
    // From the bank, when it is connected: about a month of everyday spending for the buffer, and what the savings
    // accounts hold above that buffer for "saved so far".
    const buf = c.connected ? suggestBuffer(c.bank) : null;
    const sav = c.connected && saved === 0 ? suggestSaved(c.bank, { keepInBank: keep || buf?.amount || 0 }) : null;
    const keepValue = keep > 0 ? keep : buf && buf.amount > 0 ? buf.amount : undefined;
    return {
      id: 'number', title: 'Your number', short: 'What you can really spend.', doneMessage: 'Your number is set.',
      check: () => ((saved > 0 || monthly > 0)
        ? { done: true, verified: false, note: c.s.available > 0 ? `About ${money(c.s.available)} by your wedding day.` : 'Your savings are in.' }
        : null),
      steps: [
        step('buffer', 'input', 'How much always stays in your bank?', buf && buf.amount > 0 && !keepSet
          ? `Money for living: rent, food, the car. Your bank shows about ${money(buf.spending)} of everyday spending a month, so that is filled in. Change it to what feels safe. The wedding never touches it, and Padrino warns you before a payment would.`
          : 'Money for living: rent, food, the car. The wedding never touches it, and Padrino warns you before a payment would push your bank under it. Zero is fine.', {
          lesson: 'Leave room for surprises, so one does not turn into debt.',
          buffer: true,
          field: fieldMoney('keepInBank', 'Always keep in my bank', keepValue), done: keepSet,
          run: (v) => {
            const n = typeof v === 'boolean' || v === undefined || v === null || v === '' ? null : validMoney(v);
            if (n === null) {
              if (keepSet) return { message: keep > 0 ? `Keeping ${money(keep)} in your bank.` : 'No cushion set. You can add one any time.' };
              return { ok: false, message: 'Type an amount like 1500, or 0 for none.' };
            }
            call('setKeepInBank', n);
            return { message: n > 0 ? `Keeping ${money(n)} in your bank.` : 'No cushion set. You can add one any time.' };
          }
        }),
        step('saved', 'input', 'What have you saved so far?', sav && sav.amount > 0
          ? `Your savings accounts hold about ${money(sav.amount)}${sav.heldBack > 0 ? `, after the ${money(sav.keepInBank)} you keep in your bank` : ''}. That is filled in. Change it to only what is for the wedding.`
          : 'Just the money set aside for the wedding. Zero is fine.', {
          lesson: 'Start from your own money, not from what weddings supposedly cost.',
          field: fieldMoney('saved', 'Saved so far', saved > 0 ? saved : sav?.amount), done: saved > 0,
          run: (v) => {
            const n = validMoney(v);
            if (n === null) return { ok: false, message: 'Type an amount like 5000.' };
            call('setMoney', { saved: n });
            return { message: `Saved: ${money(n)} so far.` };
          }
        }),
        step('monthly', 'input', 'What can you add each month?', 'Be honest. A smaller amount you keep beats a big one you miss.', {
          lesson: 'Treat cash gifts as a bonus, not as funding.',
          field: fieldMoney('monthly', 'Each month', monthly), done: monthly > 0,
          run: (v) => {
            const n = validMoney(v);
            if (n === null) return { ok: false, message: 'Type an amount like 700.' };
            call('setMoney', { monthly: n });
            return { message: `Saved: ${money(n)} a month.` };
          }
        })
      ]
    };
  },

  // ---------------------------------------------------------------- the wedding style (Round 6)
  style: (c) => {
    const ids = c.styles.ids || [];
    const notes = c.styles.notes || '';
    const options = c.styleOptions.map((o) => ({ id: o.id, label: o.name, hint: o.blurb || undefined, photo: o.photo || null }));
    return {
      id: 'style', title: 'Your wedding style', short: 'Traditions shape your budget and your milestones.', doneMessage: 'Wedding style set.', skippable: true,
      check: () => (ids.length
        ? { done: true, verified: false, note: `${listWords(c.styles.names)}.` }
        : { done: false }),
      steps: [
        step('pick', 'choice', 'Which traditions are part of your day?', 'Pick every one that fits. Padrino adds the costs and the steps that go with them. If it is a blend, pick Mixed or our own and say it in your own words.', {
          multi: true, selected: ids, notes: notes || undefined, options, done: ids.length > 0,
          run: (v) => {
            const picked = pickedStyles(v);
            if (!picked.ids.length) return { ok: false, message: 'Pick at least one, or choose Mixed or our own.' };
            const r = call('setTraditions', picked.ids, picked.notes);
            if (!r) return { ok: false, message: 'Set up your wedding first.' };
            const marks = safe('getTraditionMilestones', []).length;
            const bits = [];
            if (r.added.length) bits.push(`${r.added.length} budget ${plural(r.added.length, 'line', 'lines')} at $0`);
            if (marks) bits.push(`${marks} ${plural(marks, 'milestone', 'milestones')}`);
            return { message: `Got it: ${listWords(r.names)}.`, detail: bits.length ? `Added ${listWords(bits)} for you.` : '' };
          }
        }),
        step('notes', 'input', 'Anything else about your day?', 'A custom from your family, a mix of two cultures, something Padrino should know. Skip this if there is nothing.', {
          field: { name: 'notes', label: 'In your own words', type: 'text', value: notes || undefined }, done: Boolean(notes),
          run: (v) => {
            const text = typeof v === 'string' ? v.trim() : '';
            const r = call('setTraditions', ids, text);
            if (!r) return { ok: false, message: 'Set up your wedding first.' };
            return { message: text ? 'Noted. Padrino will keep that in mind.' : 'Okay.' };
          }
        })
      ]
    };
  },

  priorities: (c) => {
    const top = c.p.priorities?.top || [];
    return {
      id: 'priorities', title: 'Your top 3', short: 'What matters most gets the money first.', doneMessage: 'Top 3 picked.',
      check: () => (top.length >= 1
        ? { done: true, verified: false, note: top.map(priorityLabel).join(', ') + '.' }
        : { done: false }),
      steps: [
        route('pick', 'Pick what matters most', 'Each of you picks your top 3 on your own, and Padrino blends them. Those lines get protected when money gets tight.', '/setup', {
          lesson: 'Do not spread money thin. A little on everything leaves nothing great.', cta: 'Pick mine', done: top.length >= 1
        })
      ]
    };
  },

  guests: (c) => {
    const guests = Number(c.p.couple?.guests) || 0;
    const set = Boolean(c.value('guests')) || (guests > 0 && guests !== 100);
    const perGuest = Number(c.s.perGuest) || 0;
    return {
      id: 'guests', title: 'Your guest count', short: 'Every guest adds to the bill.', doneMessage: 'Guest count set.',
      check: () => (set ? { done: true, verified: false, note: `${guests} guests.` } : { done: false }),
      steps: [
        info('cost', 'Guests drive the cost', perGuest > 0 ? `Right now your plan works out to about ${money(perGuest)} per guest. Each name you add moves that.` : 'Each name you add moves the food, drinks, rentals and more.', {
          lesson: 'Cutting the guest list is the most effective way to lower the cost.', cta: 'Next'
        }),
        step('count', 'input', 'How many guests?', 'Your best honest guess. You can change it any time.', {
          lesson: 'Guest counts creep up, so start with the real list, not a hope.',
          field: { name: 'guests', label: 'Guests', type: 'number', value: guests || undefined, min: 1, max: 1500 }, done: set,
          run: (v) => setGuestCount(c, v)
        })
      ]
    };
  },

  padrinos: (c) => {
    const pl = c.pledges;
    return {
      id: 'padrinos', title: 'Who is helping', short: 'Padrinos, family and friends who want to chip in.', doneMessage: 'Helpers added.', skippable: true,
      check: () => (pl.count > 0
        ? {
          done: true,
          verified: c.history.some((h) => h.kind === 'family' && h.bank && (h.status === 'verified' || h.status === 'different')),
          note: `${pl.count} ${plural(pl.count, 'person has', 'people have')} promised ${money(pl.pledged)}.`
        }
        : { done: false }),
      steps: [
        info('strings', 'Talk about strings first', 'Whoever pays may want a say in the plan or the guest list. Decide how you will handle that before you take the money.', {
          lesson: 'Whoever pays may expect a say, so decide how to handle family money before you accept it.', cta: 'Next'
        }),
        step('add', 'input', 'Add one person who offered to help', 'A padrino, a parent, anyone. Add the others any time in Family.', {
          fields: [
            { name: 'name', label: 'Who', type: 'text' },
            { name: 'amount', label: 'How much they said', type: 'money', min: 0 },
            { name: 'item', label: 'What for (optional)', type: 'text' }
          ],
          field: { name: 'name', label: 'Who', type: 'text' }, done: pl.count > 0,
          run: (v) => {
            const name = String(v?.name || '').trim();
            const amount = validMoney(v?.amount);
            if (!name) return { ok: false, message: 'Who is helping?' };
            if (amount === null) return { ok: false, message: 'Type the amount they said, like 500.' };
            call('addPledge', { name, amount, received: 0, item: String(v?.item || '').trim(), strings: '' });
            return { message: `Added ${name}: ${money(amount)} promised.` };
          }
        })
      ]
    };
  },

  // ---------------------------------------------------------------- 2. Lock the big three
  venue: bigThree({
    id: 'venue', line: 'venue-rental', slug: 'venues', title: 'Lock the venue', short: 'It sets your date, your headcount and what else you rent.', doneMessage: 'Venue locked.',
    quote: { title: 'Get the venue\'s full price', body: 'Ask for a quote with the service charge, tax and tips in it. Paste it or snap a photo and Padrino adds up the real total.', lesson: 'Ask for a fully loaded quote: service charge, tax and tips can add a third.' },
    contract: { title: 'Check the contract', body: 'Before you sign, run it through the contract check. It points at vague words and what you owe if plans change.', lesson: 'Compare venues on total cost, not the rental fee.' },
    pay: { title: 'Pay the deposit', body: 'Pay from your own account so your bank can confirm it. Padrino ticks it off when it sees the money leave.', lesson: 'If a vendor emails new bank details, call a number you already had.' }
  }),

  photographer: bigThree({
    id: 'photographer', line: 'photographer', slug: 'photography', title: 'Lock the photographer', short: 'Photos cannot be redone.', doneMessage: 'Photographer locked.', skippable: true,
    quote: { title: 'Get the photographer\'s full price', body: 'Ask what the hours, travel and overtime cost. Padrino reads the quote and shows the real total.', lesson: 'Cheap photography often costs twice. Photos cannot be redone.' },
    contract: { title: 'Check the contract', body: 'Look at usage rights, what happens if they cancel, and who really shows up.', lesson: 'Ask what happens if the vendor cancels or swaps the person you hired.' },
    pay: { title: 'Pay the retainer', body: 'Retainers are often non-refundable, so be sure first. Pay from your account and Padrino watches for it.', lesson: 'A non-refundable deposit can hide a much larger bill if you cancel.' }
  }),

  caterer: bigThree({
    id: 'caterer', line: 'catering-food', slug: 'catering', title: 'Lock the caterer', short: 'Food is priced per guest.', doneMessage: 'Caterer locked.', skippable: true,
    quote: { title: 'Get the caterer\'s full price', body: 'Ask for the food, service charge, tax and tip all in one number. Padrino adds up the real total.', lesson: 'A 24% service charge plus tax added nearly $17,000 to one $50,000 catering bill.' },
    contract: { title: 'Check the contract', body: 'Find the headcount deadline and the fees for outside cake or drinks.', lesson: 'You pay for the headcount you guarantee, not for who shows up.' },
    pay: { title: 'Pay the deposit', body: 'Usually a quarter to half at signing. Pay from your account so your bank can confirm it.', lesson: 'Map your payments by date so you know how much is out before the day.' }
  }),

  // ---------------------------------------------------------------- 3. Build your team
  music: (c) => {
    const ids = ['dj', 'live-band', 'ceremony-music', 'mariachi-short', 'mariachi-full'];
    const b = booking(c, ids);
    const pick = c.value('music');
    const slug = pick === 'mariachi' ? 'mariachi' : 'dj-music';
    const quoteLine = pick === 'mariachi' ? 'mariachi-short' : pick === 'band' ? 'live-band' : 'dj';
    const playlist = pick === 'playlist';
    return {
      id: 'music', title: 'Book the music', short: 'The party depends on it.', doneMessage: 'Music booked.', skippable: true, bookMonths: BOOK_MONTHS.music,
      check: () => (b.booked
        ? { done: true, verified: b.proved, note: bookNote(c, b.lines.find((l) => l.committed > 0)) || 'Music booked.' }
        : playlist ? { done: true, verified: false, note: 'You are going with a playlist.' } : { done: false }),
      steps: [
        step('type', 'choice', 'What fits your day?', 'Pick one. You can still change your mind.', {
          lesson: 'Do not skimp on music. A DJ or band was called worth it, and shortened music was a named regret.',
          options: [
            { id: 'dj', label: 'A DJ' }, { id: 'band', label: 'A live band' },
            { id: 'mariachi', label: 'Mariachi', hint: 'A 30 minute set is billed by the hour.' }, { id: 'playlist', label: 'Just a playlist' }
          ],
          done: Boolean(pick), run: (v) => {
            const ok = ['dj', 'band', 'mariachi', 'playlist'].includes(v);
            if (!ok) return { ok: false, message: 'Pick one to continue.' };
            setValue('music', v);
            return { message: v === 'playlist' ? 'A playlist it is.' : 'Good pick.' };
          }
        }),
        ...(playlist ? [] : [
          route('find', 'Look at three options', 'Save the ones you like. Do not book the first person you talk to.', `/vendors?cat=${slug}`, { lesson: 'Collect several quotes in one place and do not book the first vendor you talk to.', cta: 'See options' }),
          route('quote', 'Get a quote with everything in it', 'Ask about hours, travel, setup time and overtime.', '/quotes', { prefill: { lineId: quoteLine }, lesson: 'Book 9 months to a year out. Popular ones fill up.', cta: 'Read my quote', done: b.booked })
        ])
      ]
    };
  },

  florist: teamVendor({
    id: 'florist', ids: ['florist'], slug: 'florists', quoteLine: 'florist', title: 'Book the flowers', short: 'Flowers cost more than most couples expect.', doneMessage: 'Flowers booked.',
    intro: { title: 'Plan smaller than you think', body: 'Reuse the ceremony flowers at the reception. Fewer big pieces beat many small ones.', lesson: 'Flowers are the classic surprise line, so scale down early.' },
    find: { title: 'Look at three florists', body: 'Save the ones whose style you like. Ask each for a number, not a mood board.', lesson: 'Collect several quotes in one place and do not book the first one.' },
    quote: { title: 'Get a quote with everything in it', body: 'Ask about delivery, setup and pickup. Padrino shows the real total.', lesson: 'Ask for a fully loaded quote: delivery, tax and setup add up.' }
  }),

  attire: (c) => {
    const ids = ['wedding-dress', 'grooms-attire'];
    const b = booking(c, ids);
    const dress = c.line('wedding-dress');
    return {
      id: 'attire', title: 'Find your attire', short: 'You wear it once.', doneMessage: 'Attire sorted.', skippable: true, bookMonths: BOOK_MONTHS.attire,
      check: () => (b.booked
        ? { done: true, verified: b.proved, note: 'Attire is bought.' }
        : { done: false }),
      steps: [
        info('shop', 'Start early, spend smart', 'Shop 10 to 12 months out and plan for several fittings. Alterations are their own cost on top.', { lesson: 'The dress is worn once, so do not let it take a big share.', cta: 'Next' }),
        step('budget', 'input', 'What will you spend on the dress?', 'Set the number before you fall in love with one.', {
          lesson: 'Plan alterations as their own cost. One planner says $500 to $1,200.',
          field: fieldMoney('planned', 'Dress budget', Number(dress?.planned) || 0), done: Number(dress?.planned) > 0,
          run: (v) => {
            const n = validMoney(v);
            if (n === null) return { ok: false, message: 'Type an amount like 1000.' };
            setLinePlanned(c, 'wedding-dress', n);
            return { message: `Dress budget: ${money(n)}.` };
          }
        }),
        route('buy', 'Tell Padrino when you buy it', 'Record the payment and your bank will confirm it.', '/add', { cta: 'Record it', done: b.booked })
      ]
    };
  },

  beauty: teamVendor({
    id: 'beauty', ids: ['hair-makeup', 'hair-makeup-trial'], slug: 'hair-makeup', quoteLine: 'hair-makeup', title: 'Book hair and makeup', short: 'Worth paying for.', doneMessage: 'Hair and makeup booked.',
    intro: { title: 'Plan a trial too', body: 'A trial run is its own small cost. Add it to the plan so it is not a surprise.', lesson: 'Skipping an artist you loved was a named regret.' },
    find: { title: 'Look at three artists', body: 'Look at real wedding photos, not just a reel.', lesson: 'Do not hire from a nice Instagram reel alone.' },
    quote: { title: 'Get a quote with everything in it', body: 'Ask if travel and early start fees are in the price.', lesson: 'Ask for a fully loaded quote with travel and early start fees.' }
  }),

  officiant: (c) => {
    const b = booking(c, ['officiant']);
    const pick = c.value('officiant');
    const friend = pick === 'friend';
    const licenseSeen = c.seen('officiant', 'license');
    const steps = [
      step('who', 'choice', 'Who will marry you?', 'A friend or relative can do it.', {
        lesson: 'In one study, 67% of couples under $12,000 used a friend.',
        options: [{ id: 'hire', label: 'Someone we hire' }, { id: 'friend', label: 'A friend or relative' }],
        done: Boolean(pick), run: (v) => {
          if (!['hire', 'friend'].includes(v)) return { ok: false, message: 'Pick one to continue.' };
          setValue('officiant', v);
          return { message: 'Noted.' };
        }
      }),
      ...(friend ? [] : [route('find', 'Look at three officiants', 'Meet them first. You will lean on this person on the day.', '/vendors?cat=officiants', { lesson: 'Choose vendors who are easy to work with.', cta: 'See options', done: b.booked })]),
      info('license', 'Get your marriage license', 'It is $81 at the El Paso County Clerk, valid 89 days, and you both go in person. Plan it for the last two months.', { lesson: 'Small items nobody budgets add up fast, and the license is one.', cta: 'Got it' })
    ];
    return {
      id: 'officiant', title: 'Pick your officiant', short: 'And plan the marriage license.', doneMessage: 'Officiant sorted.', skippable: true, bookMonths: BOOK_MONTHS.officiant,
      check: () => (b.booked
        ? { done: true, verified: b.proved, note: 'Officiant booked.' }
        : friend && licenseSeen ? { done: true, verified: false, note: 'A friend or relative will officiate.' } : { done: false }),
      steps
    };
  },

  // ---------------------------------------------------------------- 4. Find money
  subs: (c) => {
    const recurring = Array.isArray(c.bank?.recurring) ? c.bank.recurring : [];
    const go = c.connected ? subs.splitSubs(recurring, c.bank.transactions || []).go : [];
    const cancelled = c.cancelled.length;
    const nothing = c.connected && go.length === 0 && cancelled === 0;
    const proved = c.history.some((h) => h.kind === 'subscription' && h.status === 'verified');
    const freed = sum(c.cancelled, (x) => x.monthly);
    return {
      id: 'subs', title: 'Cut what you do not use', short: 'Repeat charges that could go.', doneMessage: 'Subscriptions trimmed.',
      check: () => (cancelled > 0
        ? { done: true, verified: proved, note: `Cancelled ${cancelled}: about ${money(freed)} a month freed.` }
        : nothing ? { done: true, verified: false, note: 'Nothing on your bank looks worth cancelling.' } : { done: false }),
      steps: [
        info('see', c.connected ? 'See what repeats' : 'Connect your bank first', c.connected && c.bank.recurringMonthly > 0
          ? `Your bank shows about ${money(c.bank.recurringMonthly)} a month in repeat charges. Some could go.`
          : 'Once your bank is connected, Padrino finds the repeat charges and shows which could go.', { lesson: 'Every $20 a month you free is $20 toward the wedding.', cta: 'Next' }),
        route('cancel', 'Pick what to cancel', 'Padrino shows how to cancel each one, then checks your bank to make sure it stopped.', '/find-money', { cta: 'Open Find money', done: cancelled > 0 })
      ]
    };
  },

  freed: (c) => {
    const monthly = Number(c.p.money?.freedMonthly) || 0;
    return {
      id: 'freed', title: 'Put the freed money to work', short: 'Send it toward the wedding.', doneMessage: 'Freed money moved.', skippable: true,
      check: () => (monthly > 0
        ? { done: true, verified: false, note: `${money(monthly)} a month goes to the wedding.` }
        : { done: false }),
      steps: [
        step('move', 'action', 'Move it to the wedding', freedPreview(c), {
          action: 'put_freed', cta: 'Move it', done: monthly > 0,
          run: () => putFreed(c)
        })
      ]
    };
  },

  fixer: (c) => {
    const onTrack = c.s.planned > 0 && c.s.overBy === 0;
    return {
      id: 'fixer', title: 'Close the gap', short: 'Make the plan add up.', doneMessage: 'The plan adds up.',
      check: () => (onTrack ? { done: true, verified: false, note: 'You are on track. Nothing to close.' } : { done: false }),
      steps: [
        info('gap', c.s.overBy > 0 ? `You are ${money(c.s.overBy)} over` : 'See where you stand', c.s.overBy > 0
          ? 'The fixer shows ways to close it without touching your top 3.'
          : 'The fixer shows where there is room if costs rise.', { lesson: 'Do not go into debt for the wedding.', cta: 'Next' }),
        route('fix', 'Open the fixer', 'Pick a few cuts or a smaller guest list and see the new total before you decide.', '/fixer', { cta: 'Open the fixer', done: onTrack })
      ]
    };
  },

  card: (c) => {
    const card = c.cards[0] || null;
    const mine = c.cards.find((x) => x.rewardSource === 'you');
    return {
      id: 'card', title: 'Pay with a card that pays you back', short: 'A little cash back on vendor payments.', doneMessage: 'Card rewards set.', skippable: true,
      check: () => (mine ? { done: true, verified: false, note: `${mine.name} earns ${mine.rewardPct}% back.` } : null),
      steps: [
        info('why', 'Let the card work for you', 'Put vendor payments on a card that pays cash back, and pay the card off in full every month. For planning, assume 1% to 2% back.', { lesson: 'Do not go into debt for the wedding. Pay the card off each month.', cta: card ? 'Next' : 'Got it' }),
        ...(card ? [step('rate', 'input', `What does ${card.name} pay back?`, 'Look in your card app for the cash back rate. Then Padrino can compare cards for each payment.', {
          field: { name: 'pct', label: 'Cash back, in percent', type: 'percent', value: card.rewardSource === 'you' ? card.rewardPct : undefined, min: 0, max: 20 }, done: Boolean(mine),
          run: (v) => {
            const saved = call('setCardReward', card.id, v);
            if (saved === null || saved === undefined) return { ok: false, message: 'Type a number from 0 to 20, like 2.' };
            return { message: `${card.name} earns ${saved}% back.` };
          }
        })] : [])
      ]
    };
  },

  // ---------------------------------------------------------------- 5. Guests and paper
  invites: teamVendor({
    id: 'invites', ids: ['invitations', 'save-the-dates'], slug: 'invitations', quoteLine: 'invitations', title: 'Order invitations', short: 'Weigh a sample before you print.', doneMessage: 'Invitations ordered.',
    intro: { title: 'Keep it simple', body: 'Fancy invitations are on the low-impact list. Oversized or square ones cost more to mail.', lesson: 'Weigh a sample first so postage is no surprise.' },
    find: { title: 'Look at the printers', body: 'Ask each for a price with envelopes and printing included.', lesson: 'Money goes fastest on things guests forget, like pricey invitations.' },
    quote: { title: 'Get a quote with everything in it', body: 'Include envelopes, extra copies and shipping.', lesson: 'Ask for a fully loaded quote.' }
  }),

  postage: (c) => {
    const row = c.line('postage');
    const set = Boolean(c.value('postage')) || Number(row?.committed) > 0 || Number(row?.paid) > 0;
    return {
      id: 'postage', title: 'Plan the postage', short: 'It adds up after the printing.', doneMessage: 'Postage planned.', skippable: true,
      check: () => (Number(row?.committed) > 0 || Number(row?.paid) > 0 ? { done: true, verified: false, note: 'Postage is paid for.' } : null),
      steps: [
        step('amount', 'input', 'How much for postage?', 'Count the invitations you will mail, then ask the post office what one costs with its weight.', {
          lesson: 'Plan about $1.50 to $3.00 per invitation suite, and weigh a sample first.',
          field: fieldMoney('planned', 'Postage budget', Number(row?.planned) || 0), done: set,
          run: (v) => {
            const n = validMoney(v);
            if (n === null) return { ok: false, message: 'Type an amount like 150.' };
            setLinePlanned(c, 'postage', n);
            setValue('postage', true);
            return { message: `Postage: ${money(n)}.` };
          }
        })
      ]
    };
  },

  links: (c) => {
    const n = c.giveLinks.length;
    return {
      id: 'links', title: 'Make your padrino links', short: 'One simple page for family and guests.', doneMessage: 'Links made.', skippable: true,
      check: () => (n > 0 ? { done: true, verified: false, note: `${n} ${plural(n, 'link', 'links')} made.` } : { done: false }),
      steps: [
        info('bonus', 'Gifts are a bonus', 'Make a padrino link for the people who offered to help, and a guest link if you want one. Plan the day without relying on gifts.', { lesson: 'Cash gifts arrive after the bills are due.', cta: 'Next' }),
        route('make', 'Make a link', 'Pick what it covers and how people can pay you. Then send it.', '/family', { cta: 'Open Family', done: n > 0 })
      ]
    };
  },

  rsvps: (c) => {
    const by = c.value('rsvpBy');
    return {
      id: 'rsvps', title: 'Set your RSVP date', short: 'Know who is really coming.', doneMessage: 'RSVP date set.', skippable: true,
      check: () => (by ? { done: true, verified: false, note: `RSVPs due ${fmtDateShort(by)}.` } : null),
      steps: [
        step('date', 'input', 'When do guests need to answer?', 'Pick a date about a month before the wedding, so you have time to get a final count.', {
          lesson: 'Guest counts creep up. Count only the yeses.',
          field: { name: 'rsvpBy', label: 'RSVP by', type: 'date' }, done: Boolean(by),
          run: (v) => {
            const d = parseDate(v);
            if (!d) return { ok: false, message: 'Pick a date.' };
            setValue('rsvpBy', toISO(d));
            return { message: `RSVPs due ${fmtDateShort(toISO(d))}.` };
          }
        })
      ]
    };
  },

  // ---------------------------------------------------------------- 6. Final stretch
  collect: (c) => {
    const pl = c.pledges;
    const allIn = pl.count > 0 && pl.outstanding <= 0;
    const proved = pl.count > 0 && c.history.filter((h) => h.kind === 'family' && h.bank).length >= pl.people.filter((x) => Number(x.received) > 0).length && pl.people.some((x) => Number(x.received) > 0);
    return {
      id: 'collect', title: 'Collect what was promised', short: 'Before the final payments are due.', doneMessage: 'Everything promised is in.',
      check: () => (allIn
        ? { done: true, verified: proved, note: `${money(pl.received)} received from ${pl.count} ${plural(pl.count, 'person', 'people')}.` }
        : pl.count > 0 ? { done: false } : null),
      steps: [
        route('check', pl.count > 0 ? `${money(pl.outstanding)} is still to come` : 'See who owes what', pl.count > 0 ? 'Send a gentle reminder to anyone who has not sent theirs. Record money as it arrives and your bank confirms it.' : 'Nobody has pledged yet, so there is nothing to collect. You can add people in Family.', '/family', {
          lesson: 'Gifts and promises arrive after the bills are due. Chase them early.', cta: 'Open Family', done: allIn
        })
      ]
    };
  },

  finalpay: (c) => {
    const t = c.timeline;
    const paidAll = t.payments.length > 0 && t.totalUnpaid <= 0;
    const proved = paidAll && t.payments.every((x) => c.history.some((h) => h.ref?.paymentId === x.id && h.bank));
    return {
      id: 'finalpay', title: 'Pay the final balances', short: 'Every balance, on time.', doneMessage: 'Everything is paid.',
      check: () => (paidAll ? { done: true, verified: proved, note: 'Every payment is paid.' } : t.payments.length ? { done: false } : null),
      steps: [
        info('fraud', 'Check before you pay', 'If a vendor emails new bank details near a due date, call them on a number you already had before you send anything.', { lesson: 'Payment fraud likes a due date.', cta: 'Next' }),
        route('pay', t.totalUnpaid > 0 ? `${money(t.totalUnpaid)} left to pay` : 'See your payments', 'Pay each one from your account. Padrino ticks it off when your bank shows it.', '/payments', { cta: 'See my payments', done: paidAll })
      ]
    };
  },

  tips: () => ({
    id: 'tips', title: 'Set aside tips and vendor meals', short: 'Small things that show up at the end.', doneMessage: 'Tips planned.',
    steps: [
      info('tips', 'Tips come last', 'Many contracts say you feed the photographer, DJ and others. Count assistants too. Photographer tips are usually 5% to 15% of the contract.', { lesson: 'Tip money appears at the end and is rarely in the plan.', cta: 'Next' }),
      route('budget', 'Check the lines in your budget', 'Make sure vendor meals and tips each have a number.', '/budget', { cta: 'Open the budget' })
    ]
  }),

  headcount: (c) => {
    const guests = Number(c.p.couple?.guests) || 0;
    return {
      id: 'headcount', title: 'Give your final headcount', short: 'It sets your final bill.', doneMessage: 'Headcount sent.',
      steps: [
        step('final', 'input', 'What is your final number?', 'Use the yeses, not the hopes.', {
          lesson: 'A guaranteed headcount sets the bill. 120 guests at $90 is $10,800 even if 112 come.',
          field: { name: 'guests', label: 'Final guests', type: 'number', value: guests || undefined, min: 1, max: 1500 },
          done: c.seen('headcount', 'final'), run: (v) => setGuestCount(c, v, false)
        }),
        info('send', 'Send it in writing', 'Give the number to your caterer and venue by email, and keep their reply with your other paperwork.', { lesson: 'Get every change in writing.', cta: 'Done' })
      ]
    };
  },

  // ---------------------------------------------------------------- 7. After the wedding
  name: (c) => ({
    id: 'name', title: 'Change your name', short: 'In the right order.', doneMessage: 'Name change done.', skippable: true,
    check: () => (afterAll(c, ['marriage-certificate', 'social-security', 'texas-driver-license']) ? { done: true, verified: false, note: 'Certificate, Social Security and license done.' } : { done: false }),
    steps: [
      afterStep('certificate', 'Order certified copies', 'Almost every office wants a certified copy, not a photocopy. Order several.', 'marriage-certificate', c),
      afterStep('ssa', 'Change it with Social Security', 'Do this before the driver license office.', 'social-security', c),
      afterStep('license', 'Update your Texas driver license', 'Texas DPS says within 30 days of the change. Bring the original license.', 'texas-driver-license', c)
    ]
  }),

  merge: (c) => ({
    id: 'merge', title: 'Merge your money', short: 'Banks, cards and the big talk.', doneMessage: 'Money merged.', skippable: true,
    check: () => (afterAll(c, ['banks-and-cards', 'merge-finances', 'beneficiaries']) ? { done: true, verified: false, note: 'Banks, shared money and beneficiaries done.' } : { done: false }),
    steps: [
      afterStep('banks', 'Tell your banks and cards', 'Names on your accounts should match your ID so checks and transfers work.', 'banks-and-cards', c),
      afterStep('share', 'Decide how to share your money', 'Joint, separate or a mix. Talk it through and write it down.', 'merge-finances', c, { lesson: 'Talk about debt, combined accounts and spending habits out loud.' }),
      afterStep('beneficiaries', 'Update your beneficiaries', 'Do it in the first month.', 'beneficiaries', c)
    ]
  }),

  thanks: (c) => ({
    id: 'thanks', title: 'Say thank you', short: 'Notes, then the decor.', doneMessage: 'Thank yous done.', skippable: true,
    check: () => (afterAll(c, ['thank-you-notes', 'sell-or-donate-decor']) ? { done: true, verified: false, note: 'Notes sent and decor sorted.' } : { done: false }),
    steps: [
      afterStep('notes', 'Send thank-you notes', 'A common custom is within about 3 months, and 2 weeks for gifts that arrive later.', 'thank-you-notes', c),
      afterStep('decor', 'Sell or donate decor and your dress', 'List items within a month while they still look new.', 'sell-or-donate-decor', c)
    ]
  }),

  home: (c) => {
    const pick = c.value('home');
    const monthly = Number(c.p.money?.monthly) || 0;
    return {
      id: 'home', title: 'Your first home', short: 'Keep the habit going.', doneMessage: 'Plan for home set.', skippable: true,
      check: () => (pick ? { done: true, verified: false, note: pick === 'keep' ? 'You are keeping the savings habit going.' : 'You will decide later.' } : null),
      steps: [
        step('keep', 'choice', 'Keep saving after the wedding?', monthly > 0 ? `You have been saving ${money(monthly)} a month. That habit can start your next goal.` : 'The monthly habit you built can start your next goal.', {
          lesson: 'A separate savings account with automatic deposits keeps goals from mixing with daily spending.',
          options: [{ id: 'keep', label: 'Yes, keep it going' }, { id: 'later', label: 'Let us decide later' }],
          done: Boolean(pick), run: (v) => {
            if (!['keep', 'later'].includes(v)) return { ok: false, message: 'Pick one to continue.' };
            setValue('home', v);
            return { message: v === 'keep' ? 'Nice. Keep it going.' : 'Noted.' };
          }
        })
      ]
    };
  }
};

// ------------------------------------------------------------------ wedding styles

const listWords = (list) => (list.length <= 1 ? String(list[0] || '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

// What the style step hands back: an array of ids, { ids, notes } when the couple typed their own words, or one id.
function pickedStyles(v) {
  const raw = Array.isArray(v) ? v : v && typeof v === 'object' ? v.ids : typeof v === 'string' ? v.split(',') : [];
  const notes = v && typeof v === 'object' && !Array.isArray(v) && typeof v.notes === 'string' ? v.notes : undefined;
  const valid = new Set(safe('getTraditionOptions', []).map((o) => o.id));
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map((x) => String(x || '').trim()).map((x) => (x === 'mixed' ? 'own' : x)).filter((x) => valid.has(x)))];
  return { ids, notes };
}

// Routes a milestone from traditions.json may point at. Anything else becomes a plain info step.
const STYLE_ROUTES = ['/vendors', '/budget', '/family', '/payments', '/quotes', '/contract', '/fixer', '/find-money', '/setup', '/after', '/add'];
const VENDOR_SLUGS = ['venues', 'catering', 'photography', 'videography', 'dj-music', 'mariachi', 'florists', 'cakes', 'attire', 'hair-makeup', 'officiants', 'rentals', 'invitations', 'transportation'];

function styleRoute(r) {
  const [base, query] = String(r || '').split('?');
  if (!STYLE_ROUTES.includes(base)) return null;
  if (base !== '/vendors') return base;
  const cat = new URLSearchParams(query || '').get('cat');
  return cat && VENDOR_SLUGS.includes(cat) ? `${base}?cat=${cat}` : base;
}

// One step of a milestone that came from a wedding style. Only what the file gave: no steps are invented here.
function styleStep(c, nodeId, st, i) {
  const sid = `s${i + 1}`;
  const key = `${nodeId}.${sid}`;
  const extra = st.lesson ? { lesson: st.lesson } : {};
  if (st.kind === 'route') {
    const to = styleRoute(st.route);
    if (to) return route(sid, st.title, st.body, to, { cta: st.cta || 'Open', ...extra });
  }
  if (st.kind === 'choice' && Array.isArray(st.options) && st.options.length >= 2) {
    return step(sid, 'choice', st.title, st.body, {
      options: st.options, done: Boolean(c.value(key)), ...extra,
      run: (v) => {
        if (!st.options.some((o) => o.id === v)) return { ok: false, message: 'Pick one to continue.' };
        setValue(key, v);
        return { message: 'Noted.' };
      }
    });
  }
  if (st.kind === 'input') {
    const field = st.field || { name: 'answer', label: 'Your answer', type: 'text' };
    return step(sid, 'input', st.title, st.body, {
      field, done: Boolean(c.value(key)), ...extra,
      run: (v) => {
        const text = String(typeof v === 'object' && v ? Object.values(v)[0] : v ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (!text) return { ok: false, message: 'Type your answer to continue.' };
        setValue(key, text);
        return { message: 'Saved.' };
      }
    });
  }
  return info(sid, st.title, st.body, { cta: st.cta || 'Got it', ...extra });
}

// A milestone from a wedding style becomes a node. Nothing is behind it, so our own record decides when it is done.
function styleNode(m) {
  const id = `trad-${m.tradition}-${m.id}`;
  return (c) => ({
    id, title: m.title, short: m.short || 'Part of your wedding style.', doneMessage: 'Done.', skippable: true, tradition: m.tradition,
    steps: m.steps.slice(0, 3).map((st, i) => styleStep(c, id, st, i))
  });
}

// ------------------------------------------------------------------ step actions shared by several nodes

function setValue(key, value) {
  stampNow();
  local.values[key] = value;
  saveLocal();
}

// Sets what a budget line plans for. A new plan may not have the line yet, so it is added from the template.
function setLinePlanned(c, id, amount) {
  if (c.line(id)) { call('updateLine', id, { planned: amount }); return; }
  const row = template.find((t) => t.id === id);
  call('addLine', { id, category: row?.category || 'Other', item: row?.item || id, planned: amount, forgotten: Boolean(row?.forgotten) });
}

// Changes the guest count through the store, with the lines that move with headcount.
function setGuestCount(c, v, markSet = true) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 1500) return { ok: false, message: 'Type a number of guests, like 120.' };
  const imp = guestImpact(c.p, n, template, c.today);
  call('setGuests', n, imp.scaledLines);
  if (markSet) setValue('guests', true);
  const move = imp.change === 0 ? 'The plan total stays the same.' : `The plan total moves ${imp.change > 0 ? 'up' : 'down'} by ${money(Math.abs(imp.change))}.`;
  return { message: `Guest count is ${n}. ${move}` };
}

function freedPicks(c) {
  const recurring = Array.isArray(c.bank?.recurring) ? c.bank.recurring : [];
  if (!c.connected || !recurring.length) return [];
  const goList = subs.splitSubs(recurring, c.bank.transactions || []).go;
  const done = new Set(c.cancelled.map((x) => x.id));
  const mine = goList.filter((r) => done.has(r.id));
  return mine.length ? mine : goList;
}

function freedPreview(c) {
  const picks = freedPicks(c);
  if (!picks.length) return 'Cancel a subscription first. The money it frees shows up here.';
  return `This moves about ${money(monthlyFreed(picks))} a month into your savings plan. It only changes the number. You still cancel each one yourself.`;
}

function putFreed(c) {
  const picks = freedPicks(c);
  if (!picks.length) return { ok: false, message: 'There is nothing to move yet. Pick what could go in Find money first.' };
  const monthly = monthlyFreed(picks);
  call('putFreedTowardWedding', { monthly, names: picks.map((r) => r.name) });
  return { message: `${money(monthly)} a month now goes toward the wedding.` };
}

// ------------------------------------------------------------------ the sections

const SECTIONS = [
  { id: 'foundation', title: 'Set the foundation', subtitle: 'Your bank, your number and who is helping.', when: 'First weeks', color: 'emerald', photo: 'couple', opens: null, nodes: ['bank', 'number', 'style', 'priorities', 'guests', 'padrinos'] },
  { id: 'big-three', title: 'Lock the big three', subtitle: 'Venue, photographer and caterer come first.', when: '12 to 10 months out', color: 'ocean', photo: 'venue', opens: 12, closes: 10, nodes: ['venue', 'photographer', 'caterer'] },
  { id: 'team', title: 'Build your team', subtitle: 'Music, flowers, attire, hair and makeup, officiant.', when: '10 to 8 months out', color: 'marigold', photo: 'flowers', opens: 10, closes: 8, nodes: ['music', 'florist', 'attire', 'beauty', 'officiant'] },
  { id: 'money', title: 'Find money', subtitle: 'Cut what you do not need and make the plan add up.', when: 'Any time', color: 'rose', photo: 'rings', opens: null, nodes: ['subs', 'freed', 'fixer', 'card'] },
  { id: 'paper', title: 'Guests and paper', subtitle: 'Invitations, links for family and your RSVPs.', when: '6 to 4 months out', color: 'plum', photo: 'family', opens: 6, closes: 4, nodes: ['invites', 'postage', 'links', 'rsvps'] },
  { id: 'final', title: 'Final stretch', subtitle: 'Collect, pay, tip and give your headcount.', when: 'Last 2 months', color: 'teal', photo: 'table', opens: 2, closes: 0, nodes: ['collect', 'finalpay', 'tips', 'headcount'] },
  { id: 'after', title: 'After the wedding', subtitle: 'Paperwork, money and thank yous.', when: 'After the wedding', color: 'slate', photo: 'after', opens: 0, nodes: ['name', 'merge', 'thanks', 'home'] }
];

export const SECTION_IDS = SECTIONS.map((s) => s.id);
export const NODE_IDS = SECTIONS.flatMap((s) => s.nodes);
export const BOOK_MONTHS_BY_LINE = { venue: 'venue-rental', photographer: 'photographer', caterer: 'catering-food', music: 'dj', florist: 'florist', attire: 'wedding-dress', beauty: 'hair-makeup', officiant: 'officiant', invites: 'invitations' };
export { BOOK_MONTHS };

// ------------------------------------------------------------------ timing

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Jun to Aug 2026", or "Dec 2026 to Feb 2027" across a new year. Null when the section has no window.
function windowText(opensOn, closesOn) {
  if (!opensOn || !closesOn) return null;
  const a = parseDate(opensOn); const b = parseDate(closesOn);
  const ya = a.getUTCFullYear(); const yb = b.getUTCFullYear();
  return ya === yb ? `${MON[a.getUTCMonth()]} to ${MON[b.getUTCMonth()]} ${yb}` : `${MON[a.getUTCMonth()]} ${ya} to ${MON[b.getUTCMonth()]} ${yb}`;
}

function lockedNote(opensOn, today, isAfter) {
  if (isAfter) return 'Opens after the wedding';
  const days = Math.round((parseDate(opensOn) - parseDate(today)) / 86400000);
  if (days <= 10) return 'Opens soon';
  const d = parseDate(opensOn);
  const month = MONTHS[d.getUTCMonth()];
  return days > 330 ? `Opens in ${month} ${d.getUTCFullYear()}` : `Opens in ${month}`;
}

// ------------------------------------------------------------------ getPath

function computeSections(c) {
  const wedding = parseDate(c.p.couple?.weddingDate);
  const afterWedding = Boolean(wedding && c.today > toISO(wedding));
  const sections = SECTIONS.map((def) => {
    const isAfter = def.id === 'after';
    const opensOn = wedding && def.opens !== null ? toISO(addMonths(wedding, -def.opens)) : null;
    const closesOn = wedding && def.closes !== undefined ? toISO(addMonths(wedding, -def.closes)) : null;
    const locked = Boolean(opensOn && c.today < opensOn);
    const note = locked ? lockedNote(opensOn, c.today, isAfter) : null;
    // The section's own milestones, then the ones the couple's wedding style adds to it.
    const builders = [
      ...def.nodes.map((nid) => NODE_BUILDERS[nid]),
      ...c.milestones.filter((m) => m.section === def.id).map(styleNode)
    ];
    const nodes = builders.map((build) => {
      const n = build(c);
      const steps = n.steps.map((s) => {
        // A route or action step with a data check is done only when the data says so. Anything else also counts once
        // the couple has been through it (our small record).
        const seenLocal = c.seen(n.id, s.id);
        const dataOnly = (s.kind === 'route' || s.kind === 'action') && typeof s.done === 'boolean';
        return { ...s, done: dataOnly ? s.done : (s.done === true || seenLocal) };
      });
      const skipped = Boolean(c.rec.skipped[n.id]);
      const byHand = Boolean(c.rec.manual[n.id]);
      const reopen = c.rec.reopened[n.id] || null;
      const opened = Boolean(c.rec.jumped[n.id]);
      const data = typeof n.check === 'function' ? n.check() : null;
      let done = false;
      let verified = false;
      let doneNote = null;
      let manual = false;
      if (data && data.done) { done = true; verified = Boolean(data.verified); doneNote = data.note || null; }
      else if (!data && steps.length && steps.every((x) => x.done)) { done = true; doneNote = 'Done.'; } // nothing behind it: our record decides
      const skippedOnly = !done && skipped;
      if (skippedOnly) { done = true; doneNote = 'Skipped. Not needed.'; }
      if (!done && byHand) { done = true; manual = true; doneNote = 'Marked done by you.'; }
      // Something went wrong: the couple reopened it. Real data may still say done (a verified payment), but the
      // couple's word wins until they mark it done again.
      if (reopen) { done = false; verified = false; doneNote = null; manual = false; }
      const held = locked && !opened && !done; // locked, and not opened early by hand
      const bookBy = wedding && n.bookMonths ? toISO(addMonths(wedding, -n.bookMonths)) : null;
      return {
        id: n.id, title: n.title, short: n.short, status: done ? 'done' : held ? 'locked' : 'next', verified: done && verified, doneNote,
        lockedNote: held ? note : null,
        bookNote: n.bookMonths ? `Most couples book this about ${n.bookMonths} months out.` : null, bookBy,
        skippable: Boolean(n.skippable), skipped: skippedOnly, doneMessage: n.doneMessage,
        manual, jumped: Boolean(opened && locked && !done),
        problem: reopen ? { reason: reopen.reason || '', at: reopen.at || null, scope: reopen.scope || 'node' } : null,
        ...(n.tradition ? { tradition: n.tradition } : {}),
        steps
      };
    });
    const doneCount = nodes.filter((n) => n.status === 'done').length;
    return {
      id: def.id, title: def.title, subtitle: def.subtitle, when: def.when, color: def.color, photo: def.photo,
      dates: isAfter ? (wedding ? `From ${MON[wedding.getUTCMonth()]} ${wedding.getUTCFullYear()}` : null) : windowText(opensOn, closesOn),
      opensOn: isAfter ? (wedding ? toISO(wedding) : null) : opensOn, locked, lockedNote: note, done: doneCount, total: nodes.length, nodes, isAfter,
      problem: nodes.find((n) => n.problem && n.problem.scope === 'section')?.problem || null
    };
  });
  return { sections, afterWedding };
}

export function getPath({ today } = {}) {
  syncIdentity();
  const c = buildCtx(today || todayISO());
  const { sections, afterWedding } = computeSections(c);
  const all = sections.flatMap((s) => s.nodes);
  const pool = afterWedding ? sections.filter((s) => s.isAfter).flatMap((s) => s.nodes) : all;
  const cur = pool.find((n) => n.status === 'next');
  if (cur) cur.status = 'current';
  const done = all.filter((n) => n.status === 'done').length;
  for (const s of sections) delete s.isAfter;
  return {
    progress: { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 },
    current: cur ? cur.id : null,
    sections
  };
}

export function getNode(nodeId, { today } = {}) {
  const path = getPath({ today });
  for (const section of path.sections) {
    const node = section.nodes.find((n) => n.id === nodeId);
    if (node) return { section, node };
  }
  return null;
}

// ------------------------------------------------------------------ completing steps

function stepRunner(nodeId, stepId, today) {
  const c = buildCtx(today || todayISO());
  const { sections } = computeSections(c);
  for (const s of sections) {
    const node = s.nodes.find((n) => n.id === nodeId);
    if (node) return { c, section: s, node, step: node.steps.find((x) => x.id === stepId) || null };
  }
  return { c, section: null, node: null, step: null };
}

// detail is one more plain sentence a step may add (for example what the wedding style just added to the plan).
function celebrate(nodeId, lead, today, detail = '') {
  const found = getNode(nodeId, { today });
  if (!found) return { nodeDone: false, message: [lead || 'Saved.', detail].filter(Boolean).join(' ') };
  const { section, node } = found;
  if (node.status === 'done') {
    const tail = section.done >= section.total ? `That finishes ${section.title}.` : `${section.done} of ${section.total} done in this section.`;
    return { nodeDone: true, message: [node.doneMessage || 'Done.', detail, tail].filter(Boolean).join(' ') };
  }
  const left = node.steps.filter((s) => !s.done).length;
  const first = [lead || 'Saved.', detail].filter(Boolean).join(' ');
  if (node.problem && left === 0) return { nodeDone: false, message: `${first} This one is still open because something went wrong. Mark it done from the path when it is sorted out.` };
  if (left > 0) return { nodeDone: false, message: `${first} ${left} more ${plural(left, 'step', 'steps')} in this one.` };
  return { nodeDone: false, message: `${first} This one ticks itself off when it shows up in your plan.` };
}

// opts.today is for tests and previews; the app leaves it out.
export function completeStep(nodeId, stepId, value, { today } = {}) {
  if (!store.getPlan()) return { nodeDone: false, message: 'Set up your wedding first.' };
  const found = stepRunner(nodeId, stepId, today);
  if (!found.node) return { nodeDone: false, message: 'I could not find that one.' };
  if (!found.step) return { nodeDone: false, message: 'I could not find that step.' };
  if (found.node.status === 'locked') return { nodeDone: false, message: found.node.lockedNote ? `${found.node.lockedNote}.` : 'That one is not open yet.' };
  stampNow();
  const st = found.step;
  let r = {};
  try {
    if (st[RUN]) r = st[RUN](value, found.c) || {};
  } catch (e) {
    console.error(e);
    return { nodeDone: false, message: e && e.message ? e.message : 'That did not work. Try again.' };
  }
  if (r.ok === false) return { nodeDone: false, message: r.message || 'Check that and try again.' };
  const mark = () => {
    local.steps[`${nodeId}.${stepId}`] = true;
    // Finishing the last step of a reopened node is the couple saying it is done again.
    if (local.reopened[nodeId]) {
      const again = getNode(nodeId, { today });
      const last = again?.node.steps[again.node.steps.length - 1];
      if (last && last.id === stepId && again.node.steps.every((x) => x.done || x.id === stepId)) delete local.reopened[nodeId];
    }
    saveLocal();
  };
  if (r.pending) {
    const pending = Promise.resolve(r.pending).then(() => { mark(); return celebrate(nodeId, 'Your bank is connected.', today); })
      .catch((e) => ({ nodeDone: false, message: e && e.message ? e.message : 'Could not connect the bank. Try again.' }));
    return { nodeDone: false, message: r.message || 'Working on it...', pending };
  }
  mark();
  return celebrate(nodeId, r.message, today, r.detail);
}

// "Not for us": the node counts as done and the path moves on. Only nodes marked skippable.
export function skipNode(nodeId, { today } = {}) {
  if (!store.getPlan()) return { nodeDone: false, message: 'Set up your wedding first.' };
  const found = getNode(nodeId, { today });
  if (!found) return { nodeDone: false, message: 'I could not find that one.' };
  if (!found.node.skippable) return { nodeDone: false, message: 'This one is worth doing.' };
  stampNow();
  local.skipped[nodeId] = true;
  delete local.reopened[nodeId];
  delete local.manual[nodeId];
  saveLocal();
  const after = getNode(nodeId, { today });
  const sec = after?.section;
  return { nodeDone: true, message: sec ? `Skipped. ${sec.done} of ${sec.total} done in this section.` : 'Skipped.' };
}

// Takes a skip back.
export function unskipNode(nodeId) {
  if (!local.skipped[nodeId]) return;
  delete local.skipped[nodeId];
  saveLocal();
}

// ------------------------------------------------------------------ the couple's control of the path

const NO_PLAN = 'Set up your wedding first.';
const NOT_FOUND = 'I could not find that one.';

// Opens a milestone that is locked or ahead, so the couple can work on it now. Nothing else moves: the current node
// stays the same, and the node reads "next" (jumped: true) instead of "locked". Opening one that is already open
// changes nothing. Returns { ok, nodeId, wasLocked, message }.
export function jumpTo(nodeId, { today } = {}) {
  if (!store.getPlan()) return { ok: false, nodeId, wasLocked: false, message: NO_PLAN };
  const found = getNode(nodeId, { today });
  if (!found) return { ok: false, nodeId, wasLocked: false, message: NOT_FOUND };
  const wasLocked = found.node.status === 'locked';
  if (wasLocked) {
    stampNow();
    local.jumped[nodeId] = true;
    saveLocal();
  }
  return { ok: true, nodeId, wasLocked, message: wasLocked ? `${found.node.title} is open early.` : `${found.node.title} is open.` };
}

// Done by hand, for something the couple did that Padrino cannot see. The node reads done with manual: true (unless
// the data says it is done too), and a problem on it is cleared. Same answer as completeStep:
// { nodeDone, message }.
export function markDone(nodeId, { today } = {}) {
  if (!store.getPlan()) return { nodeDone: false, message: NO_PLAN };
  if (!getNode(nodeId, { today })) return { nodeDone: false, message: NOT_FOUND };
  stampNow();
  delete local.reopened[nodeId];
  delete local.skipped[nodeId];
  local.manual[nodeId] = { at: new Date().toISOString() };
  saveLocal();
  return celebrate(nodeId, 'Marked done.', today);
}

function reopenOne(node, reason, scope) {
  local.reopened[node.id] = { reason, at: new Date().toISOString(), scope };
  delete local.manual[node.id];
  delete local.skipped[node.id];
  for (const k of Object.keys(local.steps)) if (k.startsWith(`${node.id}.`)) delete local.steps[k]; // the steps can be done again
}

const cleanReason = (v) => String(v ?? '').replace(/[\u2013\u2014]/g, '-').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);

// Something went wrong (a vendor fell through, plans changed): the milestone is open again. node.problem is
// { reason, at, scope: 'node' } and the status goes back to current or next, even when real data (a verified
// payment) still says done. It stays open until markDone, or until the couple finishes its last step again.
// The steps already done are cleared from our record only; nothing in the plan is deleted.
// Returns { ok, nodeId, message }.
export function reopenNode(nodeId, reason = '', { today } = {}) {
  if (!store.getPlan()) return { ok: false, nodeId, message: NO_PLAN };
  const found = getNode(nodeId, { today });
  if (!found) return { ok: false, nodeId, message: NOT_FOUND };
  stampNow();
  reopenOne(found.node, cleanReason(reason), 'node');
  saveLocal();
  return { ok: true, nodeId, message: `${found.node.title} is open again.` };
}

// The same for a whole section: every milestone in it that was done opens again, with scope 'section' (and
// section.problem set). Returns { ok, sectionId, reopened: [nodeIds], message }.
export function reopenSection(sectionId, reason = '', { today } = {}) {
  if (!store.getPlan()) return { ok: false, sectionId, reopened: [], message: NO_PLAN };
  const sec = getPath({ today }).sections.find((x) => x.id === sectionId);
  if (!sec) return { ok: false, sectionId, reopened: [], message: NOT_FOUND };
  const done = sec.nodes.filter((n) => n.status === 'done');
  if (!done.length) return { ok: false, sectionId, reopened: [], message: `Nothing in ${sec.title} is done yet, so there is nothing to open again.` };
  stampNow();
  const text = cleanReason(reason);
  for (const n of done) reopenOne(n, text, 'section');
  saveLocal();
  return { ok: true, sectionId, reopened: done.map((n) => n.id), message: `${sec.title} is open again.` };
}
