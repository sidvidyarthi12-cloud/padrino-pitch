// Family: padrinos and madrinas as avatar circles. The ring around each one is
// received against pledged. Under the name, the thing they cover. Tap to edit.
// Each person also gets a link to send: the page they open shows the item, the amount and
// how to pay the couple directly (Zelle, Venmo, Cash App). Guests get one shared link that
// lists a few real budget lines they can chip into. The bank confirms when money arrives.

import * as store from '../store.js';
import { getPlan, addPledge, updatePledge, removePledge } from '../store.js';
import { pledgeSummary } from '../calc.js';
import { money, esc, num, plural, initials, names as coupleNames, relative } from '../format.js';
import { icon, ring, share, openSheet, closeSheet, toast, confirmSheet } from '../ui.js';

const TINTS = ['rose', 'emerald', 'ocean', 'marigold', 'plum', 'teal'];

// How the couple gets paid. Set once, used on every link. Handles only, never a password.
const PAY_KEY = 'padrino.pay.v1';
export function getPayHandles() {
  try { return { zelle: '', venmo: '', cashapp: '', ...(JSON.parse(localStorage.getItem(PAY_KEY) || '{}')) }; } catch { return { zelle: '', venmo: '', cashapp: '' }; }
}
export function setPayHandles(h) {
  try { localStorage.setItem(PAY_KEY, JSON.stringify({ zelle: h.zelle || '', venmo: h.venmo || '', cashapp: h.cashapp || '' })); } catch { /* ignore */ }
}
function hasPay(p) { return Boolean(p.zelle || p.venmo || p.cashapp); }

// Links made before the server route is live are kept on this phone so the list still shows them.
const LOCAL_LINKS = 'padrino.give.local';
function localLinks() { try { return JSON.parse(localStorage.getItem(LOCAL_LINKS) || '[]'); } catch { return []; } }
function rememberLocal(link) { try { localStorage.setItem(LOCAL_LINKS, JSON.stringify([link, ...localLinks()].slice(0, 20))); } catch { /* ignore */ } }

export async function render(root) {
  const plan = getPlan();
  let s;
  try { s = pledgeSummary(plan); } catch (e) { console.error(e); s = { pledged: 0, received: 0, outstanding: 0, people: [], withStrings: [] }; }
  const people = s.people;
  const allIn = people.length && Number(s.outstanding) === 0;
  const waiting = people.filter((p) => Number(p.outstanding) > 0).length;
  const links = allLinks();
  const pay = getPayHandles();

  root.innerHTML = `${scopedStyle()}
    <header class="screen-head" data-color="rose">
      <p class="eyebrow">Family · Who is helping</p>
      <h1>Family</h1>
      <p class="lede">Padrinos and madrinas sponsor a piece of the day. Every promise in one place.</p>
    </header>

    ${people.length ? `
    <section class="card">
      <div class="card-head"><span class="card-title">Promised to you</span><span class="status ${allIn ? 'good' : 'warn'}">${icon(allIn ? 'check' : 'info')}${allIn ? 'All in' : `${num(waiting)} still to come`}</span></div>
      <div class="ring-row">
        <div class="ring-wrap">
          ${ring(share(s.received, s.pledged), { size: 96, stroke: 10, cls: 'good', label: 'How much of the promised money has arrived' })}
          <div class="ring-center"><div class="big" style="font-size:1.1rem">${Math.round(share(s.received, s.pledged))}%</div><div class="lbl">in hand</div></div>
        </div>
        <div><div class="answer">${money(s.pledged)}</div><div class="answer-sub">promised by ${num(people.length)} ${plural(people.length, 'person', 'people')}</div></div>
      </div>
    </section>` : ''}

    <div class="people">
      ${people.map((p, i) => person(p, i)).join('')}
      <div class="pcell">
        <button type="button" class="person add" id="add-pledge" aria-label="Add a person">
          <div class="ring-wrap" style="width:80px;height:80px"><div class="av">${icon('plus')}</div></div>
          <div class="p-name">Add a person</div>
        </button>
      </div>
    </div>

    ${people.length === 0 ? `<p class="all-done">Add the people who offered to help and what they said they would cover.</p>` : ''}

    <section class="card tint-peach mt-l" id="guest-card">
      <div class="card-head"><span class="card-title">Guest gifts</span><span class="tiny">toward real costs</span></div>
      <p>Pick a few things guests can chip into. One link lists them all, and the money comes straight to you.</p>
      <div class="gift-picks" id="gift-picks">${giftLines(plan).map((l) => `<label class="gift-pick"><input type="checkbox" value="${esc(l.id)}" ${l.checked ? 'checked' : ''}><span>Help with the ${esc(lower(shortItem(l.item)))}</span><span class="gp-amt">${money(l.planned)}</span></label>`).join('')}</div>
      <div class="row mt">
        <button class="btn" type="button" id="make-guest">Make the guest link</button>
        <button class="text-btn muted" type="button" id="pay-setup">${hasPay(pay) ? 'Change how you get paid' : 'Add how you get paid'}</button>
      </div>
    </section>

    ${links.length ? `<section class="section">
      <div class="section-head"><h2 class="section-title">Links you made</h2><span class="tiny">${num(links.length)}</span></div>
      <div class="card" style="padding:4px 18px">${links.map((l, i) => linkRow(l, i)).join('')}</div>
      <p class="tiny mt-s">When money lands in your account, your bank confirms it and the person shows as in hand. Nothing passes through Padrino.</p>
    </section>` : ''}

    <p class="tiny mt-l">Money with strings is still money. Agree on the say they get before you accept it, not at the first argument.</p>`;

  root.querySelectorAll('[data-pledge]').forEach((b) => b.addEventListener('click', () => openEdit(plan, b.dataset.pledge)));
  root.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', () => sendPadrinoLink(plan, b.dataset.send)));
  root.querySelector('#add-pledge').addEventListener('click', () => openEdit(plan, null));
  root.querySelector('#pay-setup').addEventListener('click', () => openPaySheet(() => render(root)));
  root.querySelector('#make-guest').addEventListener('click', () => {
    const ids = [...root.querySelectorAll('#gift-picks input:checked')].map((i) => i.value);
    if (!ids.length) { toast('Pick at least one thing guests can help with'); return; }
    makeGuestLink(plan, ids, () => render(root));
  });
  root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy, 'Link copied')));
  root.querySelectorAll('[data-share]').forEach((b) => b.addEventListener('click', () => {
    const l = links[Number(b.dataset.share)];
    if (l) shareLink(l.url, l.message || '');
  }));
}

