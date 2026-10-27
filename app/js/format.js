// Formatting only. No money math lives here.

const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0
});
const usdCents = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2
});

// $12,900. Whole dollars by default; cents only when asked for.
export function money(n, { cents = false } = {}) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  if (cents) return usdCents.format(Math.round(v * 100) / 100);
  return usdWhole.format(Math.round(v));
}

// +$1,200 or -$300, for deltas.
export function moneySigned(n) {
  const v = Number(n) || 0;
  if (v === 0) return money(0);
  return (v > 0 ? '+' : '-') + money(Math.abs(v));
}

// $200 to $600, or a single value when one side is missing.
export function moneyRange(low, high) {
  if (low == null && high == null) return '';
  if (low == null) return 'up to ' + money(high);
  if (high == null) return 'from ' + money(low);
  if (low === high) return money(low);
  return money(low) + ' to ' + money(high);
}

export function pct(rate, digits = 0) {
  if (rate === null || rate === undefined) return '';
  return (Number(rate) * 100).toFixed(digits) + '%';
}

export function num(n) {
  return new Intl.NumberFormat('en-US').format(Number(n) || 0);
}

// Parses "2026-12-01" as a local date, not UTC, so the day does not shift.
export function parseDate(iso) {
  if (!iso) return null;
  if (iso instanceof Date) return iso;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(iso, opts = {}) {
  const d = parseDate(iso);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...opts });
}

export function fmtDateShort(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtMonth(yyyymm) {
  if (!yyyymm) return '';
  const [y, m] = String(yyyymm).split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Whole days from today to a date. Negative when it has passed.
export function daysUntil(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - a) / 86400000);
}

// "in 3 weeks", "tomorrow", "2 days ago". Relative time instead of a full date.
export function relative(iso) {
  const d = daysUntil(iso);
  if (d === null) return '';
  const a = Math.abs(d);
  let unit; let n;
  if (a < 14) { unit = 'day'; n = a; }
  else if (a < 60) { unit = 'week'; n = Math.round(a / 7); }
  else if (a < 540) { unit = 'month'; n = Math.round(a / 30.4); }
  else { unit = 'year'; n = Math.round(a / 365); }
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  const phrase = `${n} ${plural(n, unit)}`;
  return d > 0 ? `in ${phrase}` : `${phrase} ago`;
}

// "just now", "5 min ago", "2 hours ago", "yesterday", then a short date. For message timestamps.
export function timeAgo(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${plural(h, 'hour')} ago`;
  const days = Math.round(h / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return fmtDateShort(iso);
}

// "Sat, Jun 12"
export function fmtDay(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

export function plural(n, one, many) {
  return Number(n) === 1 ? one : (many || one + 's');
}

// Escape for innerHTML.
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

export function names(plan) {
  const n = plan?.couple?.names || [];
  const a = (n[0] || '').trim();
  const b = (n[1] || '').trim();
  if (a && b) return `${a} and ${b}`;
  return a || b || 'You two';
}
