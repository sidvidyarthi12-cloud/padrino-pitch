// The path: home. A winding trail of milestones in sections, like Duolingo units. Each section
// has a painted sign hung over the street with its number, title, when it happens, and its
// progress. One node is current and bounces with a Start sign. Done nodes are filled and show a bank mark when the bank proved it.
// Locked nodes wait for their month.
//
// Round 6 gives the path life: the path is a walk up an old Italian street (scene.js draws it:
// a cobblestone road under the nodes, houses with shutters and flower boxes along both edges,
// pots along the curbs, papel picado strung from house to house, a painted sky at the top), a
// trail that follows the nodes, and a few petals and lights that drift down slowly. All of it is
// inline SVG and CSS, and all of it stops for prefers-reduced-motion.
//
// Each node also has a small "more" button (or a long press): start it now even if it is ahead,
// mark it done by hand, or say something went wrong and reopen it or its whole section. The
// logic for those lives in path-data.js (jumpTo, markDone, reopenNode, reopenSection) and every
// call is guarded, so the sheet still opens when that part is not wired yet.
//
// path-data.js decides what is done from real data. Until it lands, a small built-in sample
// draws the same shape so the design can be judged. The screen updates itself in place when the
// plan changes, so the bank verifying a payment never re-animates the whole path or loses the
// scroll position.

import { getPlan, subscribe, getTraditions } from '../store.js';
import { getTemplate } from '../data.js';
import { summary } from '../calc.js';
import { esc, daysUntil, money, num, plural } from '../format.js';
import { icon, openSheet, toast } from '../ui.js';
import { sceneDefs, skyHtml, roadHtml, garlandHtml, drawFacades } from '../scene.js';

export const selfUpdating = true;

const RESUME_KEY = 'padrino.step.resume';

// Node icons by a few words in the title. Falls back to a star.
const ICON_HINTS = [
  ['bank', 'bank'], ['number', 'target'], ['top 3', 'star'], ['matters', 'star'], ['style', 'heart'], ['tradition', 'heart'], ['guest', 'people'], ['padrino', 'hand'], ['helping', 'hand'],
  ['venue', 'venue'], ['photograph', 'photo'], ['cater', 'catering'], ['food', 'food'], ['music', 'music'], ['mariachi', 'mariachi'],
  ['flor', 'flowers'], ['flower', 'flowers'], ['attire', 'dress'], ['dress', 'dress'], ['hair', 'hair-makeup'], ['beauty', 'hair-makeup'], ['officiant', 'officiant'],
  ['subscription', 'scissors'], ['cut', 'scissors'], ['freed', 'spark'], ['gap', 'fixer'], ['fixer', 'fixer'], ['card', 'card'], ['invitation', 'invitations'], ['postage', 'mail'],
  ['link', 'gift'], ['gift', 'gift'], ['rsvp', 'check'], ['collect', 'hand'], ['final', 'payments'], ['tip', 'tips'], ['meal', 'catering'], ['headcount', 'people'],
  ['name', 'contract'], ['merge', 'bank'], ['thank', 'heart'], ['home', 'home2'], ['pay', 'payments'], ['quote', 'quote'], ['contract', 'contract']
];

function nodeIcon(node) {
  if (node.icon) return node.icon;
  const t = String(node.title || '').toLowerCase();
  for (const [word, name] of ICON_HINTS) if (t.includes(word)) return name;
  return 'star';
}

// ---- path-data, loaded when it exists

let pathLoad = null;
let readied = false;
export async function loadPathData() {
  if (!pathLoad) {
    pathLoad = import('../path-data.js').catch((e) => { console.warn('path-data.js is not ready yet', e); pathLoad = null; return null; });
  }
  const m = await pathLoad;
  if (m && !readied && typeof m.ready === 'function') {
    try { await m.ready(); } catch (e) { console.error(e); }
    readied = true;
  }
  return m;
}

export async function getPathSafe() {
  const m = await loadPathData();
  if (m && typeof m.getPath === 'function') {
    try {
      const p = await m.getPath();
      if (p && Array.isArray(p.sections)) return p;
    } catch (e) { console.error(e); }
  }
  return samplePath(getPlan());
}

