// Vendors: browse El Paso vendors the way you browse places to stay. A row of category icons
// at the top, a few filters, then a grid of photo cards. Tap the heart to save one, tap the card
// to read about them and message them. Facts come from /data/vendors.json (another builder's
// file, built from each vendor's own site). Nothing shown here is made up: if a field is missing
// from the data, it is left out. Fictional demo vendors carry a "Demo" mark so nobody mistakes
// them for a real business.
//
// Photos: when the data has the vendor's own website preview image we show that, with a credit
// that links back to their site. When it does not, we show a category photo from photos.js and
// say plainly that it is an example, not the vendor's work.
//
// Availability: we do not have any vendor's calendar. "Ask if they are free" drafts a message
// and opens the thread. Per vendor we keep: not asked, asked, free on your date, booked that
// day. The couple sets the answer from the reply, or the thread reads it from a pasted reply.
//
// Routes: #/vendors (everyone), #/vendors?cat=venues (one category), plus any of
// &saved=1 (saved only), &free=1 (free on your date), &price=1 (has a published price),
// #/vendors?q=mariachi (search), #/vendors/<id> (one vendor).

import * as store from '../store.js';
import { esc, fmtDate, money } from '../format.js';
import { icon, toast, openSheet } from '../ui.js';
import { getPhoto, photoUrl, photoCredit } from '../photos.js';

// This screen repaints itself after a save or an answer, so a store change does not reset the grid.
export const selfUpdating = true;

const DATA_URL = 'data/vendors.json';

// The 14 categories, in the order they show. match words find a vendor's category in the data.
// noun is what the count line calls them: "8 photographers".
export const CATEGORIES = [
  { slug: 'venues', name: 'Venues', icon: 'venue', noun: ['venue', 'venues'], match: ['venue', 'hall', 'ranch', 'estate'] },
  { slug: 'catering', name: 'Catering', icon: 'catering', noun: ['caterer', 'caterers'], match: ['cater', 'food', 'taquer'] },
  { slug: 'photography', name: 'Photography', icon: 'photo', noun: ['photographer', 'photographers'], match: ['photo'] },
  { slug: 'videography', name: 'Videography', icon: 'video', noun: ['videographer', 'videographers'], match: ['video', 'film'] },
  { slug: 'dj-music', name: 'DJ and music', icon: 'music', noun: ['DJ or band', 'DJs and bands'], match: ['dj', 'music', 'band'] },
  { slug: 'mariachi', name: 'Mariachi', icon: 'mariachi', noun: ['mariachi group', 'mariachi groups'], match: ['mariachi'] },
  { slug: 'florists', name: 'Florists', icon: 'flowers', noun: ['florist', 'florists'], match: ['flor', 'flower'] },
  { slug: 'cakes', name: 'Cakes', icon: 'cake', noun: ['bakery', 'bakeries'], match: ['cake', 'baker', 'dessert', 'pastry'] },
  { slug: 'attire', name: 'Attire', icon: 'dress', noun: ['dress and attire shop', 'dress and attire shops'], match: ['dress', 'attire', 'bridal', 'suit', 'tux', 'gown'] },
  { slug: 'hair-makeup', name: 'Hair and makeup', icon: 'scissors', noun: ['hair and makeup artist', 'hair and makeup artists'], match: ['hair', 'makeup', 'beauty', 'salon'] },
  { slug: 'officiants', name: 'Officiants', icon: 'officiant', noun: ['officiant', 'officiants'], match: ['officiant', 'minister', 'ceremony', 'church'] },
  { slug: 'rentals', name: 'Rentals', icon: 'rentals', noun: ['rental company', 'rental companies'], match: ['rental', 'tent', 'linen'] },
  { slug: 'invitations', name: 'Invitations', icon: 'invitations', noun: ['invitation maker', 'invitation makers'], match: ['invit', 'stationery', 'paper', 'print'] },
  { slug: 'transportation', name: 'Transportation', icon: 'transportation', noun: ['transportation company', 'transportation companies'], match: ['transport', 'limo', 'shuttle', 'bus', 'car'] }
];
// Specific words first, so "Mariachi" does not land in music and "cake" does not land in catering.
const MATCH_ORDER = ['mariachi', 'cakes', 'hair-makeup', 'officiants', 'invitations', 'transportation', 'rentals', 'attire', 'florists', 'videography', 'photography', 'dj-music', 'venues', 'catering'];

// The example photo for each category, from photos.js (all credited Unsplash photos). Shown only
// when a vendor has no image of their own, and always labeled as an example.
const CATEGORY_PHOTO = {
  venues: 'venue', catering: 'table', photography: 'couple', videography: 'after', 'dj-music': 'family',
  mariachi: 'mariachi', florists: 'flowers', cakes: 'table', attire: 'desert', 'hair-makeup': 'couple',
  officiants: 'rings', rentals: 'table', invitations: 'rings', transportation: 'desert'
};