function scopedStyle() {
  return `<style>
    .people > .pcell { display: flex; flex-direction: column; align-items: center; min-width: 0; }
    .people > .pcell .person { width: 100%; }
    .send-link { appearance: none; border: 1px solid var(--line-strong); background: var(--surface); color: var(--text); border-radius: 999px; padding: 5px 10px; font: inherit; font-size: 0.74rem; font-weight: 600; cursor: pointer; margin-top: 2px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
    .send-link:hover { border-color: var(--accent); color: var(--accent); }
    .send-link .ic { width: 12px; height: 12px; }
    .gift-picks { margin-top: 10px; }
    .gift-pick { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 0; border-top: 1px solid var(--line); cursor: pointer; font-size: 0.95rem; }
    .gift-pick:first-child { border-top: 0; }
    .gift-pick input { width: 18px; height: 18px; accent-color: var(--accent); margin: 0; }
    .gift-pick .gp-amt { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 0.85rem; white-space: nowrap; }
    .glink { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 12px 0; border-top: 1px solid var(--line); }
    .glink:first-child { border-top: 0; }
    .glink .gl-t { font-weight: 600; }
    .glink .gl-s { font-size: 0.8rem; color: var(--muted); overflow-wrap: anywhere; }
    .glink .gl-acts { display: flex; gap: 6px; align-items: start; }
    .link-box { display: flex; gap: 8px; align-items: center; background: var(--surface-2); border-radius: 10px; padding: 10px 12px; font-size: 0.85rem; overflow-wrap: anywhere; }
    .link-box .ic { flex: none; color: var(--muted); }
    .msg-box { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; font-size: 0.95rem; line-height: 1.5; overflow-wrap: anywhere; }
  </style>`;
}

