// Pure helpers for bank data in the browser. No DOM, no network.
// Plaid amounts: positive means money out, negative means money in.
//
// Two kinds of functions live here:
//  - matchers and detectors that only read (matchPayments, matchFamilyMoney, findBankMatch, detectUnplanned)
//  - plan editors that change a plan object in place (logPayment, logFamilyMoney, logExpense, verifyAgainstBank, ...).
//    The store calls them on a copy of the plan and saves the copy, so the browser never sees half a change.
// Tests import this file directly.

const dayMs = 24 * 60 * 60 * 1000;
const cents = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");

export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Whole days from b to a for "YYYY-MM-DD" strings (positive when a is later).
function dayDiff(a, b) {
  return (Date.parse(String(a).slice(0, 10)) - Date.parse(String(b).slice(0, 10))) / dayMs;
}

// ------------------------------------------------------------------ names

// Words that say nothing about who was paid. Without these, "SAMPLE" or "ZELLE" would match everything.
const STOP = new Set([
  "and", "the", "for", "from", "with", "inc", "llc", "ltd", "corp", "company", "sample", "demo",
  "payment", "payments", "pay", "online", "transfer", "zelle", "venmo", "cash", "app", "pos", "purchase",
  "debit", "card", "checkcard", "ach", "ppd", "web", "www", "com", "paso", "texas", "deposit", "retainer",
  "balance", "final", "fee", "fees", "services", "service",
]);

// How we call family. These alone are a weak match, so "Tio Javier" is matched on "javier" first.
const TITLES = new Set([
  "tio", "tia", "madrina", "padrino", "mom", "dad", "mama", "papa", "abuela", "abuelo", "uncle", "aunt",
  "grandma", "grandpa", "mother", "father", "parents", "sister", "brother", "hermano", "hermana", "cousin",
  "primo", "prima", "friend", "senor", "senora", "dona", "don", "mrs", "mister", "family", "familia",
]);

export function nameWords(s) {
  const text = String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
  return [...new Set(text.split(" ").filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)))];
}

// "photographer" and "photography" are the same name to us: equal words, or the same first five letters.
function sameWord(a, b) {
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 5 && a.slice(0, 5) === b.slice(0, 5);
}

function shareWord(aWords, bWords) {
  return aWords.some((a) => bWords.some((b) => sameWord(a, b)));
}

export function namesMatch(a, b) {
  return shareWord(nameWords(a), nameWords(b));
}

// Words that identify a person in a pledge. Titles only count when nothing else is left.
function personWords(name) {
  const all = nameWords(name);
  const strong = all.filter((w) => !TITLES.has(w));
  return strong.length ? strong : all;
}

const closeAmount = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);

// ------------------------------------------------------------------ scheduled payments

// A payment counts as paid when a money-out transaction matches its amount within 1%
// (or $1), lands between 45 days before and 10 days after the due date (people often pay
// early), and, when the payment names a vendor, shares a word with the merchant name.
//
// With { allowDifferent: true } a second pass also matches a transaction whose merchant shares a word
// with the vendor even though the amount is not the plan's (between a fifth and five times the plan).
// Those come back with different: true. Rows:
//   { paymentId, transactionId, paidOn, amount, merchant, planned, different, difference }
// opts.used is a list of transaction ids that are already spoken for.
const inWindow = (p, t) => {
  if (!p.dueDate) return true;
  const early = dayDiff(p.dueDate, t.date);
  return !(early > 45 || early < -10);
};

function matchRow(p, t) {
  const different = !closeAmount(t.amount, p.amount);
  return {
    paymentId: p.id,
    transactionId: t.id,
    paidOn: t.date,
    amount: t.amount,
    merchant: t.name,
    planned: p.amount,
    different,
    difference: cents(t.amount - p.amount),
  };
}

export function matchPayments(payments, transactions, vendorsByLine = {}, opts = {}) {
  const used = new Set(opts.used || []);
  const matches = [];
  const settled = new Set();
  const open = payments.filter((p) => p.status !== "paid");

  for (const p of open) {
    const vendorWords = nameWords(vendorsByLine[p.lineId]);
    const hit = transactions.find((t) => {
      if (used.has(t.id) || t.amount <= 0) return false;
      if (!closeAmount(t.amount, p.amount)) return false;
      if (!inWindow(p, t)) return false;
      return vendorWords.length === 0 || shareWord(vendorWords, nameWords(t.name));
    });
    if (hit) {
      used.add(hit.id);
      settled.add(p.id);
      matches.push(matchRow(p, hit));
    }
  }
  if (!opts.allowDifferent) return matches;

  const pairs = [];
  for (const p of open) {
    if (settled.has(p.id) || !(p.amount > 0)) continue;
    const vendorWords = nameWords(vendorsByLine[p.lineId]);
    if (!vendorWords.length) continue; // no name to go on, so only an exact amount counts
    for (const t of transactions) {
      if (used.has(t.id) || t.amount <= 0) continue;
      const ratio = t.amount / p.amount;
      if (ratio < 0.2 || ratio > 5) continue;
      if (!inWindow(p, t)) continue;
      if (!shareWord(vendorWords, nameWords(t.name))) continue;
      pairs.push({ p, t, rel: Math.abs(t.amount - p.amount) / p.amount });
    }
  }
  pairs.sort((a, b) => a.rel - b.rel);
  const paymentDone = new Set();
  for (const { p, t } of pairs) {
    if (used.has(t.id) || paymentDone.has(p.id)) continue;
    used.add(t.id);
    paymentDone.add(p.id);
    matches.push(matchRow(p, t));
  }
  return matches;
}

// ------------------------------------------------------------------ family money

