// Budget: category tiles with an icon and a fill bar each. Tap a tile to see its items.
// The long line list lives one tap down. Forgotten items are a friendly nudge, not a column.

import { getPlan, updateLine, addLine } from '../store.js';
import { getTemplate, getTemplateById } from '../data.js';
import { summary } from '../calc.js';
import { money, moneyRange, esc, uid, num, plural } from '../format.js';
import { icon, catIcon, bar, share, coverPct, coverCaption, openSheet, closeSheet, toast } from '../ui.js';

export async function render(root) {
  const plan = getPlan();
  const template = await getTemplate().catch(() => []);
  const byId = await getTemplateById().catch(() => new Map());
  const s = summary(plan, template);
  const over = Number(s.overBy) > 0;
  const groups = groupLines(plan.lines.filter((l) => byId.get(l.id)?.inBudget !== false && l.id !== 'cushion'), byId, s);
  const forgotten = s.forgottenOpen.map((id) => plan.lines.find((l) => l.id === id)).filter(Boolean);

  root.innerHTML = `
    <header class="screen-head" data-color="emerald">
      <p class="eyebrow">Budget · Your number</p>
      <h1>Budget</h1>
      <p class="lede">Built from your money, not an average. Tap a category to see what is in it.</p>
    </header>

    <section class="card">
      <div class="card-head"><span class="card-title">The whole plan</span><span class="status ${over ? 'bad' : 'good'}">${icon(over ? 'warn' : 'check')}${over ? 'Over by ' + money(s.overBy) : 'On track'}</span></div>
      ${bar(coverPct(s.available, s.needed), { cls: 'tall ' + (over ? 'bad' : 'good'), label: 'How much of the wedding your money covers' })}
      <div class="bar-caption">${coverCaption(s.available, s.needed)}</div>
      <div class="legend mt-s"><span><i style="background:var(--good)"></i>booked ${pctWord(s.committed, s.planned)}</span><span><i style="background:var(--line-strong)"></i>paid ${pctWord(s.paid, s.planned)}</span></div>
    </section>

    ${forgotten.length ? `
    <details class="card tint-sand nudge-card" id="nudge">
      <summary class="nudge"><span class="n-ic">${icon('spark')}</span><span class="grow"><strong>Things couples usually forget</strong><br><span class="tiny">tap to see the top few</span></span></summary>
      <ul class="nudge-list">${forgotten.slice(0, 5).map((l) => `<li><span>${esc(shortItem(l.item))}</span><button class="text-btn" type="button" data-line="${esc(l.id)}">Add a number</button></li>`).join('')}</ul>
    </details>` : ''}

    <div class="cat-grid">
      ${groups.map(catTile).join('')}
    </div>

    <div class="row between mt-l">
      <button class="text-btn" type="button" id="add-line">Add something else</button>
      <span class="tiny">${plan.lines.length} lines in all</span>
    </div>`;

  root.querySelectorAll('[data-cat]').forEach((btn) => btn.addEventListener('click', () => openCategory(groups.find((g) => g.key === btn.dataset.cat), byId)));
  root.querySelectorAll('[data-line]').forEach((btn) => btn.addEventListener('click', (e) => { e.preventDefault(); openEdit(btn.dataset.line, byId); }));
  root.querySelector('#add-line').addEventListener('click', () => openAdd(groups.map((g) => g.category)));
}

