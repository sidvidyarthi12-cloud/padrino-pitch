// What a contract costs you if things change. Pure functions, no DOM, no network.
// The AI only reads the contract (POST /api/contract). The dollars below come from this file.
//
// cancellationPlan(analysis, { weddingDate, today, payments, total }) =>
//   { total, deposit, weddingDate, today, paidAssumed,
//     rows:  [{ index, window, label, from, to, until, date, daysBefore, keep, paid, owe, lose, refund, keepKnown, isToday, text, note }],
//            window and label are the contract's words ("90 to 179 days before"). from, to and until are dates: the
//            window starts on from (null: at signing) and ends on to (until is the same date). date is the day this row
//            speaks about: today for the window you are in, else the day the window starts.
//            keep is what the vendor keeps. paid is what you will have paid by date. owe = keep - paid (more to pay),
//            lose = the part of keep you already paid, refund = what comes back if you paid more than keep.
//     current: row | null,            the row that applies if you cancel today
//     nextStep: { date, daysAway, from, to, increase, text } | null,   when backing out gets more expensive
//     worst: { date, keep, owe, lose, text } | null,
//     headcount: { dueDate, daysLeft, minimum, minimumUnit, text } | null,
//     summary: one plain sentence about today,
//     warnings: [string] }
//
// analysis.cancellation rows look like { until, fromDays, toDays, keepPct, owe, loseDeposit, note }:
//   fromDays and toDays are days before the wedding (fromDays is where the window starts, null means at signing).
//   keepPct is the percent of the total the vendor keeps, owe is a flat dollar amount the vendor keeps,
//   loseDeposit says the deposit is not refunded. The vendor keeps the largest of the ones given.
//
// payments (optional) is what the plan really has for this vendor: [{ amount, dueDate, status, paidOn }].
// Paid ones count as paid. Unpaid ones count once their due date has passed on the date asked about.
// Without payments, the contract's own schedule is used and paidAssumed is true.

import { scheduleFromQuote, parseDate, toISO, addDays, daysBetween, formatMoney } from "./money.js";

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const cents = (n) => Math.round(n * 100) / 100;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function niceDate(iso) {
  const d = parseDate(iso);
  return d ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : "";
}

const usd = (n) => formatMoney(n, { cents: !Number.isInteger(cents(n)) });

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What the vendor keeps in one window, or null when the contract gives no amount.
export function keepFor(tier, { total = null, deposit = null } = {}) {
  const parts = [];
  if (isNum(tier.keepPct) && isNum(total)) parts.push((total * tier.keepPct) / 100);
  if (isNum(tier.owe)) parts.push(tier.owe);
  if (tier.loseDeposit && isNum(deposit)) parts.push(deposit);
  if (!parts.length) {
    // "Nothing is kept" is an answer. A window with no numbers at all is not.
    if (isNum(tier.keepPct) && tier.keepPct === 0) return 0;
    return null;
  }
  return cents(Math.max(...parts));
}

// Windows in order, earliest first. start is days before the wedding where the window begins (Infinity: at signing).
function orderTiers(list) {
  const tiers = (Array.isArray(list) ? list : []).map((t, i) => ({
    index: i,
    until: String(t?.until || ""),
    fromDays: isNum(t?.fromDays) ? t.fromDays : null,
    toDays: isNum(t?.toDays) ? t.toDays : null,
    keepPct: isNum(t?.keepPct) ? t.keepPct : null,
    owe: isNum(t?.owe) ? t.owe : null,
    loseDeposit: t?.loseDeposit === true,
    note: t?.note || null,
  }));
  const dated = tiers.filter((t) => t.fromDays !== null || t.toDays !== null || tiers.length === 1);
  const undated = tiers.filter((t) => !dated.includes(t));
  for (const t of dated) t.start = t.fromDays === null ? Infinity : t.fromDays;
  dated.sort((a, b) => (b.start === a.start ? (b.toDays ?? 0) - (a.toDays ?? 0) : b.start - a.start));
  return { dated, undated };
}