// Money in whose sender shares a name word with a pledge's person. The amount can be anything.
// Rows: { pledgeId, transactionId, date, amount (positive), merchant }
export function matchFamilyMoney(pledges, transactions, opts = {}) {
  const used = new Set(opts.used || []);
  const today = opts.today || localToday();
  const sinceDays = opts.sinceDays ?? 120;
  const people = pledges.map((f) => ({ f, words: personWords(f.name) })).filter((x) => x.words.length);
  const out = [];
  const byDate = [...transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const t of byDate) {
    if (used.has(t.id) || !(t.amount < 0)) continue;
    if (dayDiff(today, t.date) > sinceDays) continue;
    const tw = nameWords(t.name);
    let best = null;
    for (const x of people) {
      const score = x.words.filter((w) => tw.some((v) => sameWord(w, v))).length;
      if (score && (!best || score > best.score)) best = { x, score };
    }
    if (best) {
      used.add(t.id);
      out.push({ pledgeId: best.x.f.id, transactionId: t.id, date: t.date, amount: cents(-t.amount), merchant: t.name });
    }
  }
  return out;
}

// ------------------------------------------------------------------ one thing you said happened

// Looks for the transaction behind something the couple said: { direction: 'out'|'in', amount, date, names }.
// Best first: the amount and a name both match; then the amount matches near the date (a name is not needed);
// then only a name matches, which means the bank shows a different amount.
// Returns { tx, status: 'verified'|'different' } or null. opts.used is a Set of ids already taken.
export function findBankMatch({ direction, amount, date, names = [] }, transactions, { used = new Set() } = {}) {
  const nameList = names.flatMap((n) => nameWords(n));
  const want = (t) => (direction === "in" ? t.amount < 0 : t.amount > 0);
  const said = Math.abs(Number(amount) || 0);
  let best = null;
  for (const t of transactions) {
    if (used.has(t.id) || !want(t)) continue;
    const amt = Math.abs(t.amount);
    const gap = date ? dayDiff(t.date, date) : 0; // positive: the bank is later than the date you gave
    if (gap < -7 || gap > 30) continue;
    const exact = said > 0 && closeAmount(amt, said);
    const nameHit = nameList.length > 0 && shareWord(nameList, nameWords(t.name));
    let score = null;
    let status = "verified";
    if (exact && nameHit) score = 0;
    else if (exact && nameList.length === 0) score = 1;
    else if (exact && Math.abs(gap) <= 4) score = 2;
    else if (nameHit && said > 0 && amt / said >= 0.2 && amt / said <= 5) {
      score = 3 + Math.abs(amt - said) / said;
      status = "different";
    }
    if (score === null) continue;
    const rank = score + Math.abs(gap) / 1000;
    if (!best || rank < best.rank) best = { tx: t, status, rank };
  }
  return best ? { tx: best.tx, status: best.status } : null;
}

// ------------------------------------------------------------------ spending nobody planned

// Words that say a charge is wedding spending. Whole words only (plural forms are listed).
const WEDDING_WORDS = new Set([
  "bridal", "bride", "brides", "wedding", "weddings", "nuptial", "davids", "gown", "tux", "tuxedo", "formalwear",
  "party", "balloon", "balloons", "decor", "decorations", "florist", "floral", "flower", "flowers", "bouquet",
  "rental", "rentals", "linens", "tent", "photo", "photos", "photography", "photographer", "videography",
  "bakery", "cake", "cakes", "cupcake", "cupcakes", "jewelry", "jewelers", "jeweler", "jewellers", "zales",
  "jared", "tiffany", "catering", "caterer", "banquet", "venue", "chapel", "officiant", "invitations",
  "invitation", "stationery", "minted", "vistaprint", "zola", "shutterfly", "favors", "limo", "limousine",
  "mariachi", "azazie", "michaels", "hobby",
]);
// A rental car or a movie rental is not a wedding rental.
const NOT_WEDDING = new Set(["car", "auto", "truck", "vehicle", "uhaul", "movie", "movies", "apartment", "redbox"]);

// Returns the word that made this charge look like wedding spending, or null.
export function weddingWord(t) {
  const tokens = String(`${t.name || ""} ${t.category || ""}`)
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.some((w) => NOT_WEDDING.has(w))) return null;
  return tokens.find((w) => WEDDING_WORDS.has(w)) || null;
}

// Which budget line a charge most likely belongs to. Only returns ids in lineIds (the lines the plan has).
const LINE_GUESSES = [
  [["bridal", "bride", "brides", "davids", "gown", "azazie"], ["wedding-dress", "accessories", "party-attire"]],
  [["tux", "tuxedo", "formalwear"], ["grooms-attire", "party-attire"]],
  [["party", "balloon", "balloons", "decor", "decorations", "michaels", "hobby"], ["lighting-decor", "favors", "pre-wedding-parties"]],
  [["florist", "floral", "flower", "flowers", "bouquet"], ["florist"]],
  [["rental", "rentals", "linens", "tent"], ["event-rentals", "weather-items"]],
  [["shutterfly"], ["albums-prints", "photographer"]],
  [["photo", "photos", "photography", "photographer"], ["photographer", "albums-prints"]],
  [["videography"], ["videographer"]],
  [["bakery", "cake", "cakes", "cupcake", "cupcakes"], ["cake"]],
  [["jewelry", "jewelers", "jeweler", "jewellers", "zales", "jared", "tiffany"], ["wedding-bands", "accessories"]],
  [["catering", "caterer"], ["catering-food"]],
  [["banquet", "venue", "chapel"], ["venue-rental"]],
  [["officiant"], ["officiant"]],
  [["invitations", "invitation", "stationery", "minted", "vistaprint", "zola"], ["invitations", "save-the-dates"]],
  [["favors"], ["favors"]],
  [["limo", "limousine"], ["transportation"]],
  [["mariachi"], ["mariachi-short", "mariachi-full"]],
];

export function guessLineId(t, lineIds = []) {
  const have = new Set(lineIds);
  const tokens = String(t.name || "").toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  for (const [words, ids] of LINE_GUESSES) {
    if (!tokens.some((w) => words.includes(w))) continue;
    const id = ids.find((x) => have.has(x));
    if (id) return id;
  }
  return null;
}

