// Small shared UI pieces: icons, rings, bars, toast, dialogs, element helper.

import { esc } from './format.js';

// Inline SVG icons. Simple strokes, no clip art. Everything works offline.
const paths = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  budget: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h4"/>',
  quote: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  payments: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M8 3v4M16 3v4M8 14h2M12 14h2"/>',
  family: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M15 20v-1a4 4 0 0 1 6 0v1"/>',
  fixer: '<path d="M14 3l7 7-4 4-7-7z"/><path d="M10 7 3 14l7 7 7-7"/>',
  find: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5M11 8v6M9 11h4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m5 12 4 4L19 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  bank: '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  // Vendors and messages
  store: '<path d="M4 9h16l-1-5H5z"/><path d="M4 9v11h16V9"/><path d="M10 20v-6h4v6"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9"/>',
  contract: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="m9.5 15 2 2 3.5-4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',
  send: '<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  mail: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m3 8 9 6 9-6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6H5V5h6"/>',
  cake: '<path d="M4 21h16"/><path d="M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7"/><path d="M8 12V8M12 12V7M16 12V8"/><path d="M8 5.5v.5M12 4.5v.5M16 5.5v.5"/>',
  mariachi: '<path d="M12.5 11.5 20 4M18.2 5.8l1.5 1.5"/><path d="M9 11c2.5 0 4 1.5 4 3.5 0 1.3-1 1.7-1 3a3.5 3.5 0 1 1-7 0c0-1.3-1-1.7-1-3C4 12.5 6.5 11 9 11z"/>',
  catering: '<path d="M4 17h16"/><path d="M5 17a7 7 0 0 1 14 0"/><path d="M12 10V8"/><path d="M3 20h18"/>',
  rentals: '<path d="M6 11V4h12v7"/><path d="M4 11h16v4H4z"/><path d="M6 15v6M18 15v6"/>',
  // Categories and priorities
  venue: '<path d="M4 21V10l8-6 8 6v11"/><path d="M9 21v-6h6v6"/>',
  food: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M2 12h3M19 12h3"/>',
  drinks: '<path d="M6 3h12l-5 8v7h4v2H7v-2h4v-7z"/>',
  photo: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  video: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="m16 11 5-3v8l-5-3"/>',
  music: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="15" r="3"/><path d="M10 17V5l10-2v12"/>',
  dress: '<path d="M9 3h6l-1 5 4 11H6l4-11z"/><path d="M9 3c0 2 1.5 3 3 3s3-1 3-3"/>',
  flowers: '<circle cx="12" cy="9" r="2.5"/><path d="M12 3v3M12 12v9M8 6l2 2M16 6l-2 2M8 12l2-2M16 12l-2-2"/><path d="M12 21c-3 0-5-2-5-4 3 0 5 2 5 4zm0 0c3 0 5-2 5-4-3 0-5 2-5 4z"/>',
  decor: '<path d="M12 3l2 5 5 1-4 3.5 1.5 5.5-4.5-3-4.5 3L9 12.5 5 9l5-1z"/>',
  'hair-makeup': '<path d="M4 20l9-9"/><path d="M12 8l4-4 4 4-4 4z"/><path d="M6 18l-2 2"/>',
  rings: '<circle cx="9" cy="13" r="5"/><circle cx="15" cy="13" r="5"/><path d="M12 5l-1.5 2h3z"/>',
  honeymoon: '<path d="M3 15l18-7-6 10-3-4-4 2z"/>',
  'guests-comfort': '<circle cx="8" cy="7" r="3"/><circle cx="16" cy="7" r="3"/><path d="M2 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M12 18v-1a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v3"/>',
  invitations: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m3 8 9 6 9-6"/>',
  stationery: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m3 8 9 6 9-6"/>',
  officiant: '<path d="M12 3v18M7 8h10"/><path d="M5 21h14"/>',
  planning: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM8 11h8M8 15h5"/>',
  transportation: '<path d="M4 15l2-6h12l2 6v4H4z"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/><path d="M2 15h20"/>',
  lodging: '<path d="M3 18V8M3 14h18v4M21 14v-3a2 2 0 0 0-2-2h-8v5"/><circle cx="7" cy="10" r="2"/>',
  favors: '<rect x="4" y="10" width="16" height="10" rx="1"/><path d="M4 7h16v3H4zM12 7v13M12 7c-2 0-4-1-4-3s4 0 4 3zm0 0c2 0 4-1 4-3s-4 0-4 3z"/>',
  events: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 15h2M13 15h2"/>',
  tips: '<path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M5 11h14l-1 9H6z"/>',
  cushion: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v7a2 2 0 0 0 4 0"/>',
  cultural: '<path d="M3 5h18"/><path d="M4 5v4l2 2-2 2v2h4v-2l-2-2 2-2V5M14 5v4l2 2-2 2v2h4v-2l-2-2 2-2V5"/>',
  other: '<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  // The path and its steps
  path: '<circle cx="6" cy="5" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M6 7.5v2a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v-1"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-3 4 3 4H5"/>',
  star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7z"/>',
  people: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M15 20v-1a4 4 0 0 1 6 0v1"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v6"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V12"/><path d="M14 11.5V6a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 13.5a1.4 1.4 0 0 1 2.2-1.7L8 14"/>',
  gift: '<rect x="4" y="10" width="16" height="10" rx="1"/><path d="M4 7h16v3H4zM12 7v13M12 7c-2 0-4-1-4-3s4 0 4 3zm0 0c2 0 4-1 4-3s-4 0-4 3z"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  card: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  home2: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  // Path control and the buffer
  more: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  redo: '<path d="M20 11a8 8 0 1 0 2 5.3"/><path d="M20 4v7h-7"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 7.8 8 9 4.6-1.2 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V6a2 2 0 0 1 2-2h11v3"/><path d="M16 13h3"/>'
};