// Fictional vendors that match the demo couple. Used when the data file has none of its own.
const FALLBACK_DEMO = [
  { id: 'sample-hall-demo', name: 'Sample Hall (demo)', category: 'Venues', area: 'El Paso', website: null, phone: null, email: null, priceInfo: null, about: 'The hall on the demo couple\'s quote.', source: null, checked: null, demo: true },
  { id: 'sample-photography-demo', name: 'Sample Photography (demo)', category: 'Photography', area: 'El Paso', website: null, phone: null, email: null, priceInfo: null, about: 'The photographer on the demo couple\'s quote.', source: null, checked: null, demo: true }
];

let vendorsCache = null;
let dataState = 'unknown'; // 'ok' | 'missing' | 'unknown'

// Loads the vendor list once. If the file is not there yet, returns the demo vendors only.
export async function loadVendors() {
  if (vendorsCache) return vendorsCache;
  let list = [];
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    list = Array.isArray(data) ? data : (Array.isArray(data?.vendors) ? data.vendors : []);
    dataState = 'ok';
  } catch {
    dataState = 'missing';
  }
  list = list.filter((v) => v && v.name).map((v) => ({ ...v, id: v.id || vendorIdFor(v.name), demo: Boolean(v.demo) }));
  if (!list.some((v) => v.demo)) list = list.concat(FALLBACK_DEMO);
  vendorsCache = list;
  return list;
}

export function vendorIdFor(name) {
  return String(name || 'vendor').toLowerCase().replace(/\(demo\)/g, 'demo').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'vendor';
}

export async function findVendor(id) {
  const list = await loadVendors();
  return list.find((v) => v.id === id) || null;
}

// The category a vendor belongs to, by its category text.
export function categoryOf(vendor) {
  const c = String(vendor?.category || '').toLowerCase();
  for (const slug of MATCH_ORDER) {
    const cat = CATEGORIES.find((x) => x.slug === slug);
    if (cat.match.some((w) => c.includes(w))) return cat;
  }
  return null;
}

export function isDemoVendor(v) {
  return Boolean(v?.demo) || /\(demo\)/i.test(String(v?.name || ''));
}

// Saved vendors live in the store (another builder's piece). Guarded so the screen works without them.
function savedList() {
  if (typeof store.getSavedVendors !== 'function') return [];
  try { return store.getSavedVendors() || []; } catch { return []; }
}
function isSaved(id) { return savedList().some((v) => (v.id || v) === id); }
function canSave() { return typeof store.saveVendor === 'function' && typeof store.unsaveVendor === 'function'; }
function setSaved(vendor, on) {
  if (!canSave()) { toast('Saving vendors is still being finished. Try again in a minute.', 3200); return false; }
  try {
    if (on) store.saveVendor(vendor); else store.unsaveVendor(vendor.id);
    return true;
  } catch (e) { console.error(e); toast('Could not save that'); return false; }
}
function toggleSaved(vendor) {
  const was = isSaved(vendor.id);
  const ok = setSaved(vendor, !was);
  if (ok) toast(was ? 'Removed from saved' : 'Saved');
  return ok;
}

