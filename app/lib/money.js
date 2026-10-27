// Padrino money math. Pure functions, ES module, no DOM, no Node imports.
// The AI only reads documents. Every total the couple sees comes from this file.
//
// Money is in dollars. Results meant for the screen are rounded to cents (Math.round).
// Dates are "YYYY-MM-DD" strings. "today" can be a string or a Date and defaults to the real today.
//
// Return shapes (the screens code against these):
//
// computeQuote(decoded, { guests, taxRate }) =>
//   { lines: [{ label, kind, amount, estimated, added, note?, lesson?, rate? }],
//     headline, contractTotal, estimatedExtras, trueTotal, added, addedPct (percent, 1 decimal),
//     perGuest, headlinePerGuest, notes: [string], unpriced: [label] }
//   added=false lines are the quote's own items. added=true lines are charges and missing costs.
//   estimated=true marks anything the quote did not state (assumed tax, vendor meals, overtime).
//
// budgetSummary(plan, template?, { today }) =>
//   { planned, committed, paid, cushion, cushionPct, needed, available, gap, overBy, onTrack, perGuest,
//     monthsLeft, savedByWedding, pledged, pledgesReceived, pledgesOutstanding, guests, daysToWedding,
//     forgottenOpen }
//   planned = sum over lines of max(planned, committed, paid), cushion line excluded.
//   cushion = planned x settings.cushionPct. needed = planned + cushion.
//   available = saved + monthly x monthsLeft + pledges received + pledges outstanding. Cash gifts never count.
//   overBy = max(0, needed - available).
//
// guestImpact(plan, guests, { template, today }) =>
//   { guests, currentGuests, total, currentTotal, change, perGuest, currentPerGuest, cushion, needed,
//     overBy, available, summary, scaledLines: [{ id, item, from, to, committed }], hasCommitted }
//
// suggestCuts(plan, cuts, overBy) =>
//   { overBy, cuts: [{ ...cut, matched, saveLow, saveHigh, basis, protected, reason, lastResort }],
//     protectedLines: [{ lineId, item, amount }], coversLow, coversHigh, needMore,
//     guestsToCut, guestsToCutPossible, newGuests, perGuestSaved }
//
// paymentTimeline(plan, today) =>
//   { today, payments: [{ ...payment, daysUntil, overdue, dueSoon, runningTotal }], totalScheduled, totalPaid,
//     totalUnpaid, nextDue, overdue: [payment], overdueTotal, dueNext30: [payment], dueNext30Total }
//
// pledgeSummary(plan) => { pledged, received, outstanding, count, people: [...], withStrings: [...] }
//
// scheduleFromQuote(computed, decoded, weddingDate, { today, signingDate }) =>
//   { payments: [{ label, amount, dueDate|null, status:"due", paidOn:null, source:"quote", rule, pct, needsDate }],
//     base, scheduled, unscheduled, paidBeforeEventPct, warnings: [string] }

// ------------------------------------------------------------------ small helpers

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const toCents = (x) => Math.round(num(x) * 100);
const fromCents = (c) => c / 100;
export const round2 = (x) => Math.round(num(x) * 100) / 100;
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function formatMoney(n, { cents = false } = {}) {
  const v = num(n);
  const abs = Math.abs(v);
  const s = abs.toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  return (v < 0 ? "-$" : "$") + s;
}

// ------------------------------------------------------------------ dates (UTC, so time zones never shift a day)

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

export function parseDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : utc(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = utc(Number(m[1]), Number(m[2]), Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
export const toISO = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
export function addMonths(d, n) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}
export const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);
const todayOf = (t) => parseDate(t ?? new Date()) ?? parseDate(new Date());