export function icon(name, cls = '') {
  const d = paths[name] || paths.info;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

// Budget category name to an icon name, by keyword.
export function catIcon(category) {
  const c = String(category || '').toLowerCase();
  if (c.includes('venue')) return 'venue';
  if (c.includes('attire')) return 'dress';
  if (c.includes('photo')) return 'photo';
  if (c.includes('music')) return 'music';
  if (c.includes('flower')) return 'flowers';
  if (c.includes('stationery')) return 'stationery';
  if (c.includes('ring')) return 'rings';
  if (c.includes('officiant')) return 'officiant';
  if (c.includes('planning')) return 'planning';
  if (c.includes('transport')) return 'transportation';
  if (c.includes('lodging')) return 'lodging';
  if (c.includes('favor')) return 'favors';
  if (c.includes('events')) return 'events';
  if (c.includes('honeymoon')) return 'honeymoon';
  if (c.includes('tip')) return 'tips';
  if (c.includes('cushion') || c.includes('contingency')) return 'cushion';
  if (c.includes('cultural')) return 'cultural';
  return 'other';
}

// A progress ring. pct 0 to 100. Update later with setRing().
export function ring(pct, { size = 120, stroke = 10, cls = '', label = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = clampPct(pct);
  return `<svg class="ring ${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}" data-circ="${c}">
    <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}

export function setRing(svg, pct) {
  if (!svg) return;
  const c = Number(svg.dataset.circ) || 0;
  const fill = svg.querySelector('.ring-fill');
  if (fill) fill.setAttribute('stroke-dashoffset', String(c * (1 - clampPct(pct) / 100)));
}

// Fits the number inside a ring. Shrinks the font until the text sits inside the hole,
// whatever the amount's width, so $900 and $12,400 both center cleanly.
export function fitRingText(wrap) {
  if (!wrap) return;
  const svg = wrap.querySelector('svg.ring');
  const big = wrap.querySelector('.ring-center .big');
  if (!svg || !big) return;
  const size = Number(svg.getAttribute('width')) || wrap.clientWidth || 0;
  const stroke = Number(svg.querySelector('circle')?.getAttribute('stroke-width')) || 10;
  const inner = Math.max(40, size - stroke * 2 - 14);
  big.style.fontSize = '';
  let px = parseFloat(getComputedStyle(big).fontSize) || 24;
  for (let i = 0; i < 12 && big.scrollWidth > inner && px > 10; i++) {
    px = Math.max(10, px * (inner / big.scrollWidth) * 0.98);
    big.style.fontSize = px + 'px';
  }
}

// A fill bar. pct 0 to 100.
export function bar(pct, { cls = '', label = '' } = {}) {
  return `<div class="fillbar ${cls}" role="img" aria-label="${esc(label)}"><span style="width:${clampPct(pct)}%"></span></div>`;
}

export function setBar(el, pct) {
  const s = el && el.querySelector('span');
  if (s) s.style.width = clampPct(pct) + '%';
}

export function clampPct(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

// How much of what the wedding needs your money covers, 0 to 100, and the words for it.
// Bars and rings fill toward "covered", so a gap reads as a gap.
export function coverPct(available, needed) {
  return share(available, needed);
}

export function coverCaption(available, needed) {
  const a = Number(available) || 0; const n = Number(needed) || 0;
  if (!n || a >= n) return 'Fully covered, with room to spare';
  return `You will have ${Math.floor((a / n) * 100)}% of what the wedding needs`;
}

// Share of a whole, as a percent for the eye. Never shown as a figure.
export function share(part, whole) {
  const p = Number(part) || 0; const w = Number(whole) || 0;
  if (!w) return 0;
  return clampPct((p / w) * 100);
}

let toastTimer = null;
export function toast(message, ms = 2400) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  root.innerHTML = `<div class="toast" role="status">${esc(message)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { root.innerHTML = ''; }, ms);
}

// Opens a sheet with the given HTML. Returns the dialog. Close with closeSheet().
export function openSheet(html, { onClose } = {}) {
  closeSheet();
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  dlg.innerHTML = `<div class="sheet-body">${html}</div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('click', (e) => {
    // Click on the backdrop closes it.
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (onClose) onClose();
  });
  dlg.showModal();
  const firstInput = dlg.querySelector('input, select, textarea, button');
  if (firstInput) firstInput.focus();
  return dlg;
}

export function closeSheet() {
  document.querySelectorAll('dialog.sheet').forEach((d) => {
    try { d.close(); } catch { d.remove(); }
  });
}

// Ask yes or no with a sheet. Resolves true on confirm.
export function confirmSheet({ title, body, confirmLabel = 'Yes', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const dlg = openSheet(`
      <h2>${esc(title)}</h2>
      <p class="muted">${esc(body || '')}</p>
      <div class="row end mt gap">
        <button class="btn secondary" type="button" data-act="no">Cancel</button>
        <button class="btn ${danger ? 'danger' : ''}" type="button" data-act="yes">${esc(confirmLabel)}</button>
      </div>`, { onClose: () => { if (!answered) resolve(false); } });
    dlg.querySelector('[data-act="yes"]').addEventListener('click', () => { answered = true; resolve(true); dlg.close(); });
    dlg.querySelector('[data-act="no"]').addEventListener('click', () => { answered = true; resolve(false); dlg.close(); });
  });
}

// ---- Wedding style tiles (onboarding and the path share them)

// The traditions Sid listed, used until /data/traditions.json exists. Photos come from that file;
// without one the tile shows a soft color instead, never a picture from the wrong culture.
export const TRADITION_FALLBACK = [
  { id: 'mexican', name: 'Mexican' }, { id: 'indian', name: 'Indian' }, { id: 'christian', name: 'Christian' },
  { id: 'catholic', name: 'Catholic' }, { id: 'jewish', name: 'Jewish' }, { id: 'muslim', name: 'Muslim' },
  { id: 'japanese', name: 'Japanese' }, { id: 'chinese', name: 'Chinese' }, { id: 'nigerian', name: 'Nigerian' },
  { id: 'civil', name: 'Courthouse or civil' }
];
// The id the data uses for "Mixed or our own". traditions.json calls it mixed.
export const OWN_ID = 'mixed';
const OWN_IDS = ['mixed', 'own'];

let traditionsCache;
// Photo and credit for the "Mixed or our own" tile. It is filtered out of the list below, so its photo is kept here.
let ownTile = null;
export async function loadTraditions() {
  if (traditionsCache) return traditionsCache;
  try {
    const res = await fetch('data/traditions.json');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        const own = data.find((t) => t && OWN_IDS.includes(String(t.id)));
        ownTile = own ? { photo: own.photo || null, credit: own.credit || own.photoCredit || null } : null;
        traditionsCache = data.filter((t) => t && t.id && !OWN_IDS.includes(String(t.id))).map((t) => ({ id: String(t.id), name: t.name || t.id, blurb: t.blurb || '', photo: t.photo || null, credit: t.credit || t.photoCredit || null }));
        return traditionsCache;
      }
    }
  } catch { /* the built-in list below */ }
  traditionsCache = TRADITION_FALLBACK.map((t) => ({ ...t, blurb: '', photo: null }));
  return traditionsCache;
}

const TILE_COLORS = ['emerald', 'ocean', 'marigold', 'rose', 'plum', 'teal', 'slate'];

// One tile. `o` is { id or value, name or label, photo?, blurb or sub? }. Selected tiles show a check.
export function styleTileHtml(o, on, k = 0) {
  const id = o.id != null ? o.id : o.value;
  const name = o.name || o.label || String(id);
  const sub = o.blurb || o.sub || '';
  const color = TILE_COLORS[k % TILE_COLORS.length];
  const photo = o.photo || o.image || null;
  const credit = photo ? (o.credit || o.photoCredit || null) : null;
  return `<button type="button" class="style-tile ${photo ? '' : 'no-photo'}" data-id="${esc(id)}" aria-pressed="${on ? 'true' : 'false'}" style="--st-bg: var(--${color})">
    ${photo ? tileImgHtml(photo) : '<span class="st-pattern" aria-hidden="true"></span>'}
    <span class="st-shade" aria-hidden="true"></span>
    ${tileCreditHtml(credit)}
    <span class="st-check" aria-hidden="true">${icon('check')}</span>
    <span class="st-name">${esc(name)}${sub ? `<span class="st-sub">${esc(sub)}</span>` : ''}</span>
  </button>`;
}

// The tile photo: lazy, fades in over the tile color once loaded (see wireStyleGrid).
function tileImgHtml(photo) {
  return `<img src="${esc(photo)}" alt="" loading="lazy" decoding="async">`;
}

// Tiny photographer credit over the photo. Plain text, since a link cannot sit inside the button; the page link is in the title.
function tileCreditHtml(credit) {
  if (!credit || !credit.name) return '';
  return `<span class="st-credit" aria-hidden="true" title="Photo by ${esc(credit.name)} on Unsplash${credit.link ? ` (${esc(credit.link)})` : ''}" style="position:absolute;left:10px;top:10px;z-index:2;max-width:calc(100% - 50px);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:0.58rem;font-weight:500;line-height:1.2;color:#fff;opacity:0.78;text-shadow:0 1px 2px rgba(0,0,0,0.6);pointer-events:none">Photo: ${esc(credit.name)}</span>`;
}

// The whole grid plus the "Mixed or our own" tile and its text box. `picks` is a list of ids.
export function styleGridHtml(list, picks = [], notes = '', { gridId = 'style-grid' } = {}) {
  const own = picks.includes(OWN_ID);
  const shown = list.filter((t) => !OWN_IDS.includes(String(t.id)));
  return `<div class="style-grid" id="${esc(gridId)}" role="group" aria-label="Wedding style">
      ${shown.map((t, k) => styleTileHtml(t, picks.includes(t.id), k)).join('')}
      ${styleTileHtml({ id: OWN_ID, name: 'Mixed or our own', sub: 'Tell us in your words', photo: ownTile ? ownTile.photo : null, credit: ownTile ? ownTile.credit : null }, own, shown.length)}
    </div>
    <label class="field style-own" id="${esc(gridId)}-own" ${own ? '' : 'hidden'}><span>Our own way</span><textarea name="traditionNotes" placeholder="A Catholic mass, then a Nigerian reception with our families' food" rows="2">${esc(notes)}</textarea></label>`;
}

// Fades a tile photo in once it has loaded.
export function wireStyleGrid(root, gridId, picks, onChange) {
  const grid = root.querySelector(`#${gridId}`);
  if (!grid) return;
  const fadeIn = (img) => {
    const show = () => img.classList.add('in');
    if (img.complete && img.naturalWidth) show(); else img.addEventListener('load', show, { once: true });
  };
  grid.querySelectorAll('img').forEach(fadeIn);
  // Tiles built from step options arrive without the credit, and the Mixed tile without its photo. Both live in
  // traditions.json, so fill them in once it is loaded.
  loadTraditions().then((list) => {
    if (!grid.isConnected) return;
    grid.querySelectorAll('.style-tile').forEach((b) => {
      const id = b.dataset.id;
      const t = OWN_IDS.includes(id) ? ownTile : list.find((x) => x.id === id);
      if (!t || !t.photo) return;
      if (!b.querySelector('img')) {
        b.classList.remove('no-photo');
        b.querySelector('.st-pattern')?.remove();
        b.insertAdjacentHTML('afterbegin', tileImgHtml(t.photo));
        fadeIn(b.querySelector('img'));
      }
      const check = b.querySelector('.st-check');
      if (check && !b.querySelector('.st-credit')) check.insertAdjacentHTML('beforebegin', tileCreditHtml(t.credit));
    });
  }).catch(() => {});
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.style-tile'); if (!b) return;
    const id = b.dataset.id;
    const at = picks.indexOf(id);
    if (at >= 0) picks.splice(at, 1); else picks.push(id);
    b.setAttribute('aria-pressed', String(at < 0));
    const ownBox = root.querySelector(`#${gridId}-own`);
    if (ownBox) { ownBox.hidden = !picks.includes(OWN_ID); if (!ownBox.hidden) ownBox.querySelector('textarea')?.focus(); }
    if (onChange) onChange(picks);
  });
}

