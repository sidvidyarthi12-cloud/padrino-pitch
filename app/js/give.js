// The page a padrino or a guest opens from a link. It only reads: the couple's names and date,
// the thing they are hoping for help with, the amount, and how to send it. The money goes
// straight to the couple through their own Zelle, Venmo or Cash App. Padrino never holds it.
//
// /give.html?id=<giveId> reads GET /api/give/<id>. Until that route is live, the couple's side
// can hand over a preview link with ?d=<base64url json> and the page renders that instead.

import { icon } from './ui.js';
import { esc, money, fmtDate, parseDate } from './format.js';

const root = document.getElementById('give');
const params = new URLSearchParams(location.search);

boot();

async function boot() {
  root.innerHTML = `<div class="loading"><span class="spinner" aria-hidden="true"></span><span>Opening.</span></div>`;
  let link = null;
  const id = params.get('id');
  if (id) {
    try {
      const res = await fetch('api/give/' + encodeURIComponent(id));
      if (res.ok) {
        const data = await res.json();
        link = data?.link || data?.give || data;
      }
    } catch { /* fall through to the preview, if any */ }
  }
  if (!link && params.get('d')) link = decodePreview(params.get('d'));
  if (!link || !Array.isArray(link.items)) return renderMissing();
  render(link);
}

function decodePreview(s) {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(Array.from(atob(b64)).map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    return JSON.parse(json);
  } catch { return null; }
}

function renderMissing() {
  root.innerHTML = `
    ${top()}
    <div class="give-empty">
      <h2>This link is not ready yet</h2>
      <p>Ask the couple to send it again. Nothing was charged.</p>
    </div>`;
}

function top() {
  return `<div class="give-top"><a class="wordmark" href="./">Padrino</a><span class="tiny">a little help</span></div>`;
}