// Whole months from one date to a later one. Any left over days do not count.
export function fullMonthsBetween(from, to) {
  let m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

// ------------------------------------------------------------------ reference tables

// Priority ids (from setup) to the budget lines they protect. Keep in step with scripts/build-data.mjs.
export const PRIORITY_LINES = {
  venue: ["venue-rental"],
  food: ["catering-food"],
  drinks: ["bar-alcohol"],
  photo: ["photographer", "second-photographer", "albums-prints"],
  video: ["videographer"],
  music: ["dj", "live-band", "ceremony-music", "mariachi-short", "mariachi-full", "sound-equipment"],
  dress: ["wedding-dress", "alterations", "accessories", "dress-preservation"],
  flowers: ["florist"],
  decor: ["lighting-decor"],
  "hair-makeup": ["hair-makeup", "hair-makeup-trial"],
  rings: ["wedding-bands", "engagement-ring"],
  honeymoon: ["honeymoon", "passport"],
  "guests-comfort": ["catering-food", "bar-alcohol", "event-rentals", "guest-shuttle"],
  invitations: ["invitations", "save-the-dates", "postage"],
};

// Lines that move with the headcount. A line can override with scalesWithGuests true or false.
export const GUEST_SCALED_IDS = [
  "catering-food",
  "bar-alcohol",
  "cake",
  "event-rentals",
  "service-charge",
  "sales-tax",
  "gratuity-catering",
  "cake-cutting",
  "extra-guests",
  "favors",
];

const DEFAULT_SETTINGS = { taxRate: 0.0825, cushionPct: 0.1 };

// ------------------------------------------------------------------ plan helpers

// What a line really costs: a committed quote or a payment beats a lower plan.
export function lineCost(line) {
  return Math.max(num(line?.planned), num(line?.committed), num(line?.paid));
}
const planLines = (plan) => (plan?.lines || []).filter((l) => l && l.id !== "cushion");
const settingsOf = (plan) => ({ ...DEFAULT_SETTINGS, ...(plan?.settings || {}) });

export function cushionAmount(plan) {
  return round2(sum(planLines(plan).map(lineCost)) * settingsOf(plan).cushionPct);
}

function indexById(rows) {
  const idx = {};
  for (const r of rows || []) if (r && r.id) idx[r.id] = r;
  return idx;
}

function scalesWithGuests(line, tIndex) {
  if (typeof line.scalesWithGuests === "boolean") return line.scalesWithGuests;
  if (line.unit === "per_guest") return true;
  const t = tIndex[line.id];
  if (t && typeof t.scalesWithGuests === "boolean") return t.scalesWithGuests;
  return GUEST_SCALED_IDS.includes(line.id);
}

// Ids of lines the fixer leaves alone: lines flagged protected, plus every line behind a top priority.
export function protectedLineIds(plan) {
  const ids = new Set();
  for (const l of plan?.lines || []) if (l.protected) ids.add(l.id);
  for (const p of plan?.priorities?.top || []) for (const id of PRIORITY_LINES[p] || []) ids.add(id);
  return ids;
}

// ------------------------------------------------------------------ pledges

export function pledgeSummary(plan) {
  const people = (plan?.pledges || []).map((p) => {
    const amount = round2(p.amount);
    const received = round2(p.received);
    return {
      id: p.id,
      name: p.name,
      relation: p.relation,
      lineId: p.lineId ?? null,
      item: p.item ?? null,
      amount,
      received,
      outstanding: round2(Math.max(0, amount - received)),
      strings: p.strings || "",
      hasStrings: Boolean(p.strings && String(p.strings).trim()),
    };
  });
  return {
    pledged: round2(sum(people.map((p) => p.amount))),
    received: round2(sum(people.map((p) => p.received))),
    outstanding: round2(sum(people.map((p) => p.outstanding))),
    count: people.length,
    people,
    withStrings: people.filter((p) => p.hasStrings),
  };
}

// ------------------------------------------------------------------ budget summary

export function budgetSummary(plan, template = [], opts = {}) {
  const lines = planLines(plan);
  const settings = settingsOf(plan);
  const guests = num(plan?.couple?.guests);
  const today = todayOf(opts.today);

  const planned = round2(sum(lines.map(lineCost)));
  const committed = round2(sum(lines.map((l) => Math.max(num(l.committed), num(l.paid)))));
  const paid = round2(sum(lines.map((l) => num(l.paid))));
  const cushion = round2(planned * settings.cushionPct);
  const needed = round2(planned + cushion);

  // Months of saving left: from the later of today and the first saving month, to the wedding.
  const wedding = parseDate(plan?.couple?.weddingDate);
  let monthsLeft = 0;
  let daysToWedding = null;
  if (wedding) {
    daysToWedding = daysBetween(today, wedding);
    const startMonth = String(plan?.money?.startMonth || "").match(/^(\d{4})-(\d{2})$/);
    let start = today;
    if (startMonth) {
      const first = utc(Number(startMonth[1]), Number(startMonth[2]), 1);
      if (first.getTime() > today.getTime()) start = first;
    }
    monthsLeft = fullMonthsBetween(start, wedding);
  }
  const saved = num(plan?.money?.saved);
  const monthly = num(plan?.money?.monthly);
  const savedByWedding = round2(saved + monthly * monthsLeft);

  const pledges = pledgeSummary(plan);
  const available = round2(savedByWedding + pledges.received + pledges.outstanding);
  const gap = round2(available - needed);
  const overBy = gap < 0 ? round2(-gap) : 0;

  const tIndex = indexById(template);
  const forgottenOpen = lines.filter((l) => (l.forgotten ?? tIndex[l.id]?.forgotten) && lineCost(l) === 0).map((l) => l.id);

  return {
    planned,
    committed,
    paid,
    cushion,
    cushionPct: settings.cushionPct,
    needed,
    available,
    gap,
    overBy,
    onTrack: overBy === 0,
    perGuest: guests > 0 ? round2(planned / guests) : 0,
    monthsLeft,
    savedByWedding,
    pledged: pledges.pledged,
    pledgesReceived: pledges.received,
    pledgesOutstanding: pledges.outstanding,
    guests,
    daysToWedding,
    forgottenOpen,
  };
}

// ------------------------------------------------------------------ guests are money

export function guestImpact(plan, guests, opts = {}) {
  const current = num(plan?.couple?.guests);
  const next = Math.max(0, Math.round(num(guests)));
  const ratio = current > 0 ? next / current : 1;
  const tIndex = indexById(opts.template);
  const scaledLines = [];
  const lines = (plan?.lines || []).map((l) => {
    if (l.id === "cushion" || !scalesWithGuests(l, tIndex)) return l;
    const from = lineCost(l);
    if (from === 0) return l;
    const scaled = { ...l, planned: round2(num(l.planned) * ratio), committed: round2(num(l.committed) * ratio) };
    scaledLines.push({ id: l.id, item: l.item, from, to: lineCost(scaled), committed: num(l.committed) > 0 });
    return scaled;
  });
  const nextPlan = { ...plan, couple: { ...(plan?.couple || {}), guests: next }, lines };
  const sumOpts = { today: opts.today };
  const before = budgetSummary(plan, opts.template, sumOpts);
  const after = budgetSummary(nextPlan, opts.template, sumOpts);
  return {
    guests: next,
    currentGuests: current,
    total: after.planned,
    currentTotal: before.planned,
    change: round2(after.planned - before.planned),
    perGuest: after.perGuest,
    currentPerGuest: before.perGuest,
    cushion: after.cushion,
    needed: after.needed,
    overBy: after.overBy,
    available: after.available,
    summary: after,
    scaledLines,
    hasCommitted: scaledLines.some((s) => s.committed),
  };
}

// ------------------------------------------------------------------ over-budget fixer

const REGRET_ORDER = { low: 0, medium: 1, high: 2 };

export function suggestCuts(plan, cuts, overBy, opts = {}) {
  const lines = planLines(plan);
  const byId = indexById(lines);
  const protectedIds = protectedLineIds(plan);
  const factor = 1 + settingsOf(plan).cushionPct; // a cut also shrinks the cushion, which is a share of the plan
  const gap = round2(Math.max(0, num(overBy)));

  const candidates = [];
  for (const cut of cuts || []) {
    const matched = (cut.lineIds || [])
      .map((id) => byId[id])
      .filter(Boolean)
      .map((l) => ({
        lineId: l.id,
        item: l.item,
        amount: round2(Math.max(0, lineCost(l) - num(l.paid))), // money already paid cannot be saved
        committed: num(l.committed) > 0,
      }))
      .filter((m) => m.amount > 0);
    if (!matched.length) continue;
    const lineTotal = sum(matched.map((m) => m.amount));
    let saveLow = null;
    let saveHigh = null;
    let basis = "unknown";
    if (isNum(cut.saveLow) || isNum(cut.saveHigh)) {
      saveLow = round2(clamp(isNum(cut.saveLow) ? cut.saveLow : cut.saveHigh, 0, lineTotal));
      saveHigh = round2(clamp(isNum(cut.saveHigh) ? cut.saveHigh : cut.saveLow, 0, lineTotal));
      basis = "range";
    } else if (cut.wholeLine) {
      saveLow = saveHigh = round2(lineTotal);
      basis = "whole_line";
    }
    const isProtected = matched.some((m) => protectedIds.has(m.lineId));
    candidates.push({
      ...cut,
      matched,
      lineTotal: round2(lineTotal),
      saveLow,
      saveHigh,
      basis,
      protected: isProtected,
      reason: isProtected ? "priority" : cut.regret === "high" ? "high_regret" : null,
      lastResort: false,
    });
  }

  const rank = (a, b) =>
    (REGRET_ORDER[a.regret] ?? 1) - (REGRET_ORDER[b.regret] ?? 1) ||
    (b.saveHigh ?? -1) - (a.saveHigh ?? -1) ||
    b.lineTotal - a.lineTotal ||
    String(a.id).localeCompare(String(b.id));

  const safe = candidates.filter((c) => !c.protected && c.regret !== "high").sort(rank);
  const risky = candidates.filter((c) => c.protected || c.regret === "high").sort(rank);

  const coversLow = round2(sum(safe.map((c) => c.saveLow ?? 0)) * factor);
  const coversHigh = round2(sum(safe.map((c) => c.saveHigh ?? 0)) * factor);
  const needMore = gap > 0 && gap > coversHigh;

  const cutsOut = needMore ? [...safe, ...risky.map((c) => ({ ...c, lastResort: true }))] : safe;

  const protectedLines = lines
    .filter((l) => protectedIds.has(l.id) && lineCost(l) > 0)
    .map((l) => ({ lineId: l.id, item: l.item, amount: round2(lineCost(l)) }));

  // Guests to cut: the plan dollars that move with headcount, per guest, plus the cushion that rides on them.
  const tIndex = indexById(opts.template);
  const guests = num(plan?.couple?.guests);
  const moving = sum(lines.filter((l) => scalesWithGuests(l, tIndex)).map(lineCost));
  const perGuestSaved = guests > 0 ? (moving / guests) * factor : 0;
  let guestsToCut = null;
  let guestsToCutPossible = false;
  if (gap === 0) {
    guestsToCut = 0;
    guestsToCutPossible = true;
  } else if (perGuestSaved > 0) {
    guestsToCut = Math.ceil(gap / perGuestSaved);
    guestsToCutPossible = guestsToCut < guests;
  }

  return {
    overBy: gap,
    cuts: cutsOut,
    protectedLines,
    coversLow,
    coversHigh,
    needMore,
    guestsToCut,
    guestsToCutPossible,
    newGuests: guestsToCut === null ? null : Math.max(0, guests - guestsToCut),
    perGuestSaved: round2(perGuestSaved),
  };
}

// ------------------------------------------------------------------ payments

export function paymentTimeline(plan, today) {
  const t = todayOf(today);
  const t30 = addDays(t, 30);
  const list = (plan?.payments || []).map((p) => ({ ...p, amount: round2(p.amount) }));
  list.sort((a, b) => {
    const da = parseDate(a.dueDate);
    const db = parseDate(b.dueDate);
    if (da && db) return da - db || String(a.id).localeCompare(String(b.id));
    if (da) return -1;
    if (db) return 1;
    return 0;
  });
  let running = 0;
  const payments = list.map((p) => {
    const due = parseDate(p.dueDate);
    const unpaid = p.status !== "paid";
    running = round2(running + p.amount);
    return {
      ...p,
      daysUntil: due ? daysBetween(t, due) : null,
      overdue: Boolean(due && unpaid && due.getTime() < t.getTime()),
      dueSoon: Boolean(due && unpaid && due.getTime() >= t.getTime() && due.getTime() <= t30.getTime()),
      runningTotal: running,
    };
  });
  const open = payments.filter((p) => p.status !== "paid");
  const overdue = open.filter((p) => p.overdue);
  const dueNext30 = open.filter((p) => p.dueSoon);
  const nextDue = open.find((p) => p.dueDate && !p.overdue) || null;
  return {
    today: toISO(t),
    payments,
    totalScheduled: round2(sum(payments.map((p) => p.amount))),
    totalPaid: round2(sum(payments.filter((p) => p.status === "paid").map((p) => p.amount))),
    totalUnpaid: round2(sum(open.map((p) => p.amount))),
    nextDue,
    overdue,
    overdueTotal: round2(sum(overdue.map((p) => p.amount))),
    dueNext30,
    dueNext30Total: round2(sum(dueNext30.map((p) => p.amount))),
  };
}

// ------------------------------------------------------------------ quote decoding math

function describeEstimate(est, guests) {
  if (!est) return null;
  if (isNum(est.perVendor) && isNum(est.count)) return `${formatMoney(est.perVendor)} x ${est.count} vendors`;
  if (isNum(est.perHour) && isNum(est.hours)) return `${formatMoney(est.perHour)} x ${est.hours} ${est.hours === 1 ? "hour" : "hours"}`;
  if (isNum(est.perGuest)) return `${formatMoney(est.perGuest)} x ${guests} guests`;
  if (isNum(est.perUnit) && isNum(est.count)) return `${formatMoney(est.perUnit)} x ${est.count}`;
  if (isNum(est.rate)) return `${Math.round(est.rate * 1000) / 10}% of the bill`;
  return null;
}

export function computeQuote(decoded, { guests = 0, taxRate = DEFAULT_SETTINGS.taxRate } = {}) {
  const items = decoded?.items || [];
  const charges = decoded?.charges || [];
  const missing = decoded?.missing || [];
  const g = num(guests);
  const lines = [];
  const notes = [];
  const unpriced = [];

  // 1. The quote's own items.
  let headC = 0; // headline, in cents
  let fbC = 0; // food and beverage items
  let taxableC = 0; // items tax applies to
  for (const it of items) {
    let amount = null;
    let note;
    if (isNum(it.amount)) amount = it.amount;
    else if (isNum(it.perGuest) && g > 0) {
      amount = it.perGuest * g;
      note = `${formatMoney(it.perGuest)} x ${g} guests`;
    }
    const kind = it.kind || "base";
    let c = amount === null ? null : toCents(amount);
    if (c !== null && kind === "discount") c = -Math.abs(c);
    if (c === null) unpriced.push(it.label);
    else {
      headC += c;
      if (it.foodBev) fbC += c;
      if (it.taxable !== false) taxableC += c;
    }
    const line = { label: it.label, kind, amount: c === null ? null : fromCents(c), estimated: false, added: false };
    if (note) line.note = note;
    lines.push(line);
  }

  // 2. Charges that sit on top: service charge, fees, gratuity. Tax comes after, because it is charged on the service charge too.
  let serviceC = 0;
  let chargesC = 0;
  for (const ch of charges.filter((c) => c.kind !== "tax")) {
    let c = null;
    let note;
    if (isNum(ch.rate)) {
      const base = ch.basis === "food_bev" ? fbC : ch.basis === "taxable" ? taxableC : headC;
      c = Math.round(base * ch.rate);
      const pct = Math.round(ch.rate * 10000) / 100;
      note = ch.basis === "food_bev" ? `${pct}% of the food and drink` : `${pct}% of the items`;
    } else if (isNum(ch.amount)) c = toCents(ch.amount);
    else unpriced.push(ch.label);
    if (c !== null) {
      chargesC += c;
      if (ch.kind === "service") serviceC += c;
    }
    const line = { label: ch.label, kind: ch.kind || "fee", amount: c === null ? null : fromCents(c), estimated: false, added: true };
    if (isNum(ch.rate)) line.rate = ch.rate;
    if (note) line.note = note;
    lines.push(line);
  }

  // 3. Tax. Applies to the taxable items plus the service charge (a stated assumption, shown in the note).
  let taxC = 0;
  const taxCharges = charges.filter((c) => c.kind === "tax");
  const taxLine = (label, rate, stated, basisC) => {
    const c = Math.round(basisC * rate);
    taxC += c;
    const pct = Math.round(rate * 10000) / 100;
    const onWhat = `the items${serviceC ? " plus the service charge" : ""}`;
    let note;
    if (rate === 0) note = "No tax added. The quote says tax is included or does not apply.";
    else if (stated) note = `${pct}% tax on ${onWhat}.`;
    else note = `Not on the quote. Added at ${pct}% on ${onWhat}.`;
    lines.push({ label, kind: "tax", amount: fromCents(c), estimated: !stated, added: true, rate, note });
  };
  for (const ch of taxCharges) {
    const stated = ch.stated !== false;
    const basisC = (ch.basis === "food_bev" ? fbC : taxableC) + serviceC;
    if (stated && isNum(ch.rate)) taxLine(ch.label || "Sales tax", ch.rate, true, basisC);
    else if (stated && isNum(ch.amount)) {
      taxC += toCents(ch.amount);
      lines.push({ label: ch.label || "Sales tax", kind: "tax", amount: round2(ch.amount), estimated: false, added: true });
    } else if (isNum(taxRate) && taxRate > 0) taxLine(ch.label || "Sales tax", taxRate, false, basisC);
  }
  if (!taxCharges.length && isNum(taxRate) && taxRate > 0 && headC > 0) {
    taxLine("Sales tax", taxRate, false, taxableC + serviceC);
  }
  if (taxC > 0) notes.push("Tax is figured on the taxable items plus the service charge. Ask the vendor if that matches their invoice.");

  // 4. Costs the quote leaves out, added as estimates.
  let extrasC = 0;
  for (const m of missing) {
    const e = m.estimate || {};
    let c = null;
    if (isNum(e.amount)) c = toCents(e.amount);
    else if (isNum(e.perGuest)) c = g > 0 ? toCents(e.perGuest * g) : null;
    else if (isNum(e.perVendor) && isNum(e.count)) c = toCents(e.perVendor * e.count);
    else if (isNum(e.perHour) && isNum(e.hours)) c = toCents(e.perHour * e.hours);
    else if (isNum(e.perUnit) && isNum(e.count)) c = toCents(e.perUnit * e.count);
    else if (isNum(e.rate)) c = Math.round((e.basis === "food_bev" ? fbC : headC) * e.rate);
    else if (isNum(e.low) && isNum(e.high)) c = toCents((e.low + e.high) / 2);
    if (c === null) unpriced.push(m.label);
    else extrasC += c;
    const line = { label: m.label, kind: m.kind || "missing", amount: c === null ? null : fromCents(c), estimated: true, added: true };
    const how = describeEstimate(e, g);
    line.note = [how, m.why].filter(Boolean).join(". ") || undefined;
    if (!line.note) delete line.note;
    if (m.lesson) line.lesson = m.lesson;
    lines.push(line);
  }
  if (extrasC > 0) notes.push("Lines marked as estimates are not on the quote. Ask the vendor for the real number.");

  const contractC = headC + chargesC + taxC;
  const trueC = contractC + extrasC;
  const addedC = trueC - headC;
  return {
    lines,
    headline: fromCents(headC),
    contractTotal: fromCents(contractC),
    estimatedExtras: fromCents(extrasC),
    trueTotal: fromCents(trueC),
    added: fromCents(addedC),
    addedPct: headC > 0 ? Math.round((addedC / headC) * 1000) / 10 : 0,
    perGuest: g > 0 ? round2(fromCents(trueC) / g) : null,
    headlinePerGuest: g > 0 ? round2(fromCents(headC) / g) : null,
    notes,
    unpriced,
  };
}

// ------------------------------------------------------------------ payment schedule from a quote

const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};