// Availability: what each vendor said about the wedding date. We never guess it.
// An answer about a different date does not count once the date changes.
const AVAIL_KEY = 'padrino.vendors.availability.v1';
export const AVAILABILITY = { none: 'Not asked', asked: 'Asked', free: 'Free on your date', booked: 'Booked that day' };
function availAll() { try { return JSON.parse(localStorage.getItem(AVAIL_KEY) || '{}') || {}; } catch { return {}; } }
export function getAvailability(vendorId, date) {
  const r = availAll()[vendorId];
  if (!r || !AVAILABILITY[r.status]) return 'none';
  if (date && r.date && r.date !== date) return 'none';
  return r.status;
}
export function setAvailability(vendorId, status, date) {
  const all = availAll();
  if (status === 'none' || !AVAILABILITY[status]) delete all[vendorId];
  else all[vendorId] = { status, date: date || null, at: new Date().toISOString() };
  try { localStorage.setItem(AVAIL_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
// Reads a vendor's reply for a plain yes or no about the date. Returns 'free', 'booked' or null.
export function detectAvailability(text) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  const no = /(already (booked|taken|have)|not available|unavailable|no longer (available|open)|(is|are) booked|is taken|date is taken|another (wedding|event) that|can ?not do that date|can't do that date|not open|don't have (that|the) date|do not have (that|the) date)/.test(t);
  if (no) return 'booked';
  const yes = /((is|are|still|date is|dates? are) (open|available|free)|yes,? .*(open|available|free)|available on|free on|have (that|the|your) date open|can do (that|the|your) date|happy to hold (that|the|your) date)/.test(t);
  if (yes) return 'free';
  return null;
}
export function availabilityBadge(status, { small = false } = {}) {
  if (status === 'free') return `<span class="status good ${small ? 'vs-small' : ''}">${icon('check')}Free on your date</span>`;
  if (status === 'booked') return `<span class="status bad ${small ? 'vs-small' : ''}">${icon('close')}Booked that day</span>`;
  if (status === 'asked') return `<span class="status neutral ${small ? 'vs-small' : ''}">${icon('clock')}Asked</span>`;
  return '';
}
// The short badge that sits on a card's photo. Fixed colors, since it sits on a picture in both themes.
function photoBadge(status) {
  if (status === 'free') return `<span class="vg-badge free">${icon('check')}Free on your date</span>`;
  if (status === 'booked') return `<span class="vg-badge booked">${icon('close')}Booked</span>`;
  if (status === 'asked') return `<span class="vg-badge asked">${icon('clock')}Asked</span>`;
  return '';
}

// The question the thread drafts when the couple asks about their date.
export function availabilityChip(plan) {
  const date = plan?.couple?.weddingDate ? fmtDate(plan.couple.weddingDate) : '';
  const guests = Number(plan?.couple?.guests) > 0 ? Number(plan.couple.guests) : null;
  const who = guests ? ` for about ${guests} guests` : '';
  const details = date
    ? `Are you available on ${date}${who}? What is your all-in price?`
    : `We have not locked our date yet. Which dates do you have open next year${who}, and what is your all-in price?`;
  return { goal: 'ask_question', availability: true, label: date ? `Ask if they are free on ${date}` : 'Ask which dates they have open', details, ask: details };
}

// Opens the thread with the availability question already being written.
async function askAboutDate(vendor, plan) {
  try {
    const t = await import('./thread.js');
    if (typeof t.openThreadAsking === 'function') t.openThreadAsking(vendor.id, availabilityChip(plan));
  } catch (e) { console.error(e); }
  location.hash = `#/thread/${encodeURIComponent(vendor.id)}`;
}

// Photos

function hasOwnImage(v) { return Boolean(v?.image) && /^https?:\/\//i.test(String(v.image)); }

// The photo block for a vendor. Their own site preview when there is one, else a category photo
// that says plainly it is an example. Cards show a tiny label; the vendor page shows the credit.
function photoBlock(v, cat, { h = 480, w = 640, example = false, eager = true, credit = false } = {}) {
  if (hasOwnImage(v) && !example) {
    const src = v.imageSource || v.website || v.source || '';
    return `<div class="vs-photo own" data-vid="${esc(v.id)}">
      <img src="${esc(v.image)}" alt="${esc(v.name)}, the preview image from their website" loading="${eager ? 'eager' : 'lazy'}" decoding="async" draggable="false" referrerpolicy="no-referrer">
      ${credit ? `<span class="photo-credit vs-credit">${src ? `<a href="${esc(src)}" target="_blank" rel="noopener">From their website</a>` : 'From their website'}</span>` : ''}
    </div>`;
  }
  const key = CATEGORY_PHOTO[cat?.slug] || 'couple';
  const p = getPhoto(key);
  return `<div class="vs-photo example" style="--tone:${p.tone}" data-vid="${esc(v.id)}">
    <img src="${photoUrl(key, { w, h })}" srcset="${photoUrl(key, { w, h })} 1x, ${photoUrl(key, { w: w * 2, h: h * 2, q: 60 })} 2x" alt="${esc(p.alt)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" draggable="false" style="object-position:${p.pos}">
    <span class="vs-example">${credit ? 'Example photo, not from this vendor' : 'Example photo'}</span>
    ${credit ? photoCredit(key) : ''}
  </div>`;
}

// After the image loads: fade it in, and show a logo (small or very wide) contained on a neutral
// background instead of cropping it like a photo. A broken image falls back to the example photo.
function wirePhotos(root, vendorsById, { credit = false } = {}) {
  root.querySelectorAll('.vs-photo img').forEach((img) => {
    const box = img.closest('.vs-photo');
    const settle = () => {
      img.classList.add('in');
      const w = img.naturalWidth; const h = img.naturalHeight;
      if (box?.classList.contains('own') && w && h && (w < 480 || w / h > 2 || w / h < 0.6)) box.classList.add('logo');
    };
    const fail = () => {
      if (!box || !box.classList.contains('own')) return;
      const v = vendorsById.get(box.dataset.vid);
      if (!v) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = photoBlock(v, categoryOf(v), { example: true, credit });
      const next = wrap.firstElementChild;
      box.replaceWith(next);
      const im = next.querySelector('img');
      if (im.complete && im.naturalWidth) im.classList.add('in'); else im.addEventListener('load', () => im.classList.add('in'), { once: true });
    };
    if (img.complete && img.naturalWidth) settle();
    else if (img.complete && !img.naturalWidth && img.src) fail();
    else { img.addEventListener('load', settle, { once: true }); img.addEventListener('error', fail, { once: true }); }
  });
}

// Scoped styles for the vendor screens. Tokens come from styles.css; nothing here edits it.
const STYLE = `<style id="vs-style">
/* The browse screen is wider than the rest of the app so the grid gets 3 to 4 columns on a laptop.
   overflow is clip, not hidden, so the category bar can stick to the top of the page. */
.layout:has(.vg-browse) { max-width: 1280px; }
main.screen:has(.vg-browse) { max-width: none; overflow-x: clip; }
.vg-browse .screen-head { margin-bottom: 12px; }
.vg-browse .vsearch { max-width: 560px; }

/* Category bar: one row of line icons, scrolls sideways, sticks under the header. */
.vg-top { position: sticky; top: 0; z-index: 5; background: var(--bg); margin: 12px -16px 0; padding: 4px 16px 0; box-shadow: 0 1px 0 var(--line); }
.vg-cats { position: relative; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.vg-cats::-webkit-scrollbar { display: none; }
.vg-cat { flex: none; display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 10px 12px 9px; color: var(--muted); font-size: 0.72rem; font-weight: 600; white-space: nowrap; border-bottom: 2px solid transparent; transition: color 120ms ease, border-color 120ms ease; }
.vg-cat .ic { width: 24px; height: 24px; stroke-width: 1.6; }
.vg-cat:hover { color: var(--text); border-bottom-color: var(--line-strong); }
.vg-cat.on, .vg-cat.on:hover { color: var(--text); border-bottom-color: var(--text); }
.vg-cat:focus-visible { outline-offset: -2px; border-radius: 8px; }

/* Filters and the count line. */
.vg-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 14px; }
.vg-filters .chip { cursor: pointer; }
.vg-filters .chip[aria-pressed="true"] { background: var(--dark-btn); color: var(--dark-btn-ink); border-color: var(--dark-btn); }
.vg-filters .chip[aria-pressed="true"] .ic { color: inherit; }
.vg-count { margin-top: 16px; font-size: 0.95rem; font-weight: 600; }
.vg-count .tiny { font-weight: 400; margin-left: 6px; }

/* The grid. One column on phones, two from 600px, three to four on a laptop. */
.vg-grid { display: grid; grid-template-columns: 1fr; gap: 24px 16px; margin-top: 12px; }
@media (min-width: 600px) { .vg-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 900px) { .vg-grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 28px 18px; } }

/* One card: a photo, then words. The heart is a sibling of the link, so tapping it never navigates. */
.vg-card { position: relative; min-width: 0; }
.vg-link { display: block; color: inherit; border-radius: 16px; }
.vg-link:hover { color: inherit; }
.vg-link:hover .vg-name { text-decoration: underline; text-underline-offset: 3px; }
.vg-photo { position: relative; aspect-ratio: 4 / 3; border-radius: 16px; overflow: hidden; background: var(--surface-2); }
.vg-photo .vs-photo { position: absolute; inset: 0; }
.vs-photo { position: relative; background: var(--tone, var(--surface-2)); overflow: hidden; }
.vs-photo img { display: block; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 400ms ease; pointer-events: none; }
.vs-photo img.in { opacity: 1; }
.vs-photo.logo { background: var(--surface); }
.vs-photo.logo img { object-fit: contain; padding: 12% 14%; }
.vs-example { position: absolute; left: 10px; bottom: 8px; z-index: 1; font-size: 0.64rem; font-weight: 600; color: rgba(255,255,255,0.92); background: rgba(0,0,0,0.42); padding: 3px 8px; border-radius: 999px; backdrop-filter: blur(4px); }
.vs-photo .photo-credit { z-index: 1; }
.vg-badges { position: absolute; top: 10px; left: 10px; z-index: 1; display: flex; gap: 6px; flex-wrap: wrap; max-width: calc(100% - 64px); pointer-events: none; }
.vg-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; background: rgba(255,255,255,0.94); color: #3A4150; box-shadow: 0 1px 2px rgba(0,0,0,0.12); }
.vg-badge .ic { width: 12px; height: 12px; stroke-width: 2.2; }
.vg-badge.free { color: #137A40; }
.vg-badge.booked { color: #B5282A; }
.vg-badge.demo { background: rgba(15,17,21,0.72); color: #fff; }
.vg-heart { position: absolute; top: 4px; right: 4px; z-index: 2; appearance: none; border: 0; background: none; width: 44px; height: 44px; display: grid; place-items: center; cursor: pointer; border-radius: 50%; }
.vg-heart .ic { width: 26px; height: 26px; color: #fff; fill: rgba(15,17,21,0.5); stroke-width: 1.8; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.25)); transition: transform 120ms ease, fill 120ms ease; }
.vg-heart:hover .ic { transform: scale(1.08); }
.vg-heart:active .ic { transform: scale(0.92); }
.vg-heart[aria-pressed="true"] .ic { fill: #E0345A; color: #fff; }
.vg-heart:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }
.vg-body { padding: 10px 2px 0; display: flex; flex-direction: column; gap: 2px; }
.vg-name { font-family: var(--font-display); font-size: 1rem; font-weight: 700; line-height: 1.3; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.vg-area { font-size: 0.86rem; color: var(--muted); }
.vg-about { font-size: 0.86rem; color: var(--muted); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vg-price { font-size: 0.9rem; font-weight: 600; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vg-price.ask { font-weight: 500; color: var(--muted); }
@media (min-width: 600px) { .vg-name { font-size: 0.98rem; } }
@media (min-width: 900px) { .vg-top { margin: 8px -24px 0; padding: 4px 24px 0; } }

/* The vendor page. */
.vp-photo { position: relative; aspect-ratio: 16 / 9; max-height: 360px; border-radius: 18px; overflow: hidden; margin: 6px 0 18px; border: 1px solid var(--line); background: var(--surface-2); }
.vp-photo .vs-photo { position: absolute; inset: 0; }
.vp-photo .vs-photo.logo img { padding: 10% 18%; }
.vp-photo::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 36%; background: linear-gradient(180deg, transparent, rgba(0,0,0,0.38)); pointer-events: none; }
.vp-photo .vs-example, .vp-photo .photo-credit { z-index: 1; }
.vp-photo .vg-badges { top: 12px; left: 12px; }
.vp-avail { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.vp-avail .status { font-size: 0.8rem; }
.btn.is-saved .ic { fill: currentColor; }
.av-choices { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.av-choices button { appearance: none; text-align: left; border: 1px solid var(--line-strong); background: var(--surface); color: var(--text); border-radius: 14px; padding: 12px 14px; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 10px; }
.av-choices button[aria-pressed="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 1.5px var(--accent); background: var(--accent-tint); }
.av-choices button .ic { width: 16px; height: 16px; color: var(--muted); }
.av-choices button .tiny { font-weight: 400; margin-left: auto; }
@media (prefers-reduced-motion: reduce) { .vg-heart .ic, .vg-cat, .vs-photo img { transition: none; } }
</style>`;

function query() {
  const raw = (location.hash || '').split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(raw));
}

export async function render(root, { plan, navigate, id }) {
  const vendors = await loadVendors();
  if (id) return renderVendor(root, { plan, navigate, id, vendors });
  return renderBrowse(root, { plan, vendors, q: query() });
}

// Browse: the category bar, the filters, the grid.

function renderBrowse(root, { plan, vendors, q }) {
  const date = plan?.couple?.weddingDate || null;
  const cat = q.cat ? (CATEGORIES.find((c) => c.slug === q.cat) || null) : null;
  const search = q.q != null ? String(q.q).trim() : '';
  const filters = { saved: q.saved === '1', free: q.free === '1', price: q.price === '1' };

  // Builds a #/vendors link from the current state with some parts changed.
  const linkTo = (over = {}) => {
    const s = { cat: cat?.slug || null, search, ...filters, ...over };
    const p = new URLSearchParams();
    if (s.search) p.set('q', s.search); else if (s.cat) p.set('cat', s.cat);
    if (s.saved) p.set('saved', '1');
    if (s.free) p.set('free', '1');
    if (s.price) p.set('price', '1');
    const str = p.toString();
    return `#/vendors${str ? `?${str}` : ''}`;
  };

  // Who shows: the category or the search, then the filters.
  const pool = search
    ? (() => {
        const words = search.toLowerCase().split(/\s+/).filter(Boolean);
        return vendors.filter((v) => {
          const hay = `${v.name} ${v.category} ${v.area || ''} ${v.about || ''} ${categoryOf(v)?.name || ''}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        });
      })()
    : (cat ? vendors.filter((v) => categoryOf(v)?.slug === cat.slug) : vendors);
  const order = (a, b) => Number(hasOwnImage(b)) - Number(hasOwnImage(a)) || Number(isDemoVendor(a)) - Number(isDemoVendor(b)) || String(a.name).localeCompare(String(b.name));
  const listNow = () => pool
    .filter((v) => !filters.saved || isSaved(v.id))
    .filter((v) => !filters.free || getAvailability(v.id, date) === 'free')
    .filter((v) => !filters.price || Boolean(v.priceInfo))
    .sort(order);
  const byId = new Map(vendors.map((v) => [v.id, v]));

  const countText = (n) => {
    if (search) return `${n} ${n === 1 ? 'match' : 'matches'} for "${search}"`;
    const noun = cat ? cat.noun[n === 1 ? 0 : 1] : (n === 1 ? 'vendor' : 'vendors');
    return `${n} ${filters.saved ? 'saved ' : ''}${noun}${filters.free ? ' free on your date' : ''}${filters.price ? ' with a price' : ''}`;
  };

  const cardHtml = (v, i) => {
    const c = categoryOf(v);
    const demo = isDemoVendor(v);
    const saved = isSaved(v.id);
    const avail = getAvailability(v.id, date);
    const where = [cat ? null : c?.name, v.area].filter(Boolean).join(' · ');
    return `<article class="vg-card" data-id="${esc(v.id)}">
      <a class="vg-link" href="#/vendors/${encodeURIComponent(v.id)}" aria-label="${esc(v.name)}${v.area ? `, ${esc(v.area)}` : ''}">
        <div class="vg-photo">
          ${photoBlock(v, c, { eager: i < 4 })}
          <div class="vg-badges">${demo ? '<span class="vg-badge demo">Demo</span>' : ''}${photoBadge(avail)}</div>
        </div>
        <div class="vg-body">
          <h3 class="vg-name">${esc(v.name)}</h3>
          ${where ? `<p class="vg-area">${esc(where)}</p>` : ''}
          ${v.about ? `<p class="vg-about">${esc(v.about)}</p>` : ''}
          <p class="vg-price ${v.priceInfo ? '' : 'ask'}">${v.priceInfo ? esc(shortPrice(v.priceInfo)) : 'Ask for a price'}</p>
        </div>
      </a>
      <button type="button" class="vg-heart" data-save="${esc(v.id)}" aria-pressed="${saved}" aria-label="${saved ? `Remove ${esc(v.name)} from saved` : `Save ${esc(v.name)}`}">${icon('heart')}</button>
    </article>`;
  };

  const emptyHtml = () => {
    const back = `<a class="btn secondary mt" href="${linkTo({ saved: false, free: false, price: false })}">Show everyone${cat ? ` in ${esc(cat.name.toLowerCase())}` : ''}</a>`;
    if (search && !pool.length) return `<div class="empty"><h2>No match</h2><p>Try a shorter word, or pick a category above.</p><a class="btn secondary mt" href="#/vendors">Browse everyone</a></div>`;
    if (!pool.length) return `<div class="empty"><h2>No ${esc(cat ? cat.name.toLowerCase() : 'vendors')} yet</h2><p>${dataState === 'missing' ? 'The vendor list is still being built from real El Paso websites.' : 'None in this category yet. The list grows as we check more websites.'}</p><a class="btn secondary mt" href="#/vendors">Other categories</a></div>`;
    if (filters.saved) return `<div class="empty"><h2>Nothing saved here yet</h2><p>Tap the heart on a vendor you like. They will wait for you here.</p>${back}</div>`;
    if (filters.free) return `<div class="empty"><h2>Nobody has said yes yet</h2><p>Open a vendor and ask if they are free on your date. When they answer, mark it on their page or in the thread and they show up here.</p>${back}</div>`;
    return `<div class="empty"><h2>No published prices here</h2><p>Most vendors only quote when you ask. Open one and ask for a price.</p>${back}</div>`;
  };

  root.innerHTML = `${STYLE}
    <div class="vg-browse">
      <header class="screen-head" data-color="ocean">
        <p class="eyebrow">Vendors · Near you</p>
        <h1>Vendors</h1>
        ${!cat && !search ? `<p class="lede">El Paso vendors for every part of the day. Save the ones you like, then ask if they are free on your date.</p>` : ''}
      </header>
      ${searchBox(search)}
      ${dataState === 'missing' ? `<p class="callout mt">Real El Paso vendors are on their way. The list is being built from each vendor's own website. For now you can browse the demo vendors.</p>` : ''}
      <div class="vg-top">
        <nav class="vg-cats" id="vg-cats" aria-label="Categories">
          <a class="vg-cat ${!cat && !search ? 'on' : ''}" href="${linkTo({ cat: null, search: '' })}" ${!cat && !search ? 'aria-current="page"' : ''}>${icon('store')}<span>All</span></a>
          ${CATEGORIES.map((c) => `<a class="vg-cat ${cat?.slug === c.slug ? 'on' : ''}" href="${linkTo({ cat: c.slug, search: '' })}" ${cat?.slug === c.slug ? 'aria-current="page"' : ''}>${icon(c.icon)}<span>${esc(c.name)}</span></a>`).join('')}
        </nav>
      </div>
      <div class="vg-filters" role="group" aria-label="Filters">
        <button type="button" class="chip" data-f="saved" aria-pressed="${filters.saved}">${icon('heart')}Saved</button>
        <button type="button" class="chip" data-f="free" aria-pressed="${filters.free}">${icon('check')}Free on our date</button>
        <button type="button" class="chip" data-f="price" aria-pressed="${filters.price}">${icon('card')}Has a price</button>
      </div>
      <p class="vg-count" id="vg-count" aria-live="polite"></p>
      <div id="vg-grid"></div>
      ${pool.some((v) => !isDemoVendor(v)) ? `<p class="tiny mt-l">Facts come from each vendor's own website, with a link on each one. Prices show only when the vendor publishes them. Photos are theirs when their site has one; otherwise an example photo, labeled, with its credit on the vendor's page.</p>` : ''}
    </div>`;

  wireSearch(root);
  root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { location.hash = linkTo({ [b.dataset.f]: !filters[b.dataset.f] }); }));

  // Keep the active category in view in the bar.
  const bar = root.querySelector('#vg-cats');
  const on = bar.querySelector('.vg-cat.on');
  if (on) bar.scrollLeft = Math.max(0, on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2);

  const grid = root.querySelector('#vg-grid');
  const count = root.querySelector('#vg-count');
  const paintGrid = () => {
    const list = listNow();
    count.textContent = countText(list.length);
    grid.className = list.length ? 'vg-grid' : '';
    grid.innerHTML = list.length ? list.map(cardHtml).join('') : emptyHtml();
    wirePhotos(grid, byId);
    grid.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const v = byId.get(b.dataset.save);
      if (!v || !toggleSaved(v)) return;
      // With the Saved filter on, the card leaves the grid. Otherwise only the heart changes.
      if (filters.saved) { paintGrid(); return; }
      const now = isSaved(v.id);
      b.setAttribute('aria-pressed', String(now));
      b.setAttribute('aria-label', now ? `Remove ${v.name} from saved` : `Save ${v.name}`);
    }));
  };
  paintGrid();
}

// The published price without its "(their site)" source note, for the card. The full text is on the vendor page.
function shortPrice(s) {
  return String(s || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function searchBox(value) {
  return `<form class="vsearch" id="vsearch" role="search">
    ${icon('search')}
    <label class="sr-only" for="vsearch-input">Search vendors</label>
    <input id="vsearch-input" type="search" name="q" placeholder="Search by name or kind" value="${esc(value)}" autocomplete="off">
  </form>`;
}

function wireSearch(root) {
  const form = root.querySelector('#vsearch');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = form.q.value.trim();
    location.hash = q ? `#/vendors?q=${encodeURIComponent(q)}` : '#/vendors';
  });
}

// One vendor.

async function renderVendor(root, { plan, navigate, id, vendors }) {
  let v = vendors.find((x) => x.id === id) || null;
  // A vendor that only exists in the couple's quotes (typed or decoded) still gets a page.
  if (!v) {
    const q = (plan.quotes || []).find((x) => vendorIdFor(x.vendor) === id);
    if (q) v = { id, name: q.vendor, category: q.category || '', area: null, about: null, website: null, phone: null, email: null, priceInfo: null, source: null, demo: /\(demo\)/i.test(q.vendor), fromQuote: true };
  }
  if (!v) {
    root.innerHTML = `<header class="screen-head vhead"><a class="icon-btn" href="#/vendors" aria-label="Vendors">${icon('back')}</a><h1>Vendor</h1></header>
      <div class="empty"><h2>We could not find that vendor</h2><p>It may have been renamed or removed from the list.</p><a class="btn secondary mt" href="#/vendors">Browse vendors</a></div>`;
    return;
  }
  const cat = categoryOf(v);
  const demo = isDemoVendor(v);
  const quote = quoteFor(plan, v);
  const line = quote ? (plan.lines.find((l) => l.quoteId === quote.id) || plan.lines.find((l) => sameVendor(l.vendor, v.name))) : plan.lines.find((l) => sameVendor(l.vendor, v.name));
  const due = line ? plan.payments.filter((p) => p.lineId === line.id && p.status !== 'paid') : [];
  const contract = contractFor(v);
  const thread = threadFor(v.id);
  const back = cat ? `#/vendors?cat=${cat.slug}` : '#/vendors';
  const date = plan?.couple?.weddingDate || null;
  const chip = availabilityChip(plan);

  const paint = () => {
    const saved = isSaved(v.id);
    const avail = getAvailability(v.id, date);
    root.innerHTML = `${STYLE}
      <header class="screen-head vhead" data-color="ocean">
        <a class="icon-btn" href="${back}" aria-label="Back">${icon('back')}</a>
        <div class="grow">
          <p class="eyebrow">${esc([cat?.name, v.area].filter(Boolean).join(' · ') || 'Vendor')}</p>
          <h1>${esc(v.name)}</h1>
        </div>
      </header>
      ${!v.fromQuote ? `<div class="vp-photo">${photoBlock(v, cat, { w: 1200, h: 675, credit: true })}<div class="vg-badges">${demo ? '<span class="vg-badge demo">Demo</span>' : ''}${photoBadge(avail)}</div></div>` : ''}
      ${demo ? `<p class="callout mb"><strong>Demo vendor.</strong> A made up business for the demo couple. Messages here get a labeled demo reply.</p>` : ''}
      ${v.about ? `<p class="vabout">${esc(v.about)}</p>` : ''}
      ${v.priceInfo ? `<p class="vprice">${icon('info')} ${esc(v.priceInfo)}</p>` : `<p class="vprice">${icon('info')} No published price. Ask them.</p>`}
      <div class="row mt">
        <a class="btn lg" href="#/thread/${encodeURIComponent(v.id)}">${icon('chat')} ${thread.length ? 'Open messages' : 'Message them'}</a>
        <button class="btn secondary ${saved ? 'is-saved' : ''}" type="button" id="save" aria-pressed="${saved}">${icon('heart')} ${saved ? 'Saved' : 'Save'}</button>
      </div>
      ${thread.length ? `<p class="tiny mt-s">${thread.length} ${thread.length === 1 ? 'message' : 'messages'} so far.</p>` : ''}

      <section class="section">
        <div class="section-head"><h2 class="section-title">Your date</h2></div>
        <p class="muted">${date ? `We do not have their calendar. Ask them, then mark what they said.` : 'Set your wedding date in the plan, then ask them if they are free.'}</p>
        <div class="vp-avail">
          ${avail === 'none' ? `<span class="status neutral">Not asked</span>` : availabilityBadge(avail)}
          <button class="btn sm ${avail === 'none' ? '' : 'secondary'}" type="button" id="ask-date">${icon('calendar')} ${esc(avail === 'none' ? chip.label : 'Ask again')}</button>
          <button class="text-btn" type="button" id="set-avail">${avail === 'none' ? 'They already answered' : 'Change'}</button>
        </div>
      </section>

      ${(v.website || v.phone || v.email) ? `
      <section class="section">
        <div class="section-head"><h2 class="section-title">Reach them</h2></div>
        <div class="vcontact">
          ${v.website ? `<a href="${esc(v.website)}" target="_blank" rel="noopener">${icon('globe')}<span>${esc(hostOf(v.website))}</span>${icon('external', 'ext')}</a>` : ''}
          ${v.phone ? `<a href="tel:${esc(String(v.phone).replace(/[^\d+]/g, ''))}">${icon('phone')}<span>${esc(v.phone)}</span></a>` : ''}
          ${v.email ? `<a href="mailto:${esc(v.email)}">${icon('mail')}<span>${esc(v.email)}</span></a>` : ''}
        </div>
      </section>` : (!demo && !v.fromQuote ? `<p class="tiny mt">No contact details on their site yet.</p>` : '')}

      ${(quote || line || contract) ? `
      <section class="section">
        <div class="section-head"><h2 class="section-title">With you</h2></div>
        ${quote || line ? `<div class="card" style="margin-top:4px">
          <div class="card-head"><span class="card-title">${quote ? 'Their quote' : 'Budget line'}</span>${line && Number(line.committed) > 0 ? `<span class="status good">${icon('check')}booked</span>` : ''}</div>
          ${line ? `<p>${esc(shortItem(line.item))}${Number(line.committed) > 0 ? `, ${money(line.committed)} booked` : ''}${Number(line.paid) > 0 ? `, ${money(line.paid)} paid so far` : ''}.</p>` : ''}
          ${due.length ? `<p class="muted mt-s">${due.length} ${due.length === 1 ? 'payment' : 'payments'} still to come.</p>` : ''}
          <div class="row mt-s">
            ${quote ? `<a class="text-btn" href="#/quotes">See the quote</a>` : ''}
            ${due.length ? `<a class="text-btn" href="#/payments">Payments</a>` : ''}
            <a class="text-btn" href="#/budget">Budget</a>
          </div>
        </div>` : ''}
        ${contract ? `<div class="card" style="margin-top:10px">
          <div class="card-head"><span class="card-title">Contract</span><span class="status good">${icon('check')}checked</span></div>
          <p>You ran their contract through the contract check.</p>
          <div class="row mt-s"><a class="text-btn" href="#/contract">Open the contract check</a></div>
        </div>` : ''}
      </section>` : ''}

      ${!demo && (v.source || v.checked) ? `<p class="tiny mt-l vsource">${v.source ? `<a href="${esc(v.source)}" target="_blank" rel="noopener">From their website</a>` : 'From their website'}${v.checked ? `, checked ${esc(fmtDate(v.checked))}` : ''}. We only show what they publish.${hasOwnImage(v) ? ' The photo is the preview image from their own site.' : ' The photo is an example, not their work.'}</p>` : ''}`;

    wirePhotos(root, new Map([[v.id, v]]), { credit: true });
    root.querySelector('#save').addEventListener('click', () => { if (toggleSaved(v)) paint(); });
    root.querySelector('#ask-date').addEventListener('click', () => askAboutDate(v, plan));
    root.querySelector('#set-avail').addEventListener('click', () => openAvailabilitySheet(v, plan, paint));
  };
  paint();
}

// A small sheet to record what the vendor said about the date. Shared with the thread screen.
export function openAvailabilitySheet(vendor, plan, onChange) {
  const date = plan?.couple?.weddingDate || null;
  const cur = getAvailability(vendor.id, date);
  const when = date ? fmtDate(date) : 'your date';
  const dlg = openSheet(`
    <h2>What did ${esc(vendor.name)} say?</h2>
    <p class="muted">About ${esc(when)}. Only you set this; we never guess it.</p>
    <div class="av-choices" role="group" aria-label="Their answer">
      <button type="button" data-av="free" aria-pressed="${cur === 'free'}">${icon('check')}Free on our date</button>
      <button type="button" data-av="booked" aria-pressed="${cur === 'booked'}">${icon('close')}Booked that day</button>
      <button type="button" data-av="asked" aria-pressed="${cur === 'asked'}">${icon('clock')}Asked, waiting<span class="tiny">no answer yet</span></button>
      <button type="button" data-av="none" aria-pressed="${cur === 'none'}">${icon('info')}Not asked</button>
    </div>`);
  dlg.querySelectorAll('[data-av]').forEach((b) => b.addEventListener('click', () => {
    setAvailability(vendor.id, b.dataset.av, date);
    dlg.close();
    toast(b.dataset.av === 'free' ? 'Marked free on your date' : b.dataset.av === 'booked' ? 'Marked booked that day' : 'Updated');
    if (onChange) onChange();
  }));
}

// Helpers shared with the thread screen.

export function sameVendor(a, b) {
  const n = (s) => String(s || '').toLowerCase().replace(/\(demo\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const x = n(a); const y = n(b);
  return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x));
}

export function quoteFor(plan, vendor) {
  if (!plan || !vendor) return null;
  return (plan.quotes || []).find((q) => sameVendor(q.vendor, vendor.name)) || null;
}

function contractFor(vendor) {
  if (typeof store.getContracts !== 'function') return null;
  try {
    const all = store.getContracts();
    if (Array.isArray(all)) return all.find((c) => sameVendor(c.vendorName || c.vendor || c.analysis?.vendor, vendor.name)) || null;
    if (all && typeof all === 'object') {
      const key = Object.keys(all).find((k) => sameVendor(k, vendor.name));
      return key ? all[key] : null;
    }
  } catch { /* not ready */ }
  return null;
}

function threadFor(vendorId) {
  if (typeof store.getThread !== 'function') return [];
  try { return store.getThread(vendorId) || []; } catch { return []; }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url).replace(/^https?:\/\/(www\.)?/, ''); }
}

function shortItem(s) { return String(s || '').split(/\s[\/(]|\s-\s/)[0].trim(); }