function paymentsFor(analysis, { payments, weddingDate, today, total, deposit }) {
  if (Array.isArray(payments)) {
    return {
      assumed: false,
      list: payments
        .filter((p) => p && isNum(Number(p.amount)))
        .map((p) => ({ amount: Number(p.amount), dueDate: p.dueDate || null, status: p.status === "paid" ? "paid" : "due" })),
    };
  }
  const rules = Array.isArray(analysis?.schedule) ? analysis.schedule : [];
  if (rules.length && isNum(total) && total > 0) {
    const s = scheduleFromQuote({ contractTotal: total }, { schedule: rules }, weddingDate, { today, signingDate: today });
    return { assumed: true, list: s.payments.map((p) => ({ amount: p.amount, dueDate: p.dueDate, status: "due" })) };
  }
  if (isNum(deposit) && deposit > 0) return { assumed: true, list: [{ amount: deposit, dueDate: today, status: "due" }] };
  return { assumed: true, list: [] };
}

const paidBy = (list, iso) =>
  cents(list.reduce((sum, p) => (p.status === "paid" || !p.dueDate || p.dueDate <= iso ? sum + p.amount : sum), 0));

function rowText(row, { wedding }) {
  let when;
  if (!wedding) when = row.window ? `(${row.window})` : "at that point";
  else if (row.isToday) when = "today";
  else if (row.to && row.to !== wedding) when = `between ${niceDate(row.date)} and ${niceDate(row.to)}`;
  else when = `from ${niceDate(row.date)} on`;
  const lead = `If you cancel ${when}`;
  if (!row.keepKnown) return `${lead}, the contract does not say how much. Ask them to put it in writing.`;
  if (row.keep === 0) {
    return row.paid > 0 ? `${lead}, you owe nothing and get back the ${usd(row.paid)} you paid.` : `${lead}, you owe nothing and lose nothing.`;
  }
  const lose = row.lose > 0 ? `lose the ${usd(row.lose)} you already paid` : "lose nothing you have paid yet";
  const refund = row.refund > 0 ? ` You get back ${usd(row.refund)}.` : "";
  if (row.owe > 0) return `${lead}, you owe ${usd(row.owe)} more and ${lose}.`;
  return `${lead}, you owe nothing more and ${lose}.${refund}`;
}