// ---- render

let paintedOnce = false;

export async function render(root, { navigate }) {
  const template = await getTemplate().catch(() => []);

  // Landing on the path clears any "back to your step" reminder.
  try { sessionStorage.removeItem(RESUME_KEY); } catch { /* fine */ }

  let lastKey = '';
  let painting = false;
  let again = false;
  let lastPath = null;

  async function paint({ first = false } = {}) {
    if (painting) { again = true; return; }
    painting = true;
    try {
      const plan = getPlan();
      if (!plan) return;
      const path = await getPathSafe();
      lastPath = path;
      let s = null;
      try { s = summary(plan, template); } catch (e) { console.error(e); }
      const days = daysUntil(plan.couple?.weddingDate);
      const prog = path.progress || countProgress(path);
      // Nothing visible changed: leave the DOM alone (no flicker, no lost scroll).
      const key = JSON.stringify([days, prog, s && s.overBy, s && s.available, path.sections.map((sec) => [sec.locked, sec.nodes.map((n) => [n.id, n.status, n.verified, n.doneNote, n.lockedNote, n.skipped, n.manual, n.jumped, n.problem && n.problem.reason])])]);
      if (key === lastKey) return;
      lastKey = key;
      const y = window.scrollY;
      root.innerHTML = pathHtml(path, prog, days, s, { animate: first && !paintedOnce });
      paintedOnce = true;
      wire();
      drawFacades(root);
      drawTrails();
      if (!first) window.scrollTo({ top: y });
      else focusCurrent();
    } finally {
      painting = false;
      if (again) { again = false; paint(); }
    }
  }

  function findNode(id) {
    if (!lastPath) return null;
    for (const section of lastPath.sections) {
      const node = (section.nodes || []).find((n) => n.id === id);
      if (node) return { section, node };
    }
    return null;
  }

  function wire() {
    root.querySelectorAll('.pnode-btn[data-node]').forEach((btn) => {
      let pressTimer = null;
      let longPressed = false;
      const cancel = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        longPressed = false;
        cancel();
        pressTimer = setTimeout(() => { longPressed = true; openNodeSheet(btn.dataset.node); }, 520);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, cancel));
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); openNodeSheet(btn.dataset.node); });
      btn.addEventListener('click', () => {
        if (longPressed) { longPressed = false; return; }
        const li = btn.closest('.pnode');
        // The wedding style, once set, opens the style screen so it can be changed any time.
        if (btn.dataset.node === 'style' && li.classList.contains('done')) { navigate('/style'); return; }
        if (li.classList.contains('locked')) {
          const sub = li.querySelector('.pnode-sub');
          if (sub) { sub.classList.add('shake'); setTimeout(() => sub.classList.remove('shake'), 500); }
          toast('Locked for now. Hold the circle to start it anyway.', 2600);
          return;
        }
        navigate(`/step/${encodeURIComponent(btn.dataset.node)}`);
      });
    });
    root.querySelectorAll('.pnode-more[data-node]').forEach((b) => {
      b.addEventListener('click', (e) => { e.stopPropagation(); openNodeSheet(b.dataset.node); });
    });
  }

  // ---- the node sheet: start now, mark as done, something went wrong

  async function openNodeSheet(id) {
    const found = findNode(id);
    if (!found) return;
    const { section, node } = found;
    const pd = await loadPathData();
    const can = (fn) => Boolean(pd && typeof pd[fn] === 'function');
    const status = node.status || 'locked';
    const statusLine = status === 'done'
      ? (node.verified ? `${icon('bank')}Done, verified by your bank` : node.manual ? `${icon('hand')}Marked done by you` : `${icon('check')}Done`)
      : status === 'locked' ? `${icon('lock')}${esc(node.lockedNote || 'Opens later')}`
        : status === 'current' ? `${icon('play')}Up next` : `${icon('clock')}Open`;
    const problem = node.problem && node.problem.reason ? `<p class="ns-status">${icon('warn')}Reopened: ${esc(node.problem.reason)}</p>` : '';

    const dlg = openSheet(`
      <div class="nsheet">
        <p class="eyebrow">${esc(section.title)}</p>
        <h2>${esc(node.title)}</h2>
        <p class="ns-status">${statusLine}</p>
        ${problem}
        <div class="ns-opts" id="ns-opts">
          ${status !== 'done' ? `<button class="ns-opt" type="button" data-act="start"><span class="ns-ic">${icon('play')}</span><span class="ns-text"><span class="ns-title">${status === 'locked' ? 'Start now anyway' : status === 'current' ? 'Start' : 'Start this one now'}</span><span class="ns-sub">${status === 'locked' ? 'Opens it early. Nothing else moves.' : 'Open the steps for this milestone.'}</span></span></button>` : ''}
          ${status !== 'done' ? `<button class="ns-opt good" type="button" data-act="done"><span class="ns-ic">${icon('check')}</span><span class="ns-text"><span class="ns-title">Mark as done</span><span class="ns-sub">You handled it outside the app. The path moves on.</span></span></button>` : ''}
          ${status === 'done' ? `<button class="ns-opt" type="button" data-act="start"><span class="ns-ic">${icon('redo')}</span><span class="ns-text"><span class="ns-title">Look at it again</span><span class="ns-sub">Open the steps without changing anything.</span></span></button>` : ''}
          <button class="ns-opt warn" type="button" data-act="problem"><span class="ns-ic">${icon('warn')}</span><span class="ns-text"><span class="ns-title">Something went wrong</span><span class="ns-sub">A vendor fell through, a plan changed. Reopen it.</span></span></button>
        </div>
        <form class="ns-problem mt" id="ns-problem" hidden>
          <label class="field"><span>What happened?</span><textarea name="reason" placeholder="The photographer cancelled on us" rows="3"></textarea></label>
          <div class="row">
            <button class="btn" type="submit" data-scope="node">Reopen this milestone</button>
            <button class="btn secondary" type="button" data-scope="section">Reopen the whole section</button>
          </div>
          <p class="tiny mt-s">Nothing is deleted. Done steps stay done until you change them.</p>
        </form>
      </div>`);

    const opts = dlg.querySelector('#ns-opts');
    const form = dlg.querySelector('#ns-problem');

    opts.querySelector('[data-act="start"]')?.addEventListener('click', () => {
      if (status === 'locked' || status === 'next') {
        if (can('jumpTo')) {
          try {
            const r = pd.jumpTo(id);
            if (r && r.ok === false) { toast(r.message || 'Could not open that one'); return; }
          } catch (e) { console.error(e); toast(e.message || 'Could not open that one'); return; }
        } else if (status === 'locked') { toast('Opening early is still being wired up. Try again in a minute.', 3200); return; }
      }
      dlg.close();
      navigate(`/step/${encodeURIComponent(id)}`);
    });

    opts.querySelector('[data-act="done"]')?.addEventListener('click', () => {
      if (!can('markDone')) { toast('Marking done by hand is still being wired up. Try again in a minute.', 3200); return; }
      try {
        const r = pd.markDone(id);
        dlg.close();
        toast((r && r.message) || `${node.title} marked done.`);
        paint();
      } catch (e) { console.error(e); toast(e.message || 'Could not mark that done'); }
    });

    opts.querySelector('[data-act="problem"]').addEventListener('click', () => {
      form.hidden = false;
      opts.hidden = true;
      form.querySelector('textarea').focus();
    });

    const reopen = (scope) => {
      const reason = form.querySelector('textarea').value.trim();
      if (!reason) { form.querySelector('textarea').focus(); toast('Say what happened, in a few words'); return; }
      const fn = scope === 'section' ? 'reopenSection' : 'reopenNode';
      if (!can(fn)) { toast('Reopening is still being wired up. Try again in a minute.', 3200); return; }
      try {
        const r = scope === 'section' ? pd.reopenSection(section.id, reason) : pd.reopenNode(id, reason);
        dlg.close();
        toast((r && r.message) || (scope === 'section' ? `${section.title} is open again.` : `${node.title} is open again.`));
        paint();
      } catch (e) { console.error(e); toast(e.message || 'Could not reopen that'); }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); reopen('node'); });
    form.querySelector('[data-scope="section"]').addEventListener('click', () => reopen('section'));
  }

  // ---- the trail: a row of flat stepping stones through the node centers of each section.
  // Each stone is a dash of the curve with a slightly longer, wider ink dash under it for the
  // outline. The done part is the same stones filled in the section color.

  function drawTrails() {
    root.querySelectorAll('.pnodes').forEach((ol) => {
      const svg = ol.querySelector('.ptrail');
      if (!svg) return;
      const box = ol.getBoundingClientRect();
      const pts = [...ol.querySelectorAll('.pnode-btn')].map((b) => {
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, done: b.closest('.pnode').classList.contains('done') };
      });
      if (pts.length < 2 || !box.width) { svg.innerHTML = ''; return; }
      svg.setAttribute('viewBox', `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`);
      svg.setAttribute('width', Math.round(box.width));
      svg.setAttribute('height', Math.round(box.height));
      // One subpath per segment between two nodes, so the dash pattern (the stones) restarts at
      // every node on every layer and the done layer lines up with the stone layer under it.
      const segs = [];
      const doneSegs = [];
      for (let i = 1; i < pts.length; i++) {
        const seg = curve([pts[i - 1], pts[i]]);
        segs.push(seg);
        if (pts[i - 1].done && pts[i].done) doneSegs.push(seg);
      }
      const d = segs.join(' ');
      const doneD = doneSegs.join(' ');
      svg.innerHTML = `<path class="t-ink" d="${d}"/><path class="t-stone" d="${d}"/>${doneD ? `<path class="t-done" d="${doneD}"/>` : ''}`;
    });
  }

  // Bring the current node into view on first paint, under the sticky bar.
  function focusCurrent() {
    const cur = root.querySelector('.pnode.current');
    if (!cur) return;
    requestAnimationFrame(() => {
      const r = cur.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.75 || r.top < 90) cur.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }

  await paint({ first: true });
  // The slide-in moves the nodes for a moment; draw the trail again once they settle, and on resize.
  const redraw = () => { drawFacades(root); drawTrails(); };
  const settle = setTimeout(redraw, 900);
  let resizeTimer = null;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(redraw, 120); };
  window.addEventListener('resize', onResize);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(root);
  const unsub = subscribe(() => { paint(); });
  return () => {
    if (typeof unsub === 'function') unsub();
    clearTimeout(settle); clearTimeout(resizeTimer);
    window.removeEventListener('resize', onResize);
    if (ro) ro.disconnect();
  };
}