function render(link) {
  const couple = link.couple || {};
  const namesText = coupleNames(couple);
  const date = couple.date || couple.weddingDate;
  const d = parseDate(date);
  const when = d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  const guest = link.kind === 'guest' || link.items.length > 1;
  const pay = link.pay || {};
  const hasPay = Boolean(pay.zelle || pay.venmo || pay.cashapp);

  root.innerHTML = `
    ${top()}
    <header class="give-head">
      <p class="eyebrow">${guest ? 'A gift toward the day' : 'A little help for'}</p>
      <h1>${esc(namesText)}</h1>
      ${when ? `<p class="when">${esc(when)}${couple.city ? ' · ' + esc(couple.city) : ''}</p>` : ''}
    </header>

    ${link.note ? `<p class="give-note">${esc(link.note)}</p>` : ''}

    ${guest ? guestList(link.items) : itemCard(link.items[0])}

    <section class="card" id="pay-card">
      <div class="card-head"><span class="card-title">How to send it</span><span class="tiny" id="pay-for">${guest ? 'pick one above' : ''}</span></div>
      ${hasPay ? payRows(pay) : `<p class="muted">The couple has not added how to pay yet. Ask them for their Zelle, Venmo or Cash App.</p>`}
    </section>

    <p class="give-foot">${icon('check')}This goes straight to ${esc(namesText)} through their own app. Padrino never holds the money.<br>Put "${esc(memoFor(link.items[0], namesText))}" in the note so they know what it is for.</p>`;

  // Copy buttons and the guest list
  root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, b)));
  if (guest) {
    const rows = root.querySelectorAll('.give-row');
    const pick = (row) => {
      rows.forEach((r) => r.setAttribute('aria-pressed', String(r === row)));
      const item = link.items.find((it) => String(it.id) === row.dataset.item);
      const forEl = root.querySelector('#pay-for');
      if (forEl) forEl.textContent = item ? 'for ' + lowerFirst(cleanLabel(item.label)) : '';
      const memo = root.querySelector('.give-foot');
      if (memo && item) memo.innerHTML = `${icon('check')}This goes straight to ${esc(namesText)} through their own app. Padrino never holds the money.<br>Put "${esc(memoFor(item, namesText))}" in the note so they know what it is for.`;
      root.querySelector('#pay-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    rows.forEach((row) => row.addEventListener('click', () => pick(row)));
    if (rows[0]) rows[0].setAttribute('aria-pressed', 'true');
  }
}

function coupleNames(couple) {
  const n = Array.isArray(couple.names) ? couple.names.filter(Boolean) : [];
  if (n.length >= 2) return `${n[0]} and ${n[1]}`;
  return n[0] || couple.names || 'the couple';
}

function itemCard(item) {
  if (!item) return '';
  return `<section class="card give-item">
    <div class="art">${icon(artFor(item.label))}</div>
    <div class="what">${esc(cleanLabel(item.label))}</div>
    ${Number(item.amount) > 0 ? `<div class="amt">${money(item.amount)}</div>` : ''}
    <div class="sub">${Number(item.amount) > 0 ? 'is what it costs. Any part of it helps.' : 'Any amount helps.'}</div>
  </section>`;
}

function guestList(items) {
  return `<section class="card give-list" role="group" aria-label="Things you can help with">
    ${items.map((it) => `<div class="give-row" role="button" tabindex="0" aria-pressed="false" data-item="${esc(it.id)}">
      <div class="art">${icon(artFor(it.label))}</div>
      <div><div class="what">${esc(cleanLabel(it.label))}</div><div class="sub">any part of it helps</div></div>
      ${Number(it.amount) > 0 ? `<div class="amt">${money(it.amount)}</div>` : '<span></span>'}
    </div>`).join('')}
  </section>`;
}

function payRows(pay) {
  const rows = [];
  if (pay.zelle) {
    rows.push(payRow('zelle', 'Z', 'Zelle', pay.zelle, null, 'Open your bank app and send to this'));
  }
  if (pay.venmo) {
    const h = String(pay.venmo).replace(/^@/, '').trim();
    const ok = /^[A-Za-z0-9_-]{1,40}$/.test(h);
    rows.push(payRow('venmo', 'V', 'Venmo', '@' + h, ok ? `https://venmo.com/u/${encodeURIComponent(h)}` : null));
  }
  if (pay.cashapp) {
    const h = String(pay.cashapp).replace(/^\$/, '').trim();
    const ok = /^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(h);
    rows.push(payRow('cashapp', '$', 'Cash App', '$' + h, ok ? `https://cash.app/$${encodeURIComponent(h)}` : null));
  }
  return rows.join('');
}

function payRow(cls, letter, name, handle, href, hint) {
  return `<div class="pay-row">
    <div class="logo ${cls}" aria-hidden="true">${letter}</div>
    <div><div class="name">${esc(name)}</div><div class="handle">${esc(handle)}</div>${hint ? `<div class="tiny">${esc(hint)}</div>` : ''}</div>
    <div class="acts">
      <button class="btn secondary sm" type="button" data-copy="${esc(handle)}">Copy</button>
      ${href ? `<a class="btn sm" href="${esc(href)}" target="_blank" rel="noopener">Open</a>` : ''}
    </div>
  </div>`;
}

// Words

function cleanLabel(s) {
  const t = String(s || '').split(/\s[\/(]|\s-\s/)[0].trim();
  if (!t) return 'A piece of the day';
  if (/^(help with|the) /i.test(t)) return t.charAt(0).toUpperCase() + t.slice(1);
  return 'The ' + t.charAt(0).toLowerCase() + t.slice(1);
}

function lowerFirst(s) { const t = String(s || ''); return t ? t.charAt(0).toLowerCase() + t.slice(1) : t; }

function memoFor(item, namesText) {
  const what = item ? lowerFirst(cleanLabel(item.label)).replace(/^help with /, '') : 'the wedding';
  return `${namesText}, ${what}`;
}

function artFor(label) {
  const c = String(label || '').toLowerCase();
  if (c.includes('cake') || c.includes('dessert')) return 'favors';
  if (c.includes('flower') || c.includes('bouquet') || c.includes('floral')) return 'flowers';
  if (c.includes('mariachi') || c.includes('music') || c.includes('dj') || c.includes('band')) return 'music';
  if (c.includes('venue') || c.includes('hall') || c.includes('site')) return 'venue';
  if (c.includes('photo')) return 'photo';
  if (c.includes('video')) return 'video';
  if (c.includes('dress') || c.includes('attire') || c.includes('suit')) return 'dress';
  if (c.includes('ring')) return 'rings';
  if (c.includes('food') || c.includes('cater') || c.includes('dinner')) return 'food';
  if (c.includes('drink') || c.includes('bar')) return 'drinks';
  if (c.includes('honeymoon') || c.includes('trip')) return 'honeymoon';
  if (c.includes('invit')) return 'invitations';
  if (c.includes('hair') || c.includes('makeup')) return 'hair-makeup';
  if (c.includes('decor') || c.includes('light')) return 'decor';
  if (c.includes('rental') || c.includes('chair') || c.includes('table')) return 'events';
  return 'heart';
}

async function copy(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = fallbackCopy(text); }
  const was = btn.textContent;
  btn.textContent = ok ? 'Copied' : 'Could not copy';
  setTimeout(() => { btn.textContent = was; }, 1400);
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