// Lines grouped by category, with the share of the plan each category should get (from the template).
function groupLines(lines, byId, s) {
  const map = new Map();
  for (const l of lines) {
    const cat = l.category || 'Other';
    if (!map.has(cat)) map.set(cat, { key: cat.replace(/\W+/g, '-').toLowerCase(), category: cat, lines: [], planned: 0, committed: 0, paid: 0, sharePct: 0, locked: false });
    const g = map.get(cat);
    g.lines.push(l);
    g.planned += Math.max(Number(l.planned) || 0, Number(l.committed) || 0, Number(l.paid) || 0);
    g.committed += Number(l.committed) || 0;
    g.paid += Number(l.paid) || 0;
    if (l.protected) g.locked = true;
    const t = byId.get(l.id);
    if (t && Number(t.sharePct) > 0) g.sharePct += Number(t.sharePct);
  }
  // The share a category "should" get, in dollars of the couple's own money.
  for (const g of map.values()) g.target = g.sharePct > 0 ? (Number(s.available) || 0) * (g.sharePct / 100) : 0;
  return [...map.values()];
}

function catTile(g) {
  const pct = g.target > 0 ? share(g.planned, g.target) : (g.planned > 0 ? 100 : 0);
  const word = g.planned === 0 ? 'nothing yet'
    : g.target === 0 ? 'planned'
      : g.planned > g.target * 1.15 ? 'above the usual share'
        : g.planned < g.target * 0.6 ? 'under the usual share'
          : 'about the usual share';
  const cls = word.startsWith('above') ? 'bad' : word.startsWith('about') ? 'good' : '';
  return `<button type="button" class="cat-tile ${g.locked ? 'locked' : ''}" data-cat="${esc(g.key)}" aria-label="${esc(g.category)}">
    <div class="row between" style="width:100%"><span class="cat-ic">${icon(catIcon(g.category))}</span>${g.locked ? `<span class="lock" title="Protected">${icon('lock')}</span>` : ''}</div>
    <div class="cat-name">${esc(g.category)}</div>
    <div class="cat-amt">${g.planned ? money(g.planned) : '<span class="muted">not set</span>'}</div>
    ${bar(pct, { cls: 'thin ' + (cls === 'bad' ? 'bad' : ''), label: word })}
    <div class="cat-word ${cls}">${word}</div>
  </button>`;
}

function pctWord(part, whole) {
  const p = share(part, whole);
  if (!p) return 'none';
  return Math.round(p) + '%';
}

// One category, one tap down: its lines, each tappable to edit.
function openCategory(g, byId) {
  if (!g) return;
  const dlg = openSheet(`
    <div class="row" style="gap:10px"><span class="cat-ic" style="width:36px;height:36px;display:grid;place-items:center">${icon(catIcon(g.category))}</span><h2 style="margin:0">${esc(g.category)}</h2></div>
    <p class="tiny mt-s">${g.target ? `Couples usually put about ${money(g.target)} of a budget like yours here.` : ''}</p>
    <div class="table mt">
      ${g.lines.map((l) => lineRow(l, byId.get(l.id))).join('')}
    </div>
    <div class="row end mt"><button class="btn secondary" type="button" data-act="close">Close</button></div>`);
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.querySelectorAll('[data-line]').forEach((btn) => btn.addEventListener('click', () => { dlg.close(); openEdit(btn.dataset.line, byId); }));
}

function lineRow(l, t) {
  const subs = [];
  if (l.vendor) subs.push('booked with ' + esc(l.vendor));
  else if (l.forgotten && !l.planned) subs.push('people forget this');
  const nums = [];
  if (l.paid) nums.push('paid ' + money(l.paid));
  return `<button type="button" class="tr" data-line="${esc(l.id)}" aria-label="Edit ${esc(l.item)}">
    <div class="td-main">
      <div class="td-name">${esc(shortItem(l.item))}${l.protected ? `<span class="lock" title="Protected">${icon('lock')}</span>` : ''}</div>
      ${subs.length ? `<div class="td-sub">${subs.join(' · ')}</div>` : ''}
    </div>
    <div class="td-num">
      <div class="num-main ${l.planned ? '' : 'muted'}">${l.planned ? money(Math.max(l.planned, l.committed || 0)) : 'not set'}</div>
      ${nums.length ? `<div class="num-sub">${nums.join('<br>')}</div>` : ''}
    </div>
  </button>`;
}