// ---- The living money buffer: a slider for how much always stays in the bank

export function bufferLineHtml({ id = 'keep', value = 0, max = 10000, suggested = null, hint = '' } = {}) {
  const v = Math.max(0, Math.round(Number(value) || 0));
  const top = Math.max(1000, Math.ceil(Math.max(max, v * 1.5) / 500) * 500);
  return `<div class="buffer-line" id="${esc(id)}-line">
      <div class="bl-head"><span class="bl-lbl">${icon('shield')}Keep this much in your bank</span><span class="bl-amt" id="${esc(id)}-amt">${fmtMoney(v)}</span></div>
      <input type="range" id="${esc(id)}" name="${esc(id)}" min="0" max="${top}" step="50" value="${Math.min(v, top)}" aria-label="Money that always stays in your bank" aria-valuetext="${fmtMoney(v)}">
      <div class="slider-row"><span>nothing set aside</span><span>${fmtMoney(top)}</span></div>
      <p class="tiny">${esc(hint || 'Money for living: rent, food, the car. The wedding never touches it, and Padrino warns before a payment would.')}</p>
      ${suggested != null ? `<span class="bl-pill">${icon('info')}About a month of regular spending is ${fmtMoney(suggested)}</span>` : ''}
    </div>`;
}

export function wireBufferLine(root, id, onChange) {
  const r = root.querySelector(`#${id}`);
  const amt = root.querySelector(`#${id}-amt`);
  if (!r) return () => 0;
  const read = () => Number(r.value) || 0;
  r.addEventListener('input', () => { const n = read(); if (amt) amt.textContent = fmtMoney(n); r.setAttribute('aria-valuetext', fmtMoney(n)); if (onChange) onChange(n); });
  return read;
}