const signature = (t) => `${t.date}|${String(t.name || "").toLowerCase()}|${Math.abs(t.amount)}`;

// Money-out charges from wedding-ish merchants that no plan payment explains.
// opts: { usedIds, dismissed (ids or signatures), lineIds, today, sinceDays = 30, minAmount = 20 }
// Rows: { transactionId, date, merchant, amount, guessLineId }, newest first.
export function detectUnplanned(transactions, opts = {}) {
  const used = new Set(opts.usedIds || []);
  const dismissed = new Set(opts.dismissed || []);
  const today = opts.today || localToday();
  const sinceDays = opts.sinceDays ?? 30;
  const minAmount = opts.minAmount ?? 20;
  const out = [];
  for (const t of transactions) {
    if (!(t.amount >= minAmount)) continue;
    if (used.has(t.id) || dismissed.has(t.id) || dismissed.has(signature(t))) continue;
    if (dayDiff(today, t.date) > sinceDays) continue;
    if (!weddingWord(t)) continue;
    out.push({ transactionId: t.id, date: t.date, merchant: t.name, amount: cents(t.amount), guessLineId: guessLineId(t, opts.lineIds || []) });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// ------------------------------------------------------------------ plain words for history

export const usd = (n) => {
  const v = Math.round(Math.abs(Number(n) || 0) * 100) / 100;
  const text = Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${Number(n) < 0 ? "-" : ""}$${text}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : "";
}

// "Photographer retainer" -> "photographer retainer". Names like "SAMPLE HALL" or "Tio Javier" stay as they are.
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+ [A-Z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

// "Venue rental / site fee" -> "Venue rental" (lineName gives it in lower case for the middle of a sentence)
function lineShort(line) {
  return String(line?.item || "").split(/\s+[\/-]\s+|\s*\(/)[0].trim();
}
function lineName(line) {
  return lineShort(line).toLowerCase() || "budget";
}

const THAN = { plan: "than planned", you: "than you wrote down", pledge: "than pledged" };

// The toast text for one history entry that was just checked by the bank.
export function verificationMessage(h) {
  const diff = h.expected != null ? cents(h.amount - h.expected) : 0;
  const more = diff > 0 ? "more" : "less";
  const than = THAN[h.expectedFrom] || THAN.plan;
  if (h.kind === "subscription") {
    return h.status === "different" ? `${h.title}: the bank shows another charge. Check that it is cancelled.` : `Verified by your bank: ${lowerFirst(h.title)}. No new charges.`;
  }
  if (h.kind === "family" || h.kind === "income") {
    const base = `Verified by your bank: ${h.who || h.title} sent ${usd(h.amount)}`;
    return h.status === "different" ? `${base}, ${usd(Math.abs(diff))} ${more} ${than}.` : `${base}.`;
  }
  const base = `Verified by your bank: ${lowerFirst(h.title)}, ${usd(h.amount)}`;
  return h.status === "different" ? `${base}. That is ${usd(Math.abs(diff))} ${more} ${than}.` : `${base}.`;
}

// ------------------------------------------------------------------ editing a plan in place

const makeId = (prefix) => prefix + "_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

function context(ctx = {}) {
  return { today: ctx.today || localToday(), now: ctx.now || new Date().toISOString(), newId: ctx.newId || makeId };
}

function ensure(p) {
  if (!Array.isArray(p.history)) p.history = [];
  if (!Array.isArray(p.dismissed)) p.dismissed = [];
  if (!Array.isArray(p.unplannedSeen)) p.unplannedSeen = [];
  if (!Array.isArray(p.payments)) p.payments = [];
  if (!Array.isArray(p.pledges)) p.pledges = [];
  if (!Array.isArray(p.lines)) p.lines = [];
}

function addHistory(p, c, fields) {
  const h = {
    id: c.newId("h"),
    at: c.now,
    date: c.today,
    kind: "payment",
    title: "",
    amount: 0,
    status: "waiting",
    source: "you",
    bank: null,
    note: "",
    expected: null,
    expectedFrom: null,
    who: "",
    ref: {},
    ...fields,
  };
  p.history.unshift(h);
  return h;
}

function bankInfo(tx, accounts = []) {
  const a = accounts.find((x) => x.id === tx.accountId) || null;
  return { account: a?.name || "Your account", mask: a?.mask || null, date: tx.date, merchant: tx.name, amount: cents(Math.abs(tx.amount)), transactionId: tx.id };
}

const lineOf = (p, id) => p.lines.find((l) => l.id === id) || null;
const addPaidToLine = (p, lineId, delta) => {
  const line = lineOf(p, lineId);
  if (line) line.paid = Math.max(0, cents((Number(line.paid) || 0) + delta));
  return line;
};

// You paid something. Marks the payment paid (or files a new paid one) and waits for the bank.
// Returns the history id. Saying the same payment twice does not count it twice.
export function logPayment(p, input, ctx) {
  const c = context(ctx);
  ensure(p);
  const date = input.date || c.today;
  const pay = input.paymentId ? p.payments.find((x) => x.id === input.paymentId) : null;
  if (pay && pay.status === "paid") {
    const existing = p.history.find((h) => h.ref?.paymentId === pay.id);
    if (existing) return existing.id;
  }
  const said = Number(input.amount);
  const planned = pay ? Number(pay.plannedAmount ?? pay.amount) : null;
  const amount = said > 0 ? cents(said) : pay ? pay.amount : 0;
  const lineId = input.lineId || pay?.lineId || null;
  const who = String(input.who || "").trim();
  let payment = pay;
  if (pay) {
    const before = pay.status === "paid" ? Number(pay.amount) || 0 : 0;
    if (amount !== pay.amount) {
      pay.plannedAmount = pay.plannedAmount ?? pay.amount;
      pay.amount = amount;
    }
    pay.status = "paid";
    pay.paidOn = date;
    addPaidToLine(p, lineId, amount - before);
  } else {
    payment = { id: c.newId("p"), lineId, label: who || lineShort(lineOf(p, lineId)) || "Payment", amount, dueDate: date, status: "paid", paidOn: date, source: "manual" };
    p.payments.push(payment);
    addPaidToLine(p, lineId, amount);
  }
  const expected = planned != null && planned > 0 ? planned : amount;
  const expectedFrom = planned != null && planned > 0 ? "plan" : "you";
  const off = !closeAmount(amount, expected);
  const h = addHistory(p, c, {
    date,
    kind: "payment",
    title: payment.label,
    amount,
    expected,
    expectedFrom,
    who,
    ref: { paymentId: payment.id, lineId },
    note: off ? `You said ${usd(amount)}. The plan says ${usd(expected)}. Waiting for your bank.` : "Waiting for your bank to show it.",
  });
  return h.id;
}

// A payment goes back to unpaid: the paid amount leaves the line and its history entry goes away.
export function undoPayment(p, paymentId) {
  ensure(p);
  const pay = p.payments.find((x) => x.id === paymentId);
  if (!pay) return;
  if (pay.status === "paid") addPaidToLine(p, pay.lineId, -(Number(pay.amount) || 0));
  if (pay.plannedAmount != null) {
    pay.amount = pay.plannedAmount;
    delete pay.plannedAmount;
  }
  pay.status = "due";
  pay.paidOn = null;
  delete pay.verified;
  p.history = p.history.filter((h) => h.ref?.paymentId !== paymentId);
}

function findPledge(p, { pledgeId, name }) {
  if (pledgeId) {
    const byId = p.pledges.find((f) => f.id === pledgeId);
    if (byId) return byId;
  }
  const words = personWords(name);
  if (!words.length) return null;
  return p.pledges.find((f) => shareWord(words, personWords(f.name))) || null;
}

// Family money you received. Adds it to the pledge (or starts one) and waits for the bank.
export function logFamilyMoney(p, input, ctx) {
  const c = context(ctx);
  ensure(p);
  const amount = cents(Math.abs(Number(input.amount) || 0));
  let pledge = findPledge(p, input);
  if (!pledge) {
    pledge = { id: c.newId("f"), name: String(input.name || "Family").trim(), relation: "", lineId: null, item: String(input.item || ""), amount, received: 0, strings: "" };
    p.pledges.push(pledge);
  }
  pledge.received = cents((Number(pledge.received) || 0) + amount);
  const h = addHistory(p, c, {
    date: input.date || c.today,
    kind: "family",
    title: pledge.name,
    amount,
    expected: amount,
    expectedFrom: "you",
    who: pledge.name,
    ref: { pledgeId: pledge.id, lineId: pledge.lineId || null },
    item: input.item || pledge.item || "",
    note: "Waiting for your bank to show the money coming in.",
  });
  return h.id;
}

// Other money that came in for the wedding (not a pledge). Counts toward what you have saved.
export function logIncome(p, input, ctx) {
  const c = context(ctx);
  ensure(p);
  const amount = cents(Math.abs(Number(input.amount) || 0));
  p.money = p.money || {};
  p.money.saved = cents((Number(p.money.saved) || 0) + amount);
  const who = String(input.who || "").trim();
  const h = addHistory(p, c, {
    date: input.date || c.today,
    kind: "income",
    title: who || "Money in",
    amount,
    expected: amount,
    expectedFrom: "you",
    who,
    ref: {},
    note: input.note ? String(input.note) : "Waiting for your bank to show the money coming in.",
  });
  return h.id;
}

// Money out for the wedding that is not a scheduled payment. Files a paid payment so the totals agree.
export function logExpense(p, input, ctx) {
  const c = context(ctx);
  ensure(p);
  const amount = cents(Math.abs(Number(input.amount) || 0));
  const lineId = input.lineId || null;
  const who = String(input.who || "").trim();
  const title = who || String(input.note || "").trim() || lineShort(lineOf(p, lineId)) || "Expense";
  const date = input.date || c.today;
  const payment = { id: c.newId("p"), lineId, label: title, amount, dueDate: date, status: "paid", paidOn: date, source: "manual" };
  p.payments.push(payment);
  addPaidToLine(p, lineId, amount);
  const h = addHistory(p, c, {
    date,
    kind: "expense",
    title,
    amount,
    expected: amount,
    expectedFrom: "you",
    who,
    ref: { paymentId: payment.id, lineId },
    note: input.note ? String(input.note) : "Waiting for your bank to show it.",
  });
  return h.id;
}

export function logSubscriptionCancelled(p, input, ctx) {
  const c = context(ctx);
  ensure(p);
  const monthly = cents(Math.abs(Number(input.monthly) || 0));
  const h = addHistory(p, c, {
    date: input.date || c.today,
    kind: "subscription",
    title: `Cancelled ${input.name}`,
    amount: monthly,
    who: String(input.name || ""),
    ref: { subscription: String(input.name || "") },
    note: "Waiting to see no more charges in your bank.",
  });
  return h.id;
}

// A quote you added. Nothing for the bank to check, so it is filed as done.
export function logQuote(p, input, ctx) {
  const c = context(ctx);
  ensure(p);
  const h = addHistory(p, c, {
    kind: "quote",
    title: `Quote from ${input.vendor || "a vendor"}`,
    amount: cents(Number(input.amount) || 0),
    status: "verified",
    who: input.vendor || "",
    ref: { quoteId: input.quoteId || null, lineId: input.lineId || null },
    note: "Added to your plan with the true total.",
  });
  return h.id;
}

// ------------------------------------------------------------------ settling things against the bank

function settleAmount(p, h, bankAmount) {
  // Moves the plan from the amount it holds for this entry to what the bank shows.
  const delta = cents(bankAmount - h.amount);
  if (!delta) return;
  if (h.kind === "payment" || h.kind === "expense") {
    const pay = p.payments.find((x) => x.id === h.ref?.paymentId);
    if (pay) {
      pay.plannedAmount = pay.plannedAmount ?? pay.amount;
      pay.amount = cents(bankAmount);
    }
    addPaidToLine(p, h.ref?.lineId, delta);
  } else if (h.kind === "family") {
    const pledge = p.pledges.find((f) => f.id === h.ref?.pledgeId);
    if (pledge) {
      pledge.received = Math.max(0, cents((Number(pledge.received) || 0) + delta));
    }
  } else if (h.kind === "income") {
    p.money.saved = Math.max(0, cents((Number(p.money.saved) || 0) + delta));
  }
}

function differenceNote(p, h) {
  const diff = cents(h.amount - h.expected);
  const more = diff > 0 ? "more" : "less";
  if (h.kind === "family" || h.kind === "income") {
    return `${h.who || "They"} sent ${usd(h.amount)}, ${usd(Math.abs(diff))} ${more} ${THAN[h.expectedFrom] || THAN.you}.`;
  }
  const line = lineOf(p, h.ref?.lineId);
  if (h.expectedFrom === "plan") {
    return `You paid ${usd(Math.abs(diff))} ${more} than planned.${line ? ` The ${lineName(line)} line now shows ${usd(line.paid)}.` : ""}`;
  }
  return `Your bank shows ${usd(h.amount)}, ${usd(Math.abs(diff))} ${more} than you wrote down.${line ? ` The ${lineName(line)} line now shows ${usd(line.paid)}.` : ""}`;
}

// Fills in a waiting entry from the transaction the bank shows for it.
function settleEntry(p, h, tx, accounts, c) {
  const bankAmount = cents(Math.abs(tx.amount));
  settleAmount(p, h, bankAmount);
  h.amount = bankAmount;
  h.bank = bankInfo(tx, accounts);
  h.verifiedAt = c.now;
  h.verified = true;
  const off = h.expected != null && !closeAmount(bankAmount, h.expected);
  h.status = off ? "different" : "verified";
  h.note = off
    ? differenceNote(p, h)
    : h.kind === "family" || h.kind === "income"
      ? `Your bank shows ${usd(bankAmount)} coming in on ${shortDate(tx.date)}.`
      : `Matches ${tx.name} in your bank on ${shortDate(tx.date)}.`;
  const pay = p.payments.find((x) => x.id === h.ref?.paymentId);
  if (pay) pay.verified = true;
  return h;
}

// Bank said a scheduled payment went out. Marks it paid, updates the line, files the history entry.
function applyPaymentMatch(p, m, bankState, c) {
  const pay = p.payments.find((x) => x.id === m.paymentId);
  if (!pay) return null;
  const tx = bankState.byId.get(m.transactionId);
  const wasPaid = pay.status === "paid";
  const before = wasPaid ? Number(pay.amount) || 0 : 0;
  const bankAmount = cents(m.amount);
  const planned = Number(pay.plannedAmount ?? pay.amount);
  if (bankAmount !== pay.amount) {
    pay.plannedAmount = pay.plannedAmount ?? pay.amount;
    pay.amount = bankAmount;
  }
  pay.status = "paid";
  if (!wasPaid) {
    pay.paidOn = m.paidOn;
    pay.source = "bank";
  }
  pay.verified = true;
  addPaidToLine(p, pay.lineId, bankAmount - before);
  const off = !closeAmount(bankAmount, planned);
  const h = addHistory(p, c, {
    date: m.paidOn,
    kind: "payment",
    title: pay.label,
    amount: bankAmount,
    status: off ? "different" : "verified",
    source: "bank",
    bank: bankInfo(tx, bankState.accounts),
    expected: planned,
    expectedFrom: "plan",
    ref: { paymentId: pay.id, lineId: pay.lineId },
    verifiedAt: c.now,
    verified: true,
  });
  h.note = off ? differenceNote(p, h) : `Matches ${tx.name} in your bank on ${shortDate(tx.date)}.`;
  return h;
}

// Marks scheduled payments paid from the bank (exact, or the same vendor with another amount).
// Changes p. Returns the match rows, each with the history id as historyId.
export function markPaymentsFromBank(p, bank, ctx) {
  const c = context(ctx);
  ensure(p);
  const bankState = bankLookup(bank);
  const used = usedIds(p, bankState.transactions);
  const vendorsByLine = {};
  for (const l of p.lines) if (l.vendor) vendorsByLine[l.id] = l.vendor;
  const matches = matchPayments(p.payments, bankState.transactions, vendorsByLine, { allowDifferent: true, used });
  for (const m of matches) {
    const h = applyPaymentMatch(p, m, bankState, c);
    if (h) m.historyId = h.id;
  }
  return matches;
}

function bankLookup(bank) {
  const transactions = Array.isArray(bank?.transactions) ? bank.transactions : [];
  return { transactions, accounts: Array.isArray(bank?.accounts) ? bank.accounts : [], byId: new Map(transactions.map((t) => [t.id, t])) };
}

// Ids the plan has already used: every history entry that holds a bank transaction. A transaction that
// shows up again under a new id (after the test bank is linked again) is matched by date, name and amount.
function usedIds(p, transactions) {
  const ids = new Set();
  const sigs = new Set();
  for (const h of p.history) {
    const b = h.bank;
    if (!b) continue;
    if (b.transactionId) ids.add(b.transactionId);
    sigs.add(signature({ date: b.date, name: b.merchant, amount: b.amount }));
  }
  for (const t of transactions) if (sigs.has(signature(t))) ids.add(t.id);
  return ids;
}

// How a cancelled subscription looks in the bank. 'verified': no charge since the cancel date and the
// next expected charge has passed. 'charged-again': a charge landed after the cancel date.
// Otherwise 'waiting'. recurring is the bank's list of repeating charges.
export function subscriptionCancelState({ name, cancelledOn }, transactions = [], recurring = [], today = localToday()) {
  const words = nameWords(name);
  if (!words.length) return { state: "waiting", lastCharge: null };
  const charges = transactions.filter((t) => t.amount > 0 && shareWord(words, nameWords(t.name))).sort((a, b) => (a.date < b.date ? 1 : -1));
  const after = charges.find((t) => dayDiff(t.date, cancelledOn) > 1);
  if (after) return { state: "charged-again", lastCharge: after.date };
  const stream = recurring.find((r) => shareWord(words, nameWords(r.name)));
  const next = stream?.nextDate || null;
  if (next && dayDiff(today, next) > 2 && dayDiff(today, cancelledOn) >= 1) return { state: "verified", lastCharge: charges[0]?.date || null };
  if (!next && charges[0] && dayDiff(today, charges[0].date) > 35 && dayDiff(today, cancelledOn) >= 1) return { state: "verified", lastCharge: charges[0].date };
  return { state: "waiting", lastCharge: charges[0]?.date || null };
}

// The whole check, run after every bank refresh. Changes p in place and returns:
//   { verified: [historyIds], different: [historyIds], unplanned: [...], unplannedNew: [transactionIds], changed }
// Order: things you said (waiting) first, then payments marked paid by hand, then payments still due,
// then family money nobody wrote down, then charges that look like wedding spending nobody planned.
// Running it again with the same bank data changes nothing.
export function verifyAgainstBank(p, bank, ctx) {
  const c = context(ctx);
  ensure(p);
  const result = { verified: [], different: [], unplanned: [], unplannedNew: [], changed: false };
  const bankState = bankLookup(bank);
  if (!bankState.transactions.length && !(bank?.recurring || []).length) return result;
  const txns = bankState.transactions;
  const used = usedIds(p, txns);
  const record = (h) => {
    if (!h) return;
    result.changed = true;
    (h.status === "different" ? result.different : result.verified).push(h.id);
  };

  // 1. Things you said happened.
  const waiting = p.history.filter((h) => h.status === "waiting" && !h.bank).reverse(); // oldest first
  for (const h of waiting) {
    if (h.kind === "subscription") {
      const st = subscriptionCancelState({ name: h.who, cancelledOn: h.date }, txns, bank?.recurring || [], c.today);
      if (st.state === "verified") {
        h.status = "verified";
        h.verifiedAt = c.now;
        h.note = "No new charges since you cancelled.";
        record(h);
      } else if (st.state === "charged-again") {
        h.status = "different";
        h.verifiedAt = c.now;
        h.note = `${h.who} charged you again on ${shortDate(st.lastCharge)}. Check that it is really cancelled.`;
        record(h);
      }
      continue;
    }
    if (!["payment", "expense", "family", "income"].includes(h.kind)) continue;
    const line = lineOf(p, h.ref?.lineId);
    const pledge = h.ref?.pledgeId ? p.pledges.find((f) => f.id === h.ref.pledgeId) : null;
    const moneyIn = h.kind === "family" || h.kind === "income";
    const names = moneyIn ? [h.who, pledge?.name].filter(Boolean) : [h.who, line?.vendor].filter(Boolean);
    const found = findBankMatch({ direction: moneyIn ? "in" : "out", amount: h.amount, date: h.date, names }, txns, { used });
    if (!found) continue;
    used.add(found.tx.id);
    settleEntry(p, h, found.tx, bankState.accounts, c);
    record(h);
  }

  // 2. Payments you ticked off by hand before there was a history, if the bank shows them.
  const legacy = p.payments.filter((x) => x.status === "paid" && !p.history.some((h) => h.ref?.paymentId === x.id));
  if (legacy.length) {
    const vendorsByLine = {};
    for (const l of p.lines) if (l.vendor) vendorsByLine[l.id] = l.vendor;
    const asDue = legacy.map((x) => ({ ...x, status: "due" }));
    for (const m of matchPayments(asDue, txns, vendorsByLine, { allowDifferent: true, used })) {
      used.add(m.transactionId);
      record(applyPaymentMatch(p, m, bankState, c));
    }
  }

  // 3. Payments still due that the bank shows as paid.
  const vendorsByLine = {};
  for (const l of p.lines) if (l.vendor) vendorsByLine[l.id] = l.vendor;
  for (const m of matchPayments(p.payments, txns, vendorsByLine, { allowDifferent: true, used })) {
    used.add(m.transactionId);
    record(applyPaymentMatch(p, m, bankState, c));
  }

  // 4. Money in from the people who pledged, that nobody wrote down.
  for (const m of matchFamilyMoney(p.pledges, txns, { used, today: c.today })) {
    used.add(m.transactionId);
    const pledge = p.pledges.find((f) => f.id === m.pledgeId);
    if (!pledge) continue;
    const tx = bankState.byId.get(m.transactionId);
    const outstanding = Math.max(0, cents(pledge.amount - (Number(pledge.received) || 0)));
    const alreadyCounted = (Number(pledge.received) || 0) >= pledge.amount && pledge.amount > 0 && !p.history.some((h) => h.ref?.pledgeId === pledge.id);
    const expected = outstanding > 0 ? outstanding : pledge.amount;
    const matchesPledge = closeAmount(m.amount, pledge.amount) || closeAmount(m.amount, expected);
    const partial = !matchesPledge && m.amount < expected;
    const off = !matchesPledge && !partial;
    if (!alreadyCounted) {
      pledge.received = cents((Number(pledge.received) || 0) + m.amount);
    }
    const h = addHistory(p, c, {
      date: m.date,
      kind: "family",
      title: pledge.name,
      amount: m.amount,
      status: off ? "different" : "verified",
      source: "bank",
      bank: bankInfo(tx, bankState.accounts),
      expected,
      expectedFrom: "pledge",
      who: pledge.name,
      ref: { pledgeId: pledge.id, lineId: pledge.lineId || null },
      item: pledge.item || "",
      verifiedAt: c.now,
      verified: true,
    });
    if (off) h.note = `${pledge.name} sent ${usd(m.amount)}, ${usd(Math.abs(m.amount - expected))} more than the ${usd(expected)} pledged.`;
    else if (partial) h.note = `${pledge.name} sent ${usd(m.amount)}. ${usd(Math.max(0, pledge.amount - pledge.received))} of the ${usd(pledge.amount)} pledged is still to come.`;
    else h.note = `Your bank shows ${usd(m.amount)} from ${pledge.name} on ${shortDate(tx.date)}.`;
    record(h);
  }

  // 5. Spending that looks like the wedding and is in no plan.
  const lineIds = p.lines.map((l) => l.id);
  result.unplanned = detectUnplanned(txns, { usedIds: used, dismissed: p.dismissed, lineIds, today: c.today });
  const seen = new Set(p.unplannedSeen);
  for (const u of result.unplanned) {
    if (seen.has(u.transactionId)) continue;
    seen.add(u.transactionId);
    p.unplannedSeen.push(u.transactionId);
    result.unplannedNew.push(u.transactionId);
    result.changed = true;
  }
  return result;
}

// You said yes to a charge nobody planned: it becomes a paid expense on a line, already verified.
export function acceptUnplannedCharge(p, tx, lineId, bank, ctx) {
  const c = context(ctx);
  ensure(p);
  const bankState = bankLookup(bank);
  if (usedIds(p, [tx]).has(tx.id)) return null;
  let line = lineId ? lineOf(p, lineId) : null;
  if (!line) {
    const guess = guessLineId(tx, p.lines.map((l) => l.id));
    line = guess ? lineOf(p, guess) : null;
  }
  if (!line) {
    line = { id: c.newId("line"), category: "Other", item: tx.name, planned: 0, committed: 0, paid: 0, vendor: null, protected: false, forgotten: false, quoteId: null };
    p.lines.push(line);
  }
  const amount = cents(Math.abs(tx.amount));
  const payment = { id: c.newId("p"), lineId: line.id, label: tx.name, amount, dueDate: tx.date, status: "paid", paidOn: tx.date, source: "bank", verified: true };
  p.payments.push(payment);
  addPaidToLine(p, line.id, amount);
  const h = addHistory(p, c, {
    date: tx.date,
    kind: "expense",
    title: tx.name,
    amount,
    status: "verified",
    source: "bank",
    bank: bankInfo(tx, bankState.accounts),
    expected: amount,
    expectedFrom: "you",
    who: tx.name,
    ref: { paymentId: payment.id, lineId: line.id },
    note: `Added to your ${lineName(line)} line. This was not in the plan.`,
    verifiedAt: c.now,
    verified: true,
  });
  return h.id;
}

export function dismissUnplannedCharge(p, tx) {
  ensure(p);
  if (!p.dismissed.includes(tx.id)) p.dismissed.push(tx.id);
  const sig = signature(tx);
  if (!p.dismissed.includes(sig)) p.dismissed.push(sig);
}

// ------------------------------------------------------------------ subscriptions to cancel

// The pick list for "cancel these and the wedding gets $X a month": every recurring charge
// except the ones people cannot drop (rent, utilities, loans, medical, taxes), biggest first.
// Transfers only count when Plaid knows the merchant, so savings transfers stay out.
const ESSENTIAL = new Set([
  "RENT_AND_UTILITIES",
  "LOAN_PAYMENTS",
  "MEDICAL",
  "GOVERNMENT_AND_NON_PROFIT",
  "BANK_FEES",
  "INCOME",
  "TRANSFER_IN",
]);

export function cancelCandidates(recurring) {
  return recurring
    .filter((r) => r.monthly > 0 && !ESSENTIAL.has(r.category))
    .filter((r) => r.category !== "TRANSFER_OUT" || r.merchant)
    .sort((a, b) => b.monthly - a.monthly);
}

export function monthlyFreed(selected) {
  return Math.round(selected.reduce((s, r) => s + r.monthly, 0) * 100) / 100;
}

// Months of freed money until the wedding, as a total toward the goal.
export function freedByWedding(monthly, monthsLeft) {
  return Math.round(monthly * Math.max(0, monthsLeft) * 100) / 100;
}

// ------------------------------------------------------------------ how a vendor wants to be paid (fraud warning)

// { method, bankLast4, handle } with each part trimmed and in one form, or null when there is nothing in it.
export function cleanInstructions(raw) {
  if (!raw || typeof raw !== "object") return null;
  const method = String(raw.method || "").toLowerCase().replace(/[^a-z]/g, "") || null;
  const digits = String(raw.bankLast4 ?? "").replace(/\D/g, "");
  const bankLast4 = digits.length >= 4 ? digits.slice(-4) : null;
  const handle = String(raw.handle || "").trim().slice(0, 80) || null;
  if (!method && !bankLast4 && !handle) return null;
  return { method, bankLast4, handle };
}

const handleKey = (h) => {
  const t = String(h || "").toLowerCase().trim();
  const digits = t.replace(/[\s().+-]/g, "");
  if (/^\d{10,11}$/.test(digits)) return digits.slice(-10); // a phone number, however it is written
  return t.replace(/[\s@$]/g, "");
};

// Did the vendor's way of being paid change? A part that is new and has nothing to compare with is not a change,
// unless the vendor had a different kind of detail before (a new account number where there was only a Zelle email).
export function instructionsDiffer(before, after) {
  const a = cleanInstructions(before);
  const b = cleanInstructions(after);
  if (!a || !b) return false;
  if (a.method && b.method && a.method !== b.method) return true;
  if (a.bankLast4 && b.bankLast4 && a.bankLast4 !== b.bankLast4) return true;
  if (a.handle && b.handle && handleKey(a.handle) !== handleKey(b.handle)) return true;
  if (b.bankLast4 && !a.bankLast4 && a.handle) return true;
  if (b.handle && !a.handle && a.bankLast4) return true;
  return false;
}

const METHOD_WORDS = { bank: "bank account", zelle: "Zelle", venmo: "Venmo", cashapp: "Cash App", check: "a check", card: "a card", cash: "cash", other: "another way" };

// "bank account ending 4417" or "Zelle to pay@x.com", for the alert.
export function describeInstructions(instr) {
  const c = cleanInstructions(instr);
  if (!c) return "no details";
  const bits = [];
  const method = c.method ? METHOD_WORDS[c.method] || c.method : null;
  if (c.bankLast4) bits.push(`${method && c.method === "bank" ? method : "bank account"} ending ${c.bankLast4}`);
  if (c.handle) bits.push(c.method && c.method !== "bank" && method ? `${method} to ${c.handle}` : c.handle);
  if (!bits.length && method) bits.push(method);
  return bits.join(", ");
}

// ------------------------------------------------------------------ the buffer (money that always stays in the bank)

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function addDays(iso, n) {
  return new Date(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
}

// Cash you could pay a vendor from: checking, savings and the like. Never credit cards or loans. Null when the bank
// is not connected. With no account list, falls back to the total the server worked out.
export function bankCash(bank) {
  if (!bank || bank.connected === false) return null;
  const accounts = Array.isArray(bank.accounts) ? bank.accounts : [];
  if (accounts.length) {
    const cash = accounts.filter((a) => a && a.type === "depository" && !["cd", "hsa", "ebt"].includes(String(a.subtype || "").toLowerCase()));
    return cents(cash.reduce((s, a) => s + num(a.available ?? a.current ?? a.balance), 0));
  }
  return Number.isFinite(Number(bank.cash)) && bank.cash !== null ? cents(Number(bank.cash)) : null;
}

// The buffer check. Walks the payments due in the next `days` days (overdue ones count as due today, and so does a
// payment you said you paid that the bank has not shown yet) against the cash in the bank, and finds the lowest point.
// Returns { connected, cash, keep, days, upcoming: [{ id, date, dueDate, label, amount, balanceAfter, overdue?, waiting? }],
//           lowest: { date, balanceAfter, label, count, amount, shortBy } | null, warn, shortBy, text, caveat }.
// warn is true when the lowest point is under the buffer (or under zero when there is no buffer). It does not count pay
// coming in or everyday spending, which `caveat` says.
export function bufferCheck(plan, bank, { today = localToday(), days = 60 } = {}) {
  const keep = Math.max(0, cents(num(plan?.money?.keepInBank)));
  const cash = bankCash(bank);
  const horizon = addDays(today, days);
  const waitingIds = new Set((plan?.history || []).filter((h) => h.status === "waiting" && h.ref?.paymentId).map((h) => h.ref.paymentId));
  const caveat = "This looks only at payments in your plan. It does not count pay coming in or everyday spending.";

  const rows = [];
  for (const p of plan?.payments || []) {
    const amount = cents(num(p.amount));
    if (!(amount > 0)) continue;
    const due = String(p.dueDate || today).slice(0, 10);
    if (p.status !== "paid") {
      if (due > horizon) continue;
      rows.push({ id: p.id, date: due < today ? today : due, dueDate: due, label: p.label || "Payment", amount, ...(due < today ? { overdue: true } : {}) });
    } else if (waitingIds.has(p.id)) {
      rows.push({ id: p.id, date: today, dueDate: due, label: p.label || "Payment", amount, waiting: true });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));

  const base = { connected: cash !== null, cash, keep, days, caveat };
  if (cash === null) {
    return {
      ...base, upcoming: rows.map((r) => ({ ...r })), lowest: null, warn: false, shortBy: 0,
      text: keep > 0 ? `Connect your bank and Padrino will check each payment against the ${usd(keep)} you keep there.` : "Connect your bank and Padrino will check each payment against what you have there."
    };
  }

  let balance = cash;
  let lowest = null;
  const upcoming = [];
  for (let i = 0; i < rows.length;) {
    let j = i;
    let groupAmount = 0;
    while (j < rows.length && rows[j].date === rows[i].date) {
      balance = cents(balance - rows[j].amount);
      groupAmount = cents(groupAmount + rows[j].amount);
      upcoming.push({ ...rows[j], balanceAfter: balance });
      j++;
    }
    const count = j - i;
    if (!lowest || balance < lowest.balanceAfter) {
      lowest = { date: rows[i].date, balanceAfter: balance, label: count === 1 ? rows[i].label : null, count, amount: groupAmount };
    }
    i = j;
  }

  const floor = keep > 0 ? keep : 0;
  const warn = Boolean(lowest) && lowest.balanceAfter < floor;
  const shortBy = warn ? cents(floor - lowest.balanceAfter) : 0;
  if (lowest) lowest.shortBy = shortBy;

  let text;
  if (!lowest) {
    text = keep > 0 ? `Nothing is due in the next ${days} days, so your ${usd(keep)} cushion is safe.` : `Nothing is due in the next ${days} days.`;
  } else {
    const what = lowest.count === 1 ? `the ${lowerFirst(lowest.label)}` : `the ${lowest.count} payments due`;
    const when = shortDate(lowest.date);
    const left = Math.round(lowest.balanceAfter);
    if (warn && lowest.balanceAfter < 0) text = `Paying ${what} on ${when} would take your bank about ${usd(-left)} below zero.`;
    else if (warn) text = `Paying ${what} on ${when} would leave about ${usd(left)}, under your ${usd(keep)} cushion.`;
    else if (keep > 0) text = `Your bank stays above your ${usd(keep)} cushion. The lowest it gets is about ${usd(left)}, on ${when}.`;
    else text = `Your bank covers what is due in the next ${days} days. The lowest it gets is about ${usd(left)}, on ${when}.`;
  }
  return { ...base, upcoming, lowest, warn, shortBy, text };
}
