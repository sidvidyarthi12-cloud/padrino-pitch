// Thin bridge over /lib/money.js. Every number a screen shows comes through here.
// It calls the math module, passes today as a "YYYY-MM-DD" string, and gives screens
// steady field names. It does not add, subtract or multiply money itself.

import * as money from '../lib/money.js';
import { todayISO } from './format.js';

export function summary(plan, template = [], today = todayISO()) {
  const s = money.budgetSummary(plan, template, { today }) || {};
  return {
    planned: s.planned ?? 0,
    committed: s.committed ?? 0,
    paid: s.paid ?? 0,
    cushion: s.cushion ?? 0,
    cushionPct: s.cushionPct ?? 0,
    needed: s.needed ?? 0,
    available: s.available ?? 0,
    gap: s.gap ?? 0,
    overBy: s.overBy ?? 0,
    onTrack: s.onTrack ?? !(Number(s.overBy) > 0),
    perGuest: s.perGuest ?? 0,
    monthsLeft: s.monthsLeft ?? 0,
    savedByWedding: s.savedByWedding ?? 0,
    pledged: s.pledged ?? 0,
    pledgesReceived: s.pledgesReceived ?? 0,
    pledgesOutstanding: s.pledgesOutstanding ?? 0,
    daysToWedding: s.daysToWedding ?? null,
    forgottenOpen: Array.isArray(s.forgottenOpen) ? s.forgottenOpen : [],
    raw: s
  };
}

// What happens to the total and the per-guest cost at a different headcount.
export function guestImpact(plan, guests, template = [], today = todayISO()) {
  const r = money.guestImpact(plan, guests, { template, today }) || {};
  return {
    guests: r.guests ?? guests,
    total: r.total ?? 0,
    currentTotal: r.currentTotal ?? 0,
    change: r.change ?? 0,
    perGuest: r.perGuest ?? 0,
    cushion: r.cushion ?? 0,
    needed: r.needed ?? 0,
    overBy: r.overBy ?? 0,
    available: r.available ?? 0,
    scaledLines: Array.isArray(r.scaledLines) ? r.scaledLines : [],
    hasCommitted: Boolean(r.hasCommitted),
    raw: r
  };
}

export function computeQuote(decoded, opts) {
  const c = money.computeQuote(decoded, opts) || {};
  return {
    lines: Array.isArray(c.lines) ? c.lines : [],
    headline: c.headline ?? 0,
    contractTotal: c.contractTotal ?? c.trueTotal ?? 0,
    estimatedExtras: c.estimatedExtras ?? 0,
    trueTotal: c.trueTotal ?? 0,
    added: c.added ?? 0,
    addedPct: c.addedPct ?? 0,
    perGuest: c.perGuest ?? null,
    headlinePerGuest: c.headlinePerGuest ?? null,
    notes: Array.isArray(c.notes) ? c.notes : [],
    unpriced: Array.isArray(c.unpriced) ? c.unpriced : [],
    raw: c
  };
}

export function suggestCuts(plan, cuts, overBy, template = []) {
  const r = money.suggestCuts(plan, cuts, overBy, { template }) || {};
  return {
    overBy: r.overBy ?? 0,
    cuts: Array.isArray(r.cuts) ? r.cuts : [],
    protectedLines: Array.isArray(r.protectedLines) ? r.protectedLines : [],
    coversLow: r.coversLow ?? 0,
    coversHigh: r.coversHigh ?? 0,
    needMore: Boolean(r.needMore),
    guestsToCut: r.guestsToCut ?? null,
    guestsToCutPossible: Boolean(r.guestsToCutPossible),
    newGuests: r.newGuests ?? null,
    perGuestSaved: r.perGuestSaved ?? 0,
    raw: r
  };
}

export function paymentTimeline(plan, today = todayISO()) {
  const r = money.paymentTimeline(plan, today) || {};
  return {
    payments: Array.isArray(r.payments) ? r.payments : [],
    nextDue: r.nextDue ?? null,
    overdue: Array.isArray(r.overdue) ? r.overdue : [],
    overdueTotal: r.overdueTotal ?? 0,
    next30: Array.isArray(r.dueNext30) ? r.dueNext30 : [],
    next30Total: r.dueNext30Total ?? 0,
    totalScheduled: r.totalScheduled ?? 0,
    totalPaid: r.totalPaid ?? 0,
    totalUnpaid: r.totalUnpaid ?? 0,
    raw: r
  };
}

export function pledgeSummary(plan) {
  const r = money.pledgeSummary(plan) || {};
  return {
    pledged: r.pledged ?? 0,
    received: r.received ?? 0,
    outstanding: r.outstanding ?? 0,
    count: r.count ?? 0,
    people: Array.isArray(r.people) ? r.people : [],
    withStrings: Array.isArray(r.withStrings) ? r.withStrings : [],
    raw: r
  };
}

export function scheduleFromQuote(computed, decoded, weddingDate, today = todayISO()) {
  const r = money.scheduleFromQuote(computed, decoded, weddingDate, { today }) || {};
  return {
    payments: Array.isArray(r.payments) ? r.payments : [],
    base: r.base ?? 0,
    scheduled: r.scheduled ?? 0,
    unscheduled: r.unscheduled ?? 0,
    paidBeforeEventPct: r.paidBeforeEventPct ?? 0,
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
    raw: r
  };
}

// A first budget split from the couple's own money, so a new plan starts on track.
export function startingLines(template, budget, cushionPct) {
  return money.startingPlanLines(template, { budget, cushionPct });
}

export const PRIORITY_LINES = money.PRIORITY_LINES || {};