function findDate(t) {
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return utc(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return utc(Number(m[3]), Number(m[1]), Number(m[2]));
  m = t.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m && MONTHS[m[1]]) return utc(Number(m[3]), MONTHS[m[1]], Number(m[2]));
  return null;
}

// Turns "50% at signing", "30 days before", "$500 retainer at booking" into a small structure.
function parseRule(rule) {
  const t = String(rule || "").toLowerCase();
  const pctM = t.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/);
  const amtM = t.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  const date = findDate(t);
  const before = t.match(/(\d+(?:\.\d+)?)\s*(day|week|month)s?\s*(?:before|prior|ahead|out)/);
  const after = t.match(/(\d+(?:\.\d+)?)\s*(day|week|month)s?\s*(?:after|following|from)\s*(?:sign|book|contract|deposit)/);
  let when = null;
  if (date) when = { type: "date", date };
  else if (before) when = { type: "before", n: Math.round(Number(before[1])), unit: before[2] };
  else if (after) when = { type: "after", n: Math.round(Number(after[1])), unit: after[2] };
  else if (/\b(day of|day-of|wedding day|event day|date of (?:the )?event|(?:at|on) the (?:event|wedding))\b/.test(t)) when = { type: "before", n: 0, unit: "day" };
  else if (/week of/.test(t)) when = { type: "before", n: 7, unit: "day" };
  else if (/sign|book|upon|accept|reserv|retainer|deposit|contract/.test(t)) when = { type: "signing" };
  return {
    pct: pctM ? Number(pctM[1]) : null,
    fixed: amtM ? Number(amtM[1].replace(/,/g, "")) : null,
    when,
  };
}