export function cancellationPlan(analysis, opts = {}) {
  const a = analysis && typeof analysis === "object" ? analysis : {};
  const wedding = parseDate(opts.weddingDate);
  const todayD = parseDate(opts.today ?? new Date()) || parseDate(new Date());
  const today = toISO(todayD);
  const total = isNum(opts.total) && opts.total > 0 ? opts.total : isNum(a.total) && a.total > 0 ? a.total : null;
  let deposit = isNum(a.deposit) && a.deposit > 0 ? a.deposit : null;
  const warnings = [];

  const pay = paymentsFor(a, { payments: opts.payments, weddingDate: opts.weddingDate, today, total, deposit });
  if (deposit === null && pay.list.length) deposit = [...pay.list].sort((x, y) => String(x.dueDate || "").localeCompare(String(y.dueDate || "")))[0].amount;

  const { dated, undated } = orderTiers(a.cancellation);
  if (!dated.length) warnings.push("The contract does not say what happens if you cancel. Ask before you sign.");
  if (undated.length) warnings.push("Some cancellation rules have no timing. Ask when each one starts.");
  if (!total && dated.some((t) => t.keepPct !== null)) warnings.push("Add the contract total to see the dollar amounts.");

  const rows = [];
  dated.forEach((t, k) => {
    const next = dated[k + 1];
    const startDate = wedding && t.start !== Infinity ? addDays(wedding, -t.start) : null;
    const endDate = next && wedding && next.start !== Infinity ? addDays(wedding, -next.start - 1) : wedding;
    if (wedding && endDate && toISO(endDate) < today) return; // that window is behind you
    const rowDate = wedding ? (startDate && toISO(startDate) > today ? toISO(startDate) : today) : null;
    const keep = keepFor(t, { total, deposit });
    const keepKnown = keep !== null;
    const paid = paidBy(pay.list, rowDate || today);
    const row = {
      index: t.index,
      window: t.until, // the time window in the contract's own words
      label: t.until,
      from: startDate ? toISO(startDate) : null,
      to: endDate ? toISO(endDate) : null,
      until: endDate ? toISO(endDate) : null, // same as to

      date: rowDate,
      daysBefore: t.start === Infinity ? null : t.start,
      keep: keepKnown ? keep : null,
      keepKnown,
      paid,
      owe: keepKnown ? cents(Math.max(0, keep - paid)) : null,
      lose: keepKnown ? cents(Math.min(paid, keep)) : null,
      refund: keepKnown ? cents(Math.max(0, paid - keep)) : null,
      isToday: rowDate === today,
      note: t.note,
    };
    row.text = rowText(row, { wedding: wedding ? toISO(wedding) : null });
    rows.push(row);
  });

  const current = rows.find((r) => r.isToday) || null;

  let nextStep = null;
  if (current && current.keepKnown) {
    const later = rows.find((r) => r.date > today && r.keepKnown && r.keep > current.keep);
    if (later) {
      const daysAway = daysBetween(todayD, parseDate(later.date));
      const increase = cents(later.keep - current.keep);
      nextStep = {
        date: later.date,
        daysAway,
        from: current.keep,
        to: later.keep,
        increase,
        text: `On ${niceDate(later.date)} (in ${plural(daysAway, "day")}) backing out costs ${usd(increase)} more. The vendor would keep ${usd(later.keep)}.`,
      };
    }
  }

  const known = rows.filter((r) => r.keepKnown);
  let worst = null;
  if (known.length) {
    const top = known.reduce((best, r) => (r.keep > best.keep ? r : best), known[0]);
    const from = top.date && !top.isToday ? `from ${niceDate(top.date)}` : "at the worst point";
    const split =
      top.keep === 0
        ? "You would owe nothing."
        : top.owe > 0
          ? `You will have paid ${usd(top.paid)} by then, so you would lose ${usd(top.lose)} and owe ${usd(top.owe)} more.`
          : `You will have paid ${usd(top.paid)} by then, so you would lose ${usd(top.lose)} and owe nothing more.`;
    worst = {
      date: top.date,
      keep: top.keep,
      owe: top.owe,
      lose: top.lose,
      text: top.keep === 0 ? "Worst case: the contract lets you cancel without paying anything." : `Worst case: ${from}, the vendor keeps ${usd(top.keep)}. ${split}`,
    };
  }

  let headcount = null;
  const h = a.headcount && typeof a.headcount === "object" ? a.headcount : null;
  if (h && (isNum(h.guaranteeDays) || h.guaranteeDue || isNum(h.minimum))) {
    const dueDate = wedding && isNum(h.guaranteeDays) ? toISO(addDays(wedding, -h.guaranteeDays)) : null;
    const daysLeft = dueDate ? daysBetween(todayD, parseDate(dueDate)) : null;
    const bits = [];
    if (dueDate) bits.push(`Your final guest count is due ${niceDate(dueDate)}${daysLeft >= 0 ? ` (in ${plural(daysLeft, "day")})` : ", and that date has passed"}.`);
    else if (h.guaranteeDue) bits.push(`Your final guest count is due ${String(h.guaranteeDue).replace(/\.$/, "")}.`);
    if (isNum(h.minimum)) bits.push(h.minimumUnit === "dollars" ? `The contract has a minimum spend of ${usd(h.minimum)}.` : `The contract has a minimum of ${h.minimum} guests.`);
    headcount = { dueDate, daysLeft, minimum: isNum(h.minimum) ? h.minimum : null, minimumUnit: h.minimumUnit || null, text: bits.join(" ") };
  }

  let summary = "";
  if (current) summary = current.text;
  else if (rows.length && !wedding) summary = "Add your wedding date to see what each date costs.";
  else if (!dated.length) summary = "The contract does not say what happens if you cancel.";

  return { total, deposit, weddingDate: wedding ? toISO(wedding) : null, today, paidAssumed: pay.assumed, rows, current, nextStep, worst, headcount, summary, warnings };
}

// The rows alone, for screens that only draw the timeline: same arguments as cancellationPlan.
export const cancellationRows = (analysis, opts) => cancellationPlan(analysis, opts).rows;