function person(p, i) {
  const pct = share(p.received, p.amount);
  const done = Number(p.outstanding) === 0 && Number(p.amount) > 0;
  const word = done ? 'in hand' : Number(p.received) > 0 ? 'part in' : 'promised';
  return `<div class="pcell">
    <button type="button" class="person" data-pledge="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">
      <div class="ring-wrap" style="width:80px;height:80px">
        ${ring(pct, { size: 80, stroke: 6, cls: done ? 'good' : '', label: `${esc(p.name)}: ${Math.round(pct)}% received` })}
        <div class="av" style="background:var(--${TINTS[i % TINTS.length]});color:var(--${TINTS[i % TINTS.length]}-ink)">${esc(initials(p.name))}</div>
      </div>
      <div class="p-name">${esc(p.name)}</div>
      <div class="p-item">${esc(shortItem(p.item) || p.relation || 'help')}</div>
      <div class="p-word ${done ? 'good-text' : 'muted'}">${money(p.amount)} · ${word}${p.hasStrings ? ' · strings' : ''}</div>
    </button>
    ${done ? '' : `<button type="button" class="send-link" data-send="${esc(p.id)}">${icon('arrow')}Send their link</button>`}
  </div>`;
}

function linkRow(l, i) {
  const title = l.kind === 'guest' ? 'Guest gifts' : (l.to ? `For ${l.to}` : 'Padrino link');
  const what = (l.items || []).map((it) => shortItem(it.label)).filter(Boolean).slice(0, 3).join(', ');
  return `<div class="glink">
    <div><div class="gl-t">${esc(title)}${l.preview ? ' <span class="mark">preview</span>' : ''}</div><div class="gl-s">${esc(what)}${l.at ? ' · ' + esc(relative(String(l.at).slice(0, 10))) : ''}</div></div>
    <div class="gl-acts">
      <button class="btn secondary sm" type="button" data-copy="${esc(l.url)}">Copy</button>
      ${navigator.share ? `<button class="btn sm" type="button" data-share="${i}">Share</button>` : `<a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener">Open</a>`}
    </div>
  </div>`;
}

// Budget lines guests can chip into: real costs, biggest first, cushion left out.
function giftLines(plan) {
  const chosen = new Set((plan.giftLineIds || []));
  return (plan.lines || [])
    .filter((l) => l.id !== 'cushion' && Number(l.planned) > 0)
    .sort((a, b) => Number(b.planned) - Number(a.planned))
    .slice(0, 8)
    .map((l) => ({ ...l, checked: chosen.has(l.id) }));
}

function allLinks() {
  let list = [];
  if (typeof store.getGiveLinks === 'function') {
    try { const v = store.getGiveLinks(); if (Array.isArray(v)) list = v.map(normLink); } catch (e) { console.error(e); }
  }
  const seen = new Set(list.map((l) => l.url));
  for (const l of localLinks()) if (!seen.has(l.url)) list.push(l);
  return list.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

function normLink(l) {
  const spec = l.spec || l;
  return {
    id: l.id, kind: spec.kind || l.kind || 'padrino', to: spec.to || l.to || '', items: spec.items || l.items || [],
    url: absolute(l.url || (l.id ? `give.html?id=${encodeURIComponent(l.id)}` : '')), at: l.at || l.createdAt || '', message: l.message || spec.note || ''
  };
}

function absolute(u) { try { return new URL(u, location.href).href; } catch { return u; } }

// Padrino link

async function sendPadrinoLink(plan, pledgeId) {
  const f = (plan.pledges || []).find((x) => x.id === pledgeId);
  if (!f) return;
  const pay = getPayHandles();
  if (!hasPay(pay)) { openPaySheet(() => sendPadrinoLink(plan, pledgeId)); return; }
  const outstanding = Math.max(0, (Number(f.amount) || 0) - (Number(f.received) || 0));
  const item = f.item || (plan.lines.find((l) => l.id === f.lineId)?.item) || 'a piece of the day';
  const what = lower(shortItem(item));
  const spec = {
    kind: 'padrino', to: f.name,
    couple: { names: plan.couple.names, date: plan.couple.weddingDate, city: plan.couple.city },
    items: [{ id: f.id, label: shortItem(item), amount: outstanding || Number(f.amount) || 0, pledgeId: f.id }],
    pay, note: `${f.name}, here is the ${what} we are hoping you can help with.`
  };
  const link = await makeLink(spec);
  if (!link) return;
  link.message = `${f.name}, here is the ${what} we are hoping you can help with: ${link.url}`;
  openShareSheet(link, f.name);
}

async function makeGuestLink(plan, lineIds, after) {
  const pay = getPayHandles();
  if (!hasPay(pay)) { openPaySheet(() => makeGuestLink(plan, lineIds, after)); return; }
  const items = lineIds.map((id) => plan.lines.find((l) => l.id === id)).filter(Boolean)
    .map((l) => ({ id: l.id, label: `Help with the ${lower(shortItem(l.item))}`, amount: Number(l.planned) || 0, lineId: l.id }));
  const spec = {
    kind: 'guest', couple: { names: plan.couple.names, date: plan.couple.weddingDate, city: plan.couple.city },
    items, pay, note: `If you would like to give something, these are the real pieces of our day. Any part of one helps.`
  };
  try { store.update((p) => { p.giftLineIds = lineIds; }); } catch { /* fine */ }
  const link = await makeLink(spec);
  if (!link) return;
  link.message = `${coupleNames(plan)} are getting married. If you would like to give something, this shows the real pieces of the day you can help with: ${link.url}`;
  openShareSheet(link, 'your guests', after);
}

// The store calls POST /api/give and keeps the result. Until that is live, the page can
// render from the link itself (?d=), so the demo still shows the real page.
async function makeLink(spec) {
  if (typeof store.createGiveLink === 'function') {
    try {
      const r = await store.createGiveLink(spec);
      const url = r?.url || (r?.id ? `give.html?id=${encodeURIComponent(r.id)}` : null);
      if (url) return { ...normLink({ ...spec, ...r, url, at: new Date().toISOString() }), preview: false };
    } catch (e) { console.error(e); }
  }
  const url = absolute(`give.html?d=${b64url(JSON.stringify(spec))}`);
  const link = { id: null, kind: spec.kind, to: spec.to || '', items: spec.items, url, at: new Date().toISOString(), preview: true, message: '' };
  rememberLocal(link);
  return link;
}

// Long preview links are shown short on screen. Copy and Share always carry the whole thing.
function shortUrl(u) {
  const s = String(u || '');
  return s.length > 70 ? s.slice(0, 58) + '...' : s;
}

function b64url(s) {
  const b = btoa(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function openShareSheet(link, who, after) {
  const dlg = openSheet(`
    <h2>${link.kind === 'guest' ? 'Your guest link' : `A link for ${esc(who)}`}</h2>
    <div class="link-box">${icon('arrow')}<span>${esc(shortUrl(link.url))}</span></div>
    ${link.preview ? `<p class="tiny mt-s">Preview link: it carries the details itself, so it is long. The short saved link comes when the server part is in.</p>` : ''}
    <div class="row mt">
      <button class="btn" type="button" data-act="copy">Copy link</button>
      ${navigator.share ? `<button class="btn secondary" type="button" data-act="share">Share</button>` : `<a class="btn secondary" href="${esc(link.url)}" target="_blank" rel="noopener">Open it</a>`}
    </div>
    <p class="card-title mt-l">A message to send with it</p>
    <div class="msg-box mt-s" id="msg">${esc(link.preview ? link.message.replace(link.url, shortUrl(link.url)) : link.message)}</div>
    <div class="row mt-s"><button class="text-btn" type="button" data-act="copymsg">Copy the message</button></div>
    <p class="tiny mt-l">When the money lands, your bank confirms it and ${link.kind === 'guest' ? 'it shows under the budget line' : esc(who) + ' shows as in hand'}. Padrino never touches the money.</p>
    <div class="row end mt"><button class="btn secondary" type="button" data-act="done">Done</button></div>`, { onClose: after });
  dlg.querySelector('[data-act="copy"]').addEventListener('click', () => copyText(link.url, 'Link copied'));
  dlg.querySelector('[data-act="copymsg"]').addEventListener('click', () => copyText(link.message, 'Message copied'));
  dlg.querySelector('[data-act="share"]')?.addEventListener('click', () => shareLink(link.url, link.message));
  dlg.querySelector('[data-act="done"]').addEventListener('click', () => dlg.close());
}

async function shareLink(url, text) {
  try { await navigator.share({ title: 'A little help with our wedding', text, url }); } catch { /* cancelled, fine */ }
}

async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg || 'Copied'); } catch { toast('Could not copy. Long press the link instead.'); }
}

// How the couple gets paid

function openPaySheet(after) {
  const pay = getPayHandles();
  const dlg = openSheet(`
    <h2>How family sends you money</h2>
    <p class="muted">Set once. Every link shows these. Add the ones you use.</p>
    <form id="pay-form" class="mt">
      <label class="field"><span>Zelle (the email or phone on your bank)</span><input name="zelle" type="text" value="${esc(pay.zelle)}" placeholder="ana.luis@example.com" autocomplete="off"></label>
      <label class="field"><span>Venmo</span><input name="venmo" type="text" value="${esc(pay.venmo)}" placeholder="@Ana-Luis" autocomplete="off"></label>
      <label class="field"><span>Cash App</span><input name="cashapp" type="text" value="${esc(pay.cashapp)}" placeholder="$AnaLuis" autocomplete="off"></label>
      <p class="tiny">Handles only. Never a password or an account number.</p>
      <div class="row end mt">
        <button class="btn secondary" type="button" data-act="cancel">Cancel</button>
        <button class="btn" type="submit">Save</button>
      </div>
    </form>`);
  dlg.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('#pay-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const next = { zelle: f.zelle.value.trim(), venmo: f.venmo.value.trim(), cashapp: f.cashapp.value.trim() };
    if (!hasPay(next)) { toast('Add at least one way to get paid'); return; }
    setPayHandles(next);
    closeSheet();
    toast('Saved');
    if (after) after();
  });
}

// Edit a person

function openEdit(plan, id) {
  const f = id ? plan.pledges.find((x) => x.id === id) : null;
  const dlg = openSheet(`
    <h2>${f ? esc(f.name) : 'Add a person'}</h2>
    <form id="pledge-form">
      <div class="field-row">
        <label class="field"><span>Name</span><input name="name" type="text" required value="${esc(f?.name || '')}" placeholder="Tia Rosa"></label>
        <label class="field"><span>Relation</span><input name="relation" type="text" value="${esc(f?.relation || '')}" placeholder="Aunt"></label>
      </div>
      <label class="field"><span>What they cover</span>
        <select name="lineId">
          <option value="">Something else</option>
          ${plan.lines.filter((l) => l.id !== 'cushion').map((l) => `<option value="${esc(l.id)}" ${f?.lineId === l.id ? 'selected' : ''}>${esc(shortItem(l.item))}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>Or describe it</span><input name="item" type="text" value="${esc(f?.item || '')}" placeholder="The mariachi"></label>
      <div class="field-row">
        <label class="field"><span>Promised</span><div class="money-input"><input name="amount" type="number" min="0" step="1" required value="${esc(f?.amount ?? '')}"></div></label>
        <label class="field"><span>In hand so far</span><div class="money-input"><input name="received" type="number" min="0" step="1" value="${esc(f?.received ?? 0)}"></div></label>
      </div>
      <label class="field"><span>Any strings</span><input name="strings" type="text" value="${esc(f?.strings || '')}" placeholder="Wants a say on the guest list"></label>
      <div class="row between mt">
        ${f ? `<button class="text-btn" type="button" data-act="remove" style="color:var(--bad)">Remove</button>` : '<span></span>'}
        <span class="row">
          <button class="btn secondary" type="button" data-act="cancel">Cancel</button>
          <button class="btn" type="submit">${f ? 'Save' : 'Add'}</button>
        </span>
      </div>
      ${f ? `<div class="row mt-s"><button class="text-btn" type="button" data-act="send">${icon('arrow')} Send ${esc(f.name)} their link</button></div>` : ''}
    </form>`);
  dlg.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-act="send"]')?.addEventListener('click', () => { dlg.close(); sendPadrinoLink(plan, id); });
  dlg.querySelector('[data-act="remove"]')?.addEventListener('click', async () => {
    dlg.close();
    const ok = await confirmSheet({ title: `Remove ${f.name}?`, body: 'Their pledge comes off the plan.', confirmLabel: 'Remove', danger: true });
    if (ok) removePledge(id);
  });
  dlg.querySelector('#pledge-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const lineId = form.lineId.value || null;
    const lineItem = lineId ? plan.lines.find((l) => l.id === lineId)?.item : '';
    const data = {
      name: form.name.value.trim(), relation: form.relation.value.trim(), lineId,
      item: form.item.value.trim() || lineItem || '',
      amount: Number(form.amount.value) || 0, received: Number(form.received.value) || 0,
      strings: form.strings.value.trim()
    };
    if (f) updatePledge(id, data); else addPledge(data);
    closeSheet();
    toast(f ? 'Saved' : 'Added');
  });
}

function shortItem(s) { return String(s || '').split(/\s[\/(]|\s-\s/)[0].trim(); }
function lower(s) { const t = String(s || ''); return t ? t.charAt(0).toLowerCase() + t.slice(1) : t; }
