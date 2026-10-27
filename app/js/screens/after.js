// After the wedding: the paperwork nobody tells you about, in order. Each step says why, how,
// by when, and links the official source. Steps come from /data/after-wedding.json (Builder E).
// Done marks live in the store (getAfterChecklist, toggleAfterItem); until those land they are
// kept on this phone so the list still works.

import * as store from '../store.js';
import { esc, num, plural, daysUntil } from '../format.js';
import { icon, ring, setRing, toast } from '../ui.js';

const LOCAL_KEY = 'padrino.after.local';
let dataCache = null;

export const selfUpdating = true;

export async function render(root, { navigate }) {
  const plan = store.getPlan();
  root.innerHTML = `${scopedStyle()}<div id="after-screen"><div class="loading"><span class="spinner" aria-hidden="true"></span><span>Opening the list.</span></div></div>`;
  const box = root.querySelector('#after-screen');
  const steps = await loadSteps();
  paint(box, plan, steps, navigate);
}

function scopedStyle() {
  return `<style>
    .af-step { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 4px 12px; padding: 14px 0; border-top: 1px solid var(--line); }
    .af-step:first-child { border-top: 0; }
    .af-step .task-check { margin-top: 1px; }
    .af-step.done .af-title { text-decoration: line-through; color: var(--muted); }
    .af-title { font-weight: 600; }
    .af-why { color: var(--muted); font-size: 0.9rem; margin-top: 2px; }
    .af-meta { grid-column: 2; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; }
    .af-more { grid-column: 2; margin-top: 4px; }
    .af-more summary { list-style: none; cursor: pointer; font-size: 0.85rem; font-weight: 600; color: var(--accent); display: inline-flex; align-items: center; gap: 4px; }
    .af-more summary::-webkit-details-marker { display: none; }
    .af-more[open] summary .ic { transform: rotate(90deg); }
    .af-more .ic { width: 14px; height: 14px; transition: transform 150ms ease; }
    .af-how { margin-top: 8px; font-size: 0.92rem; line-height: 1.5; color: var(--text); }
    .af-how ol { padding-left: 1.3em; margin-top: 4px; }
    .af-how li { margin: 3px 0; }
    .af-src { display: inline-flex; align-items: center; gap: 5px; font-size: 0.82rem; margin-top: 8px; }
    .af-src .ic { width: 13px; height: 13px; }
    .af-group { margin-top: 22px; }
    .af-home { background: var(--surface); border-color: var(--ink); display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 14px; align-items: center; }
    .af-home .house { width: 56px; height: 56px; border-radius: 8px; background: var(--emerald); color: var(--emerald-ink); border: 2px solid var(--ink); box-shadow: 2px 2px 0 var(--shadow-ink); display: grid; place-items: center; }
    .af-home .house .ic { width: 28px; height: 28px; }
    .af-home h2 { font-family: var(--font-display); font-size: 1.3rem; font-weight: 800; }
    .af-home p { color: var(--muted); font-size: 0.9rem; margin-top: 4px; }
    .af-home .row { grid-column: 1 / -1; }
  </style>`;
}

async function loadSteps() {
  if (dataCache) return dataCache;
  try {
    const res = await fetch('data/after-wedding.json');
    if (!res.ok) return null;
    const data = await res.json();
    const raw = Array.isArray(data) ? data : Array.isArray(data?.steps) ? data.steps : Array.isArray(data?.items) ? data.items : [];
    dataCache = raw.map(normStep).filter((s) => s.title);
    return dataCache;
  } catch { return null; }
}

function normStep(s, i) {
  const src = s.source || s.link || s.url || null;
  return {
    id: String(s.id || s.key || 'after-' + i),
    title: s.title || s.step || s.name || s.task || '',
    why: s.why || s.reason || '',
    how: s.how || s.steps || s.howTo || '',
    deadline: s.deadline || s.when || s.by || s.due || '',
    group: s.group || s.category || s.section || '',
    sourceUrl: typeof src === 'string' ? src : src?.url || src?.href || '',
    sourceLabel: typeof src === 'object' && src ? (src.label || src.name || '') : (s.sourceLabel || s.sourceName || ''),
    texas: Boolean(s.texas || /texas/i.test(String(s.title || '') + String(s.group || '')))
  };
}

// Done marks: the store when it has them, this phone otherwise.