// A smooth curve through points: cubic segments with vertical tangents, so the trail bends
// gently from one node to the next instead of cutting corners.
function curve(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i];
    const cy = (b.y - a.y) * 0.5;
    d += ` C${a.x.toFixed(1)} ${(a.y + cy).toFixed(1)}, ${b.x.toFixed(1)} ${(b.y - cy).toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}

function pathHtml(path, prog, days, s, { animate }) {
  let i = 0;
  return `
    <div class="path ${animate ? 'animate' : ''}">
      ${sceneDefs()}
      <div class="sc-road" aria-hidden="true">${roadHtml()}</div>
      <div class="path-top">
        <div class="pt-days">${daysTop(days)}</div>
        <div class="pt-prog" aria-label="${num(prog.done)} of ${num(prog.total)} milestones done">
          <div class="progress"><span style="width:${prog.pct || 0}%"></span></div>
          <small>${num(prog.done)} of ${num(prog.total)} done</small>
        </div>
        ${s ? `<a class="pt-chip ${statusCls(s)}" href="#/home">${icon(statusCls(s) === 'good' ? 'check' : 'warn')}${esc(statusWord(s))}</a>` : ''}
      </div>
      <div class="sc-skyline" aria-hidden="true"><div class="sc-sky">${skyHtml()}</div></div>

      ${path.sections.map((sec, si) => {
        const nodes = sec.nodes || [];
        const done = Number.isFinite(sec.done) ? sec.done : nodes.filter((n) => n.status === 'done').length;
        const total = Number.isFinite(sec.total) ? sec.total : nodes.length;
        const allLocked = sec.locked || (nodes.length && nodes.every((n) => n.status === 'locked'));
        const allDone = total && done === total;
        const pill = allDone ? `${icon('check')} Done` : allLocked ? `${icon('lock')} ${esc(sec.lockedNote || 'Opens later')}` : `${num(done)} of ${num(total)}`;
        // The section header is a painted sign hung from an iron rod across the street: the
        // number is part of the lettering, the timing and progress are plain type.
        return `
        <section class="psec ${allLocked ? 'locked-all' : ''}" data-color="${esc(sec.color || 'slate')}" aria-labelledby="sec-${esc(sec.id)}">
          <div class="sc-side left" aria-hidden="true"></div>
          <div class="sc-side right" aria-hidden="true"></div>
          <header class="psec-head">
            <span class="sign-rod" aria-hidden="true"></span>
            <span class="sign-chain l" aria-hidden="true"></span>
            <span class="sign-chain r" aria-hidden="true"></span>
            <div class="sign-board">
              <div class="sign-row">
                <p class="psec-when"><span class="sign-no">No. ${si + 1}</span>${sec.when ? `<span class="sign-sep" aria-hidden="true"></span>${esc(sec.when)}${sec.dates ? ` <span class="psec-dates">${esc(sec.dates)}</span>` : ''}` : ''}</p>
                <span class="psec-prog ${allDone ? 'all' : ''}">${pill}</span>
              </div>
              <h2 id="sec-${esc(sec.id)}">${esc(sec.title)}</h2>
              ${sec.subtitle ? `<p class="psec-sub">${esc(sec.subtitle)}</p>` : ''}
            </div>
          </header>
          ${garlandHtml(si)}
          <ol class="pnodes">
            <svg class="ptrail" aria-hidden="true"></svg>
            ${driftHtml(si, nodes.length)}
            ${nodes.map((n) => nodeHtml(n, i++)).join('')}
          </ol>
        </section>`;
      }).join('')}

      <div class="path-end">${icon('flag')}${prog.done >= prog.total && prog.total ? 'Every milestone done. Enjoy the day.' : 'More opens as the date gets closer.'}</div>
    </div>
    <a class="fab" href="#/talk" id="fab">${icon('chat')}Ask Padrino</a>`;
}

// ---- the decorations

// The papel picado garland now lives in scene.js, strung from house to house.

// A few petals per section, placed by a small deterministic spread so the page looks the same
// every visit. They drift down slowly and turn. Flat shapes, no lights, no glow.
const PETAL = '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M7 1C9.5 3 12 6 11.5 9.5 11 12 9 13 7 13S3 12 2.5 9.5C2 6 4.5 3 7 1z"/></svg>';
function driftHtml(si, nodeCount) {
  const n = Math.max(2, Math.min(4, nodeCount));
  const out = [];
  for (let k = 0; k < n; k++) {
    const seed = (si * 7 + k * 13) % 23;
    const px = 8 + ((seed * 37 + k * 11) % 84);
    const py = 6 + ((seed * 19 + k * 29) % 70);
    const dur = 20 + ((seed * 3) % 14);
    const delay = -((seed * 5 + k * 7) % 20);
    const dx = ((seed % 5) - 2) * 14;
    const dy = 90 + (seed % 4) * 25;
    out.push(`<span class="pdrift" style="--px:${px}%;--py:${py}%;--dur:${dur}s;--delay:${delay}s;--dx:${dx}px;--dy:${dy}px" aria-hidden="true">${PETAL}</span>`);
  }
  return out.join('');
}

export function fadeIn(img) {
  if (!img) return;
  if (img.complete && img.naturalWidth) { img.classList.add('in'); return; }
  img.addEventListener('load', () => img.classList.add('in'), { once: true });
}

// The winding: a gentle wave, by the node's place on the whole path.
const WAVE = [0, 46, 72, 46, 0, -46, -72, -46];

function nodeHtml(n, i) {
  const x = WAVE[i % WAVE.length];
  const status = n.status || 'locked';
  const problem = n.problem && (n.problem.reason || n.problem.at) ? n.problem : null;
  let sub = '';
  if (problem && status !== 'done') {
    sub = `<span class="pnode-sub problem">${icon('warn')}${esc(problem.reason ? `Reopened: ${problem.reason}` : 'Reopened')}</span>`;
  } else if (status === 'done' && n.id === 'style') {
    // The wedding style can change any time: show what it is now, with a way to change it.
    let names = [];
    try { names = getTraditions().names || []; } catch { /* no plan yet */ }
    sub = `<span class="pnode-sub style-now">${esc(names.length ? names.join(', ') : 'No style picked')}<a class="pnode-change" href="#/style">Change</a></span>`;
  } else if (status === 'done') {
    sub = n.skipped ? `<span class="pnode-sub">Not for you. Skipped.</span>`
      : n.verified ? `<span class="pnode-sub verified">${icon('bank')}Verified by your bank</span>`
        : n.manual ? `<span class="pnode-sub manual">${icon('hand')}Marked done by you</span>`
          : n.doneNote ? `<span class="pnode-sub">${esc(n.doneNote)}</span>` : '';
  } else if (status === 'locked') {
    sub = `<span class="pnode-sub">${icon('lock')}${esc(n.lockedNote || n.opens || 'Opens later')}</span>`;
  } else if (n.jumped) {
    sub = `<span class="pnode-sub">${icon('play')}Opened early</span>`;
  } else if (n.short) {
    sub = `<span class="pnode-sub">${esc(n.short)}</span>`;
  }
  const label = status === 'current' ? 'Start' : status === 'done' ? 'Done' : status === 'next' ? 'Open' : 'Locked';
  const mark = status === 'done' && n.verified ? `<span class="pnode-mark" title="Verified by your bank">${icon('bank')}</span>`
    : status === 'done' && n.manual ? `<span class="pnode-mark manual" title="Marked done by you">${icon('hand')}</span>`
      : problem && status !== 'done' ? `<span class="pnode-mark problem" title="Reopened">${icon('warn')}</span>` : '';
  return `<li class="pnode ${status} ${problem && status !== 'done' ? 'problem' : ''} ${n.manual ? 'manual' : ''}" style="--x:${x}px;--i:${i}">
    ${status === 'current' ? `<span class="pnode-bubble" aria-hidden="true">Start</span>` : ''}
    <button class="pnode-btn" type="button" data-node="${esc(n.id)}" aria-label="${esc(n.title)}: ${label}" ${status === 'locked' ? 'aria-disabled="true"' : ''}>
      ${status === 'done' ? icon('check') : status === 'locked' ? icon('lock') : icon(nodeIcon(n))}
      ${mark}
    </button>
    <button class="pnode-more" type="button" data-node="${esc(n.id)}" aria-label="More for ${esc(n.title)}">${icon('more')}</button>
    <span class="pnode-label">${esc(n.title)}</span>
    ${sub}
  </li>`;
}

function countProgress(path) {
  const all = path.sections.flatMap((s) => s.nodes || []);
  const done = all.filter((n) => n.status === 'done').length;
  return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
}

function daysTop(days) {
  if (days === null || days === undefined) return `<strong>Set</strong><span>your date</span>`;
  if (days < 0) return `<strong>Married</strong><span>${num(-days)} ${plural(-days, 'day')} ago</span>`;
  if (days === 0) return `<strong>Today</strong><span>is the day</span>`;
  return `<strong>${num(days)}</strong><span>${plural(days, 'day')} to go</span>`;
}

function statusCls(s) {
  if (Number(s.overBy) > 0) return 'bad';
  const need = Number(s.needed) || 0; const have = Number(s.available) || 0;
  if (need && have < need * 1.05) return 'warn';
  return 'good';
}

function statusWord(s) {
  if (Number(s.overBy) > 0) return `Over by ${money(s.overBy)}`;
  return statusCls(s) === 'warn' ? 'Tight' : 'On track';
}

// ---- built-in sample, used only until path-data.js lands

function monthName(iso, monthsBefore) {
  if (!iso) return 'later';
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return 'later';
  d.setMonth(d.getMonth() - monthsBefore);
  return d.toLocaleDateString('en-US', { month: 'long' });
}

function samplePath(plan) {
  const date = plan?.couple?.weddingDate || '';
  const node = (id, title, status, extra = {}) => ({ id, title, status, verified: false, doneNote: null, short: '', steps: sampleSteps(title), ...extra });
  const lock = (id, title, monthsBefore) => node(id, title, 'locked', { lockedNote: `Opens in ${monthName(date, monthsBefore)}` });
  const sections = [
    { id: 'foundation', title: 'Set the foundation', subtitle: 'Your money, your number, your people.', when: 'First weeks', color: 'emerald', photo: 'couple',
      nodes: [node('bank', 'Connect your bank', 'done', { verified: true }), node('number', 'Your number', 'done', { doneNote: 'What you can spend' }), node('top3', 'Your top 3', 'done'), node('guests', 'Guest count', 'done'), node('padrinos', 'Who is helping', 'done', { doneNote: '3 padrinos' })] },
    { id: 'big-three', title: 'Lock the big three', subtitle: 'Venue, photographer, caterer. Quote, contract, deposit.', when: '12 to 10 months out', color: 'ocean', photo: 'venue',
      nodes: [node('venue', 'Book the venue', 'done', { verified: true }), node('photographer', 'Book the photographer', 'current', { short: 'Quote, contract check, deposit' }), node('caterer', 'Book the caterer', 'next', { short: 'Read the quote first' })] },
    { id: 'team', title: 'Build your team', subtitle: 'Music, flowers, attire, hair, officiant.', when: '10 to 8 months out', color: 'marigold', photo: 'mariachi',
      nodes: [lock('music', 'Music or mariachi', 10), lock('florist', 'Florist', 9), lock('attire', 'Attire', 9), lock('hair', 'Hair and makeup', 8), lock('officiant', 'Officiant', 8)] },
    { id: 'find-money', title: 'Find money', subtitle: 'Cut what you do not use. Close the gap.', when: 'Any time', color: 'teal', photo: 'rings',
      nodes: [node('subs', 'Cut subscriptions', 'next', { short: 'Your bank shows what could go' }), node('gap', 'Close the gap', 'next'), node('card', 'Pay with the right card', 'next')] },
    { id: 'guests', title: 'Guests and paper', subtitle: 'Invitations, gifts toward real costs, RSVPs.', when: '6 to 4 months out', color: 'rose', photo: 'flowers',
      nodes: [lock('invites', 'Invitations', 6), lock('postage', 'Postage', 5), lock('gifts', 'Padrino and guest gift links', 5), lock('rsvps', 'RSVPs', 4)] },
    { id: 'final', title: 'Final stretch', subtitle: 'Last payments, tips, meals, the headcount.', when: 'Last 2 months', color: 'plum', photo: 'table',
      nodes: [lock('final-pay', 'Final payments', 2), lock('tips', 'Tips', 1), lock('vendor-meals', 'Vendor meals', 1), lock('headcount', 'Headcount guarantee', 1)] },
    { id: 'after', title: 'After the wedding', subtitle: 'Names, money, thank yous, the first home.', when: 'After the day', color: 'slate', photo: 'after',
      nodes: [lock('name-change', 'Name change', 0), lock('merge', 'Merge money', 0), lock('thanks', 'Thank yous', 0), lock('first-home', 'The first home', 0)] }
  ];
  const all = sections.flatMap((s) => s.nodes);
  const done = all.filter((n) => n.status === 'done').length;
  return { progress: { done, total: all.length, pct: Math.round((done / all.length) * 100) }, current: 'photographer', sections, sample: true };
}

function sampleSteps(title) {
  return [
    { id: 's1', kind: 'info', title: `${title}: here is the plan`, body: 'Three small steps. Each one is a single decision. Nothing is final until you say so.', cta: 'Got it' },
    { id: 's2', kind: 'choice', title: 'Where are you with this?', body: 'Pick the one that fits today.', options: [{ value: 'none', label: 'Have not started', sub: 'Padrino will find vendors near you' }, { value: 'quote', label: 'We have a quote', sub: 'Read it for hidden charges' }, { value: 'booked', label: 'Already booked', sub: 'Add the deposit and dates' }], cta: 'Continue' },
    { id: 's3', kind: 'route', title: 'Read the quote', body: 'Snap it or paste it. Padrino finds the service charge, the tax and what is missing.', route: '/quotes', cta: 'Open the reader' }
  ];
}
