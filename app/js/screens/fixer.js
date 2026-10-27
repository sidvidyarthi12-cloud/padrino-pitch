// Fixer: a gap bar at the top. Tick a cut and the bar fills toward "covered".
// A lever card for cutting subscriptions that leads to Find money. A mini slider for inviting
// fewer guests. Protected lines are left alone and say so. Tap "why" on a cut for the lesson
// behind it and links to the real sources.
// All amounts come from money.js suggestCuts and /lib/bank.js; this screen only adds up what you ticked.

import * as store from '../store.js';
import { getTemplate, getCuts, getLessonsById } from '../data.js';
import { summary, suggestCuts } from '../calc.js';
import { monthlyFreed, freedByWedding } from '../../lib/bank.js';
import * as subs from '../subs.js';
import { money, moneyRange, esc, num } from '../format.js';
import { icon, bar, setBar, share, toast } from '../ui.js';

const CSS = `
.fx-why { appearance: none; border: 0; background: none; padding: 6px 0 6px 6px; color: var(--accent); font: inherit; font-size: 0.82rem; font-weight: 600; cursor: pointer; }
.fx-why:hover { color: var(--accent-hover); }
.fx-why[aria-expanded="true"] { color: var(--muted); }
.fx-panel { grid-column: 2 / -1; margin-top: 8px; padding: 12px 14px; border-radius: var(--radius-s); background: var(--surface-2); font-size: 0.9rem; display: grid; gap: 8px; }
.fx-panel p { margin: 0; }
.fx-panel .fx-read { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; }
.fx-panel .fx-read b { font-weight: 600; color: var(--muted); }
.fx-panel .fx-read a { font-weight: 600; }
.fx-panel .fx-seen { font-size: 0.76rem; color: var(--muted); }
.fx-lever .answer { font-size: 1.7rem; }
`;