function doneSet() {
  if (typeof store.getAfterChecklist === 'function') {
    try {
      const v = store.getAfterChecklist();
      const set = new Set();
      if (Array.isArray(v)) {
        for (const x of v) {
          if (typeof x === 'string') set.add(x);
          else if (x && (x.done || x.checked || x.doneAt)) set.add(String(x.id));
        }
      } else if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) if (val && (val === true || val.done || val.doneAt)) set.add(k);
      }
      return { set, local: false };
    } catch (e) { console.error(e); }
  }
  try { return { set: new Set(JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')), local: true }; } catch { return { set: new Set(), local: true }; }
}

function toggle(id, done) {
  if (typeof store.toggleAfterItem === 'function') {
    try { store.toggleAfterItem(id); return; } catch (e) { console.error(e); }
  }
  try {
    const set = new Set(JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'));
    if (done) set.delete(id); else set.add(id);
    localStorage.setItem(LOCAL_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

function paint(box, plan, steps, navigate) {
  const days = daysUntil(plan?.couple?.weddingDate);
  const married = days != null && days < 0;
  if (!steps) {
    box.innerHTML = `
      <header class="screen-head" data-color="slate"><p class="eyebrow">After · The first weeks married</p><h1>After the wedding</h1><p class="lede">Merging money, the name change, insurance, thank-yous, and the hand-off to your first home.</p></header>
      <div class="empty"><h2>The checklist is on its way</h2><p>The steps file (data/after-wedding.json) is still being written. Check back in a bit.</p></div>
      ${homeCard()}`;
    return;
  }
  const { set, local } = doneSet();
  const done = steps.filter((s) => set.has(s.id)).length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const groups = groupBy(steps);
  const allDone = steps.length && done === steps.length;

  box.innerHTML = `
    <header class="screen-head" data-color="slate">
      <p class="eyebrow">After · The first weeks married</p>
      <h1>${married ? 'After the wedding' : 'For after the wedding'}</h1>
      <p class="lede">${married ? 'The paperwork nobody tells you about, in order. Most of it is easier in the first few months.' : 'Nothing to do yet. A look at what comes after the day, so it is not a surprise.'}</p>
    </header>

    <section class="card">
      <div class="card-head"><span class="card-title">Where you are</span><span class="status ${allDone ? 'good' : 'neutral'}" id="af-pill">${icon(allDone ? 'check' : 'info')}${allDone ? 'All done' : `${num(done)} of ${num(steps.length)}`}</span></div>
      <div class="ring-row">
        <div class="ring-wrap">
          ${ring(pct, { size: 96, stroke: 10, cls: 'good', label: 'How much of the after-wedding list is done' })}
          <div class="ring-center"><div class="big" style="font-size:1.1rem" id="af-pct">${pct}%</div><div class="lbl">done</div></div>
        </div>
        <div class="grow">
          <p class="answer-sub" id="af-word">${progressWords(done, steps.length)}</p>
          ${local ? `<p class="tiny mt-s">Ticks are saved on this phone for now.</p>` : ''}
        </div>
      </div>
    </section>

    ${groups.map(([name, list]) => `
      <section class="${name ? 'section af-group' : 'section'}">
        ${name ? `<div class="section-head"><h2 class="section-title">${esc(name)}</h2><span class="tiny">${num(list.filter((s) => set.has(s.id)).length)} of ${num(list.length)}</span></div>` : ''}
        <div class="card" style="padding:4px 18px">${list.map((s) => stepRow(s, set.has(s.id))).join('')}</div>
      </section>`).join('')}

    ${homeCard()}`;

  box.querySelectorAll('[data-after]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.after;
    const was = b.classList.contains('on');
    toggle(id, was);
    const row = b.closest('.af-step');
    row.classList.toggle('done', !was);
    b.classList.toggle('on', !was);
    b.setAttribute('aria-pressed', String(!was));
    const { set: now } = doneSet();
    const d = steps.filter((s) => now.has(s.id)).length;
    const p = steps.length ? Math.round((d / steps.length) * 100) : 0;
    setRing(box.querySelector('.ring'), p);
    box.querySelector('#af-pct').textContent = p + '%';
    box.querySelector('#af-word').textContent = progressWords(d, steps.length);
    const pill = box.querySelector('#af-pill');
    if (pill) {
      const all = d === steps.length;
      pill.className = `status ${all ? 'good' : 'neutral'}`;
      pill.innerHTML = `${icon(all ? 'check' : 'info')}${all ? 'All done' : `${num(d)} of ${num(steps.length)}`}`;
    }
    if (!was) toast('Done');
  }));
  box.querySelector('#af-home-btn')?.addEventListener('click', () => toast('Your first home is next. Same idea: the money, decided before it happens.', 3200));
}

function stepRow(s, done) {
  const how = Array.isArray(s.how) ? `<ol>${s.how.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>` : s.how ? `<p>${esc(s.how)}</p>` : '';
  const hasMore = Boolean(how || s.sourceUrl);
  return `<div class="af-step ${done ? 'done' : ''}">
    <button class="task-check ${done ? 'on' : ''}" type="button" data-after="${esc(s.id)}" aria-pressed="${done}" aria-label="Done: ${esc(s.title)}">${icon('check')}</button>
    <div>
      <div class="af-title">${esc(s.title)}</div>
      ${s.why ? `<div class="af-why">${esc(s.why)}</div>` : ''}
    </div>
    <div class="af-meta">
      ${s.deadline ? `<span class="task-when ${/first|30|60|90|soon|right away|before/i.test(s.deadline) ? 'soon' : ''}">${esc(s.deadline)}</span>` : ''}
      ${s.texas ? `<span class="mark">Texas</span>` : ''}
    </div>
    ${hasMore ? `<details class="af-more">
      <summary>${icon('chevron')}How to do it</summary>
      <div class="af-how">${how}</div>
      ${s.sourceUrl ? `<a class="af-src" href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${icon('arrow')}${esc(s.sourceLabel || 'Official source')}</a>` : ''}
    </details>` : ''}
  </div>`;
}

function homeCard() {
  return `<section class="card af-home mt-l">
    <div class="house">${icon('venue')}</div>
    <div>
      <h2>Your first home</h2>
      <p>Coming next. The same money view for the down payment: what you have, what it needs, and what to decide first.</p>
    </div>
    <div class="row"><button class="btn secondary sm" type="button" id="af-home-btn">Coming next</button></div>
  </section>`;
}

function progressWords(done, total) {
  if (!total) return 'Nothing on the list yet.';
  if (done === 0) return 'Start with the Social Security card. Almost everything else waits on it.';
  if (done === total) return 'That is the whole list. Nicely done.';
  const left = total - done;
  return `${num(left)} ${plural(left, 'step')} to go. Keep the order; the early ones unlock the rest.`;
}

function groupBy(steps) {
  const map = new Map();
  for (const s of steps) {
    const k = s.group || '';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return [...map.entries()];
}