function typicalText(t) {
  const range = moneyRange(t.typicalLow, t.typicalHigh);
  const unit = t.unit === 'per_guest' ? ' per guest' : t.unit === 'per_hour' ? ' per hour' : '';
  if (!range) return '';
  return `Most couples pay ${range}${unit}`;
}

function openEdit(id, byId) {
  const plan = getPlan();
  const l = plan.lines.find((x) => x.id === id);
  if (!l) return;
  const t = byId.get(id);
  const facts = [];
  if (t?.bookMonthsBefore) facts.push(`Book about ${esc(t.bookMonthsBefore)} months out`);
  if (t?.deposit) facts.push(`Deposit: ${esc(t.deposit)}`);
  const dlg = openSheet(`
    <h2>${esc(shortItem(l.item))}</h2>
    <p class="tiny" style="margin-top:-8px">${esc(l.category)}</p>
    ${t && (t.note || facts.length || typicalText(t)) ? `
      <div class="callout mt mb">
        ${t.note ? `<div>${esc(t.note)}</div>` : ''}
        ${facts.length ? `<div class="tiny mt-s">${facts.join('. ')}.</div>` : ''}
        ${typicalText(t) ? `<details class="more"><summary>Where this comes from</summary><div class="tiny">${esc(typicalText(t))}${t.source ? ` (<a href="${esc(t.source)}" target="_blank" rel="noopener">${esc(t.sourceLabel || 'source')}</a>)` : ''}</div></details>` : ''}
      </div>` : ''}
    <form id="edit-line">
      <div class="field-row">
        <label class="field"><span>Planned</span><div class="money-input"><input name="planned" type="number" min="0" step="1" value="${esc(l.planned || 0)}"></div></label>
        <label class="field"><span>Booked for</span><div class="money-input"><input name="committed" type="number" min="0" step="1" value="${esc(l.committed || 0)}"></div></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Paid so far</span><div class="money-input"><input name="paid" type="number" min="0" step="1" value="${esc(l.paid || 0)}"></div></label>
        <label class="field"><span>Vendor</span><input name="vendor" type="text" value="${esc(l.vendor || '')}" placeholder="Not booked yet"></label>
      </div>
      <label class="check"><input type="checkbox" name="protected" ${l.protected ? 'checked' : ''}> <span>Protect it. The fixer leaves this alone.</span></label>
      <div class="row end mt">
        <button class="btn secondary" type="button" data-act="cancel">Cancel</button>
        <button class="btn" type="submit">Save</button>
      </div>
    </form>`);
  dlg.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('#edit-line').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    updateLine(id, {
      planned: Number(f.planned.value) || 0,
      committed: Number(f.committed.value) || 0,
      paid: Number(f.paid.value) || 0,
      vendor: f.vendor.value.trim() || null,
      protected: f.protected.checked
    });
    closeSheet();
    toast('Saved');
  });
}

function openAdd(categories) {
  const dlg = openSheet(`
    <h2>Add something</h2>
    <form id="add-form">
      <label class="field"><span>What is it</span><input name="item" type="text" required placeholder="Mariachi for the ceremony"></label>
      <label class="field"><span>Category</span>
        <select name="category">${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}<option value="Other">Other</option></select>
      </label>
      <label class="field"><span>Planned</span><div class="money-input"><input name="planned" type="number" min="0" step="1" value="0"></div></label>
      <div class="row end mt">
        <button class="btn secondary" type="button" data-act="cancel">Cancel</button>
        <button class="btn" type="submit">Add</button>
      </div>
    </form>`);
  dlg.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('#add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    addLine({ id: uid('line'), item: f.item.value.trim(), category: f.category.value, planned: Number(f.planned.value) || 0 });
    closeSheet();
    toast('Added');
  });
}

function shortItem(s) { return String(s || '').split(/\s[\/(]|\s-\s/)[0].trim(); }