function resolveDate(when, wedding, signing) {
  if (!when) return null;
  if (when.type === "date") return when.date;
  if (when.type === "signing") return signing;
  const move = (d, sign) =>
    when.unit === "day" ? addDays(d, sign * when.n) : when.unit === "week" ? addDays(d, sign * 7 * when.n) : addMonths(d, sign * when.n);
  if (when.type === "before") return wedding ? move(wedding, -1) : null;
  if (when.type === "after") return move(signing, 1);
  return null;
}

export function scheduleFromQuote(computed, decoded, weddingDate, opts = {}) {
  const wedding = parseDate(weddingDate);
  const signing = parseDate(opts.signingDate ?? opts.today ?? new Date()) ?? todayOf();
  const baseC = toCents(computed?.contractTotal ?? computed?.trueTotal ?? 0);
  const warnings = [];

  const entries = (decoded?.schedule || []).map((s) => ({ label: s.label || "Payment", rule: s.rule || "", ...parseRule(s.rule) }));
  // Fixed shares first (percent or dollar amount), then whatever is left goes to the entries that name no amount.
  let usedC = 0;
  for (const e of entries) {
    if (e.pct !== null) e.cents = Math.round((baseC * e.pct) / 100);
    else if (e.fixed !== null) e.cents = toCents(e.fixed);
    else e.cents = null;
    if (e.cents !== null) usedC += e.cents;
  }
  const rest = entries.filter((e) => e.cents === null);
  const leftC = Math.max(0, baseC - usedC);
  rest.forEach((e, i) => {
    const share = Math.floor(leftC / rest.length);
    e.cents = i === rest.length - 1 ? leftC - share * (rest.length - 1) : share;
  });
  // If the fixed shares add up to the whole bill, make the last one exact.
  if (!rest.length && entries.length && usedC !== baseC && Math.abs(usedC - baseC) <= entries.length) {
    entries[entries.length - 1].cents += baseC - usedC;
    usedC = baseC;
  }

  const payments = entries.map((e) => {
    const d = resolveDate(e.when, wedding, signing);
    if (!d) warnings.push(`Could not tell when "${e.label}" is due. Pick a date.`);
    return {
      label: e.label,
      amount: fromCents(e.cents),
      dueDate: d ? toISO(d) : null,
      status: "due",
      paidOn: null,
      source: "quote",
      rule: e.rule,
      pct: e.pct !== null ? e.pct : baseC > 0 ? Math.round((e.cents / baseC) * 1000) / 10 : null,
      needsDate: !d,
    };
  });
  payments.sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });

  const scheduledC = sum(payments.map((p) => toCents(p.amount)));
  if (payments.length && scheduledC < baseC) warnings.push("The schedule does not cover the whole bill. The rest is due at the event or is not on the quote.");
  if (scheduledC > baseC) warnings.push("The schedule adds up to more than the bill. Check the percentages with the vendor.");
  const beforeEventC = sum(payments.filter((p) => p.dueDate && wedding && p.dueDate < toISO(wedding)).map((p) => toCents(p.amount)));
  return {
    payments,
    base: fromCents(baseC),
    scheduled: fromCents(scheduledC),
    unscheduled: fromCents(Math.max(0, baseC - scheduledC)),
    paidBeforeEventPct: baseC > 0 ? Math.round((beforeEventC / baseC) * 1000) / 10 : 0,
    warnings,
  };
}