function fmtMoney(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
}

// A calm warning card: the bank balance dipping toward the cushion line. `check` is what
// getBufferCheck() returns: { cash, keep, upcoming, lowest: { date, balanceAfter }, warn, text }.
export function bufferCardHtml(check, { href = '#/payments' } = {}) {
  if (!check || !check.warn) return '';
  const cash = Math.max(0, Number(check.cash) || 0);
  const keep = Math.max(0, Number(check.keep) || 0);
  const low = check.lowest && Number.isFinite(Number(check.lowest.balanceAfter)) ? Number(check.lowest.balanceAfter) : cash;
  const top = Math.max(cash, keep, 1);
  const pct = (n) => Math.max(0, Math.min(100, (n / top) * 100));
  const under = low < keep;
  const when = check.lowest && check.lowest.date ? ` ${relDay(check.lowest.date)}` : '';
  return `<section class="card tint-sand buffer-card" aria-live="polite">
      <div class="card-head"><span class="card-title">Your living money</span><span class="status ${under ? 'bad' : 'warn'}">${icon('warn')}${under ? 'Would dip under' : 'Getting close'}</span></div>
      <p class="bc-line">${esc(check.text || (under ? 'The payments coming up would take your bank below the money you keep for living.' : 'The payments coming up bring your bank close to the money you keep for living.'))}</p>
      <div class="bbar ${under ? 'under' : 'dip'}" role="img" aria-label="Bank balance after upcoming payments against the amount you keep">
        <div class="bb-leave" style="left:${pct(Math.max(0, low))}%;width:${Math.max(0, pct(cash) - pct(Math.max(0, low)))}%"></div>
        <div class="bb-fill" style="width:${pct(Math.max(0, low))}%"></div>
        <span class="bb-keep" style="left:${pct(keep)}%"></span>
      </div>
      <div class="bar-ends"><span><strong>${fmtMoney(Math.max(0, low))}</strong> left${when}</span><span>${fmtMoney(cash)} in the bank now</span></div>
      <div class="row mt"><a class="btn secondary sm" href="${esc(href)}">See the payments</a><a class="text-btn" href="#/step/number">Change what you keep</a></div>
    </section>`;
}

function relDay(iso) {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((d - new Date(new Date().toDateString())) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  return 'by ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Build an element from an HTML string.
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Reads a form into a plain object. Numbers for inputs of type number.
export function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) {
    const input = form.elements[k];
    if (input && input.type === 'number') out[k] = v === '' ? null : Number(v);
    else out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}