function ensureStyle() {
  if (document.getElementById('fx-style')) return;
  const st = document.createElement('style');
  st.id = 'fx-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

export async function render(root) {
  ensureStyle();
  const plan = store.getPlan();
  const [template, cuts, lessons] = await Promise.all([
    getTemplate().catch(() => []),
    getCuts().catch(() => null),
    getLessonsById().catch(() => new Map())
  ]);
  const s = summary(plan, template);
  const over = Number(s.overBy) > 0;
  const gap = over ? Number(s.overBy) : 0;

  if (!cuts) {
    root.innerHTML = `<header class="screen-head"><h1>Fixer</h1></header><p class="callout">The cuts file did not load, so there is nothing to rank yet.</p>`;
    return;
  }

  let r;
  try { r = suggestCuts(plan, cuts, gap, template); }
  catch (e) { console.error(e); r = { cuts: [], guestsToCut: null, protectedLines: [], needMore: false, coversLow: 0, coversHigh: 0, perGuestSaved: 0 }; }

  const safeCuts = r.cuts.filter((c) => !c.lastResort);
  const lastResort = r.cuts.filter((c) => c.lastResort);
  const guests = Number(plan.couple.guests) || 0;
  const perGuest = Number(r.perGuestSaved) || 0;
  const maxFewer = Math.max(0, Math.min(guests - 10, Math.round(guests * 0.5)));
  const lever = subsLever(plan, s);

  root.innerHTML = `
    <header class="screen-head" data-color="teal">
      <p class="eyebrow">Fixer · Close the gap</p>
      <h1>${over ? 'Close the gap' : 'Nothing to fix'}</h1>
      <p class="lede">${over ? 'Tick what you could live without and watch the gap close. Your protected lines stay out of it.' : 'You are inside your money. Here is where the room would come from if you ever need it.'}</p>
    </header>

    <section class="card" aria-live="polite">
      <div class="card-head"><span class="card-title">${over ? 'The gap' : 'Room you could make'}</span><span id="gap-pill">${over ? `<span class="status bad">${icon('warn')}${money(gap)} short</span>` : `<span class="status good">${icon('check')}On track</span>`}</span></div>
      ${bar(0, { cls: 'tall good', label: 'How much of the gap your picks cover' })}
      <div class="bar-ends"><span id="covered-word">nothing picked yet</span><span>${over ? 'covered' : ''}</span></div>
    </section>

    ${leverHtml(lever)}

    ${perGuest > 0 && maxFewer > 0 ? `
    <section class="card">
      <div class="card-head"><span class="card-title">Or invite fewer guests</span><span class="tiny" id="fewer-word">everyone stays</span></div>
      <input type="range" id="fewer" min="0" max="${maxFewer}" step="1" value="0" aria-label="Guests not invited">
      <div class="slider-row"><span>${num(guests)} guests</span><span>${num(guests - maxFewer)} guests</span></div>
      <p class="tiny mt-s">Food, drinks, cake and rentals move with the headcount. The biggest lever there is.</p>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2 class="section-title">${over ? 'Cuts, least regret first' : 'Easy cuts'}</h2></div>
      <div class="card" style="padding:4px 18px">
        ${safeCuts.length ? safeCuts.map((c) => cutRow(c, lessons, false)).join('') : `<p class="all-done">No cuts to suggest that leave your protected lines alone.</p>`}
      </div>
    </section>

    ${lastResort.length ? `
    <section class="section">
      <div class="section-head"><h2 class="section-title bad">Last resort</h2></div>
      <p class="section-text mb">You protected these, or couples often regret cutting them.</p>
      <div class="card" style="padding:4px 18px">${lastResort.map((c) => cutRow(c, lessons, true)).join('')}</div>
    </section>` : ''}

    ${r.protectedLines.length ? `<p class="callout mt-l">${icon('lock')} Left alone because you said they matter most: <strong>${r.protectedLines.map((l) => esc(shortItem(l.item))).join(', ')}</strong>.</p>` : ''}`;

  // Tick cuts and slide guests. The bar and the words move; nothing is saved to the plan.
  const barEl = root.querySelector('.fillbar');
  const picked = new Set();
  let fewer = 0;

  function covered() {
    let total = 0;
    for (const c of r.cuts) if (picked.has(c.id)) total += Number(c.saveHigh ?? c.saveLow ?? 0);
    total += fewer * perGuest;
    return total;
  }

  function repaint() {
    const cov = covered();
    const pct = over ? share(cov, gap) : (cov > 0 ? 100 : 0);
    setBar(barEl, pct);
    const closed = over && cov >= gap;
    barEl.setAttribute('class', 'fillbar tall ' + (closed || !over ? 'good' : 'warn'));
    const word = root.querySelector('#covered-word');
    const pill = root.querySelector('#gap-pill');
    paintLever(Math.max(0, gap - cov), cov);
    if (!over) {
      word.textContent = cov > 0 ? `${money(cov)} of room` : 'nothing picked yet';
      return;
    }
    if (cov <= 0) { word.textContent = 'nothing picked yet'; pill.innerHTML = `<span class="status bad">${icon('warn')}${money(gap)} short</span>`; }
    else if (closed) { word.textContent = 'that does it'; pill.innerHTML = `<span class="status good">${icon('check')}Covered</span>`; }
    else { word.textContent = `${money(gap - cov)} still to find`; pill.innerHTML = `<span class="status warn">${icon('info')}Getting there</span>`; }
  }

  // The subscriptions card reads the gap that is left after your other picks.
  function paintLever(left) {
    const note = root.querySelector('#lever-note');
    if (!note || lever.state !== 'open' || !over) return;
    if (left <= 0) note.textContent = 'Your other picks already close the gap. This is extra room.';
    else if (lever.byWedding >= left) note.textContent = 'This alone would close what is left.';
    else note.textContent = 'This covers part of what is left.';
  }

  root.querySelectorAll('[data-cut]').forEach((row) => {
    const btn = row.querySelector('.task-check');
    btn.addEventListener('click', () => {
      const id = row.dataset.cut;
      if (picked.has(id)) { picked.delete(id); btn.classList.remove('on'); }
      else { picked.add(id); btn.classList.add('on'); }
      repaint();
    });
    // The "why" panel: the lesson behind the cut and where it comes from.
    const why = row.querySelector('.fx-why');
    const panel = row.querySelector('.fx-panel');
    if (why && panel) {
      why.addEventListener('click', () => {
        const open = panel.hidden;
        panel.hidden = !open;
        why.setAttribute('aria-expanded', String(open));
        why.textContent = open ? 'hide' : 'why';
      });
    }
  });

  const slider = root.querySelector('#fewer');
  if (slider) {
    slider.addEventListener('input', () => {
      fewer = Number(slider.value) || 0;
      root.querySelector('#fewer-word').textContent = fewer ? `${num(fewer)} fewer, ${num(guests - fewer)} come` : 'everyone stays';
      repaint();
    });
  }
  repaint();
  if (over && r.guestsToCut && r.guestsToCutPossible && !safeCuts.length) toast(`${num(r.guestsToCut)} fewer guests would close it`);
}

// Subscriptions lever. Freed money a month times the months left, from /lib/bank.js. The plan's
// money.freedMonthly is what is already applied, so only the rest counts as new.
function subsLever(plan, s) {
  const bank = store.getBankData();
  if (!bank) return { state: 'connect' };
  const { go } = subs.splitSubs(bank.recurring || [], bank.transactions || []);
  const potential = monthlyFreed(go);
  const applied = Number(plan.money.freedMonthly) || 0;
  const months = s.monthsLeft;
  if (applied > 0 && applied >= potential - 0.005) {
    return { state: 'applied', applied, byWedding: freedByWedding(applied, months) };
  }
  const extra = Math.round((potential - applied) * 100) / 100;
  if (!(extra > 0)) return { state: 'none' };
  return { state: 'open', monthly: extra, byWedding: freedByWedding(extra, months), applied, count: go.length };
}

function leverHtml(l) {
  const head = `<div class="card-head"><span class="card-title">Cut subscriptions</span></div>`;
  if (l.state === 'connect') {
    return `<section class="card tint-sage fx-lever">${head}
      <p>Most couples pay for a few things they forgot about. Connect your bank and we will show you which ones.</p>
      <a class="btn mt" href="#/find-money">Find money</a>
    </section>`;
  }
  if (l.state === 'none') {
    return `<section class="card tint-sage fx-lever">${head}
      <p>Nothing is marked as optional yet. Look through your repeat charges and move any you could drop.</p>
      <a class="btn mt" href="#/find-money">Find money</a>
    </section>`;
  }
  if (l.state === 'applied') {
    return `<section class="card tint-sage fx-lever">${head}
      <div class="answer">${money(l.byWedding)}</div>
      <div class="answer-sub">by the wedding, from subscriptions you cut</div>
      <p class="muted mt-s">${money(l.applied)} a month already goes to the wedding.</p>
      <a class="btn secondary mt" href="#/find-money">Review in Find money</a>
    </section>`;
  }
  return `<section class="card tint-sage fx-lever">${head}
    <div class="answer">up to ${money(l.byWedding)}</div>
    <div class="answer-sub">by the wedding</div>
    <p class="muted mt-s" id="lever-note">Cancel what you do not use. The wedding gets that money every month.</p>
    <a class="btn mt" href="#/find-money">Find money</a>
  </section>`;
}

// Links in a lesson. Some were only seen in a search summary and could not be opened. Say so.
function linkHtml(l) {
  const seenOnly = Boolean(l.summaryOnly);
  let label = String(l.label || l.url || '');
  if (seenOnly) label = label.replace(/,?\s*summary only/i, '').replace(/\s*\(\s*\)/, '').trim();
  const a = `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  const notes = [seenOnly ? 'seen in a search summary only' : '', l.note ? String(l.note) : ''].filter(Boolean);
  return `<span>${a}${notes.length ? ` <span class="fx-seen">${esc(notes.join('. '))}</span>` : ''}</span>`;
}

function whyHtml(c, lesson) {
  const parts = [];
  if (lesson && lesson.text) parts.push(`<p>${esc(lesson.text)}</p>`);
  if (lesson && lesson.problem) parts.push(`<p><strong>The problem:</strong> ${esc(lesson.problem)}</p>`);
  if (c.example) parts.push(`<p class="muted">${esc(c.example)}</p>`);
  const links = lesson && Array.isArray(lesson.links) ? lesson.links.filter((l) => l && l.url) : [];
  // Sources we opened and read come first.
  links.sort((a, b) => Number(Boolean(a.summaryOnly)) - Number(Boolean(b.summaryOnly)));
  if (links.length) parts.push(`<p class="fx-read"><b>Read more</b>${links.map(linkHtml).join('')}</p>`);
  if (!parts.length) return '';
  return parts.join('');
}

function cutRow(c, lessons, locked) {
  const regret = String(c.regret || '').toLowerCase();
  const word = regret === 'low' ? 'rarely regretted' : regret === 'medium' ? 'some regret it' : regret === 'high' ? 'often regretted' : '';
  const saves = c.saveLow != null || c.saveHigh != null ? moneyRange(c.saveLow, c.saveHigh) : '';
  const lesson = c.lesson ? lessons.get(Number(c.lesson)) : null;
  const why = whyHtml(c, lesson);
  const sub = [word, c.protected ? 'protected' : ''].filter(Boolean).join(' · ');
  return `<div class="cut ${locked ? 'locked' : ''}" data-cut="${esc(c.id)}">
    <button class="task-check" type="button" aria-label="Pick: ${esc(c.title)}">${icon('check')}</button>
    <div class="cut-title">${esc(c.title)}</div>
    <div class="cut-save">${saves ? 'saves ' + saves : ''}</div>
    <div class="cut-sub">${esc(sub)}${why ? `${sub ? ' · ' : ''}<button class="fx-why" type="button" aria-expanded="false">why</button>` : ''}</div>
    ${why ? `<div class="fx-panel" hidden>${why}</div>` : ''}
  </div>`;
}

function shortItem(s) { return String(s || '').split(/\s[\/(]|\s-\s/)[0].trim(); }