// ------------------------------------------------------------------ starting a plan

// Turn template rows into plan lines. Rows with inBudget false (cushion duplicate, padrino income) are skipped.
export function linesFromTemplate(template, { starterOnly = false } = {}) {
  return (template || [])
    .filter((r) => r.inBudget !== false && (!starterOnly || r.starter))
    .map((r) => ({
      id: r.id,
      category: r.category,
      item: r.item,
      planned: 0,
      committed: 0,
      paid: 0,
      vendor: null,
      protected: false,
      forgotten: Boolean(r.forgotten),
      quoteId: null,
    }));
}

// A first plan from the couple's own money. Group shares from the research sit on one lead row per group
// (venue-rental covers venue and rentals, catering-food covers food, dessert and bar, and so on).
// The cushion is held back first, then the shares split what is left. Amounts round to whole dollars.
export function startingPlanLines(template, { budget, cushionPct = DEFAULT_SETTINGS.cushionPct } = {}) {
  const spendable = Math.max(0, num(budget)) / (1 + cushionPct);
  const rows = (template || []).filter((r) => r.inBudget !== false && r.id !== "cushion" && isNum(r.sharePct));
  const totalShare = sum(rows.map((r) => r.sharePct));
  const shareOf = Object.fromEntries(rows.map((r) => [r.id, r.sharePct]));
  const lines = linesFromTemplate(template).map((l) => ({
    ...l,
    planned: totalShare > 0 && shareOf[l.id] ? Math.round((spendable * shareOf[l.id]) / totalShare) : 0,
  }));
  // Rounding each line to whole dollars can leave the total a dollar or two over the budget.
  // Take the difference off the biggest line so a fresh plan is never "over" by rounding alone.
  const drift = sum(lines.map((l) => l.planned)) - Math.floor(spendable);
  if (drift > 0 && lines.length) {
    const biggest = lines.reduce((a, b) => (b.planned > a.planned ? b : a));
    biggest.planned = Math.max(0, biggest.planned - drift);
  }
  return lines;
}
