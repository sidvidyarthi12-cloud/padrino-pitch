// A step screen: one node from the path, one small step at a time. A bar on top, a big Continue
// at the bottom, a close X. Kinds: info (read and continue), choice (pick one), input (type one
// thing, or a few), route (open an existing screen and come back), action (do one thing now).
// Each answer goes through path-data.js completeStep, which applies it with store functions and
// says whether the node is done. Then a short celebration and back to the path.

import { getBankData } from '../store.js';
import { esc } from '../format.js';
import { icon, toast, styleGridHtml, wireStyleGrid, loadTraditions, OWN_ID } from '../ui.js';
import { getPathSafe, loadPathData } from './path.js';
import { celebrate } from './celebrate.js';
import * as onboarding from '../../lib/onboarding.js';

export const selfUpdating = true;

const RESUME_KEY = 'padrino.step.resume';
const POS_KEY = 'padrino.step.pos';

function readPos(nodeId) {
  try { const p = JSON.parse(sessionStorage.getItem(POS_KEY) || 'null'); return p && p.nodeId === nodeId ? p.index : null; } catch { return null; }
}
function writePos(nodeId, index) {
  try { sessionStorage.setItem(POS_KEY, JSON.stringify({ nodeId, index })); } catch { /* fine */ }
}
function clearPos() {
  try { sessionStorage.removeItem(POS_KEY); sessionStorage.removeItem(RESUME_KEY); } catch { /* fine */ }
}

async function findNode(id) {
  const pd = await loadPathData();
  if (pd && typeof pd.getNode === 'function') {
    try { const r = pd.getNode(id); if (r && r.node) return { ...r, pd }; } catch (e) { console.error(e); }
  }
  const path = await getPathSafe();
  for (const section of path.sections) {
    const node = (section.nodes || []).find((x) => x.id === id);
    if (node) return { section, node, pd };
  }
  return { section: null, node: null, pd };
}

export async function render(root, { navigate, id }) {
  const { section, node, pd } = await findNode(id);
  if (!node) {
    root.innerHTML = `<div class="empty"><h2>That step is not here</h2><p>It may have moved on the path.</p><a class="btn secondary mt" href="#/path">Back to the path</a></div>`;
    return;
  }
  if (node.status === 'locked') {
    root.innerHTML = `<div class="empty"><h2>${esc(node.title)}</h2><p>${esc(node.lockedNote || 'This one opens later.')} Padrino will open it when the time is right.</p><a class="btn secondary mt" href="#/path">Back to the path</a></div>`;
    return;
  }
  const steps = Array.isArray(node.steps) && node.steps.length ? node.steps : [{ id: 'only', kind: 'action', title: node.title, body: 'Mark this done when it is.', cta: 'Mark it done' }];
  // Resume where they left off, else the first step that is not already done.
  const saved = readPos(id);
  const firstOpen = Math.max(0, steps.findIndex((st) => !st.done));
  let index = Math.min(saved != null ? saved : firstOpen, steps.length - 1);
  let dir = 'forward';
  const answers = {};
  let busy = false;
  // Traditions for the style tiles, loaded once when a step needs them.
  let traditions = null;

  function paint() {
    const st = steps[index];
    const pct = Math.round((index / steps.length) * 100);
    root.innerHTML = `
      <div class="step" data-color="${esc(section.color || 'slate')}">
        <div class="step-top">
          <button class="icon-btn" type="button" id="step-close" aria-label="Close">${icon('close')}</button>
          <div class="progress" role="progressbar" aria-valuenow="${index}" aria-valuemin="0" aria-valuemax="${steps.length}"><span style="width:${pct}%"></span></div>
          <small>${index + 1} of ${steps.length}</small>
          <button class="step-ask" type="button" id="step-ask" aria-label="Ask Padrino about this step">${icon('chat')}<span>Ask Padrino</span></button>
        </div>
        <div class="step-body ${dir === 'back' ? 'back' : ''}">
          <p class="step-kicker"><i></i>${esc(section.title)}</p>
          <h1>${esc(st.title || node.title)}</h1>
          ${st.body ? `<p class="lede">${esc(st.body)}</p>` : ''}
          ${st.lesson ? `<p class="step-lesson">${icon('info')}${esc(st.lesson)}</p>` : ''}
          <div class="step-ui" id="step-ui">${ui(st)}</div>
        </div>
        <div class="step-foot">
          <button class="btn lg sec" type="button" id="step-next">${esc(ctaFor(st))}</button>
          ${index > 0 ? `<button class="text-btn muted" type="button" id="step-back">Back</button>` : node.skippable && !node.skipped ? `<button class="text-btn muted" type="button" id="step-skip">Not for us</button>` : ''}
        </div>
      </div>`;
    document.body.classList.add('on-step');
    requestAnimationFrame(() => { const bar = root.querySelector('.step-top .progress > span'); if (bar) bar.style.width = `${Math.round(((index + 0.5) / steps.length) * 100)}%`; });

    const next = root.querySelector('#step-next');
    root.querySelector('#step-close').addEventListener('click', () => { clearPos(); navigate('/path'); });
    // Ask Padrino already knowing which step this is. The shell's resume bar brings them back.
    root.querySelector('#step-ask').addEventListener('click', () => {
      writePos(id, index);
      try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ nodeId: id, title: node.title })); } catch { /* fine */ }
      navigate(`/talk?about=${encodeURIComponent(id)}`);
    });
    const back = root.querySelector('#step-back');
    if (back) back.addEventListener('click', () => { dir = 'back'; index -= 1; writePos(id, index); paint(); });
    const skip = root.querySelector('#step-skip');
    if (skip) skip.addEventListener('click', onSkip);

    wire(st, next);
    next.addEventListener('click', () => onNext(st, next));
    const h = root.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  function ctaFor(st) {
    if (st.kind === 'route') return st.doneLabel || 'Done, continue';
    if (st.cta) return st.cta;
    return index === steps.length - 1 ? 'Finish' : 'Continue';
  }

  // Steps with photo tiles: options carry a photo field (even null), or the step says tiles.
  function isTiles(st) {
    return st.kind === 'choice' && (st.tiles === true || (Array.isArray(st.options) && st.options.some((o) => o && typeof o === 'object' && ('photo' in o || 'image' in o))));
  }
  function isMulti(st) { return Boolean(st.multiple || st.multi || (Number(st.max) > 1)); }
  // The living money buffer: the keepInBank field gets a slider under its number box.
  function isBufferField(f, st) { return f.name === 'keepInBank' || st.id === 'buffer' || st.buffer === true; }
  // Tile steps come with what the couple picked before (selected, notes) until they change it here.
  function tileAnswer(st) {
    if (answers[st.id] !== undefined) return answers[st.id];
    if (Array.isArray(st.selected)) return st.notes ? { ids: [...st.selected], notes: st.notes } : [...st.selected];
    return undefined;
  }

  function ui(st) {
    switch (st.kind) {
      case 'choice': {
        if (isTiles(st)) {
          const list = (st.options || []).filter((o) => o && (o.value ?? o.id) !== OWN_ID).map((o) => ({ id: String(o.value ?? o.id), name: o.label || o.name, blurb: o.sub || o.blurb || '', photo: o.photo || o.image || null }));
          const cur = tileAnswer(st);
          const picks = Array.isArray(cur) ? cur : (cur && typeof cur === 'object' && Array.isArray(cur.ids)) ? cur.ids : (cur != null ? [String(cur)] : []);
          const notes = cur && typeof cur === 'object' && !Array.isArray(cur) ? (cur.notes || '') : '';
          return `<div class="step-tiles">${styleGridHtml(list, picks, notes, { gridId: 'step-tiles' })}<p class="style-note">${esc(st.note || (isMulti(st) ? 'Pick as many as fit. It shapes your budget lines, your milestones and the vendors we show.' : 'Pick the one that fits.'))}</p></div>`;
        }
        const opts = (st.options || []).map(normOpt);
        return `<div class="step-opts" role="radiogroup">${opts.map((o) => `
          <button class="step-opt" type="button" role="radio" aria-pressed="${answers[st.id] === o.value}" aria-checked="${answers[st.id] === o.value}" data-value="${esc(o.value)}">
            <span class="opt-dot">${icon('check')}</span>
            <span class="opt-text">${esc(o.label)}${o.sub ? `<span class="opt-sub">${esc(o.sub)}</span>` : ''}</span>
          </button>`).join('')}</div>`;
      }
      case 'input': {
        const fields = fieldsOf(st);
        return `<div class="step-input">${fields.map((f, k) => {
          const cur = answers[st.id];
          const val = cur && typeof cur === 'object' ? cur[f.name] : (k === 0 && cur != null ? cur : undefined);
          const v = val != null ? val : (f.value != null ? f.value : '');
          const type = f.type === 'money' || f.type === 'percent' ? 'number' : (f.type || 'text');
          const inp = `<input class="step-in" id="step-in-${k}" data-name="${esc(f.name)}" data-kind="${esc(f.type || 'text')}" type="${type}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${type === 'number' ? `inputmode="decimal" min="${f.min != null ? f.min : 0}" ${f.max != null ? `max="${f.max}"` : ''} step="any"` : ''} autocomplete="off">`;
          if (isBufferField(f, st)) return bufferInputHtml(f, k, inp, v);
          return `<label class="field"><span>${esc(f.label)}</span>${f.type === 'money' ? `<div class="money-input">${inp}</div>` : f.type === 'percent' ? `<div class="pct-input">${inp}</div>` : inp}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</label>`;
        }).join('')}</div>`;
      }
      case 'route':
        return `<div class="step-route"><p>${esc(st.note || 'This opens the full screen. Come back here when you are done.')}</p><a class="btn" href="#${esc(normRoute(st.route))}" id="step-route">${icon('arrow')}${esc(st.routeLabel || st.cta || 'Open it')}</a></div>`;
      case 'action':
        return st.note ? `<div class="step-action">${esc(st.note)}</div>` : '';
      default:
        return '';
    }
  }

  // The buffer input: the number box plus a slider, with about a month of regular spending from the
  // bank as a hint (suggestBuffer in /lib/onboarding.js). Money for living, which the wedding never touches.
  function bufferInputHtml(f, k, inp, v) {
    let suggested = null;
    if (typeof onboarding.suggestBuffer === 'function') {
      try { const r = onboarding.suggestBuffer(getBankData()); suggested = r && typeof r === 'object' ? Number(r.amount) : Number(r); if (!Number.isFinite(suggested) || suggested <= 0) suggested = null; } catch { suggested = null; }
    }
    const val = Math.max(0, Number(v) || 0);
    const top = Math.max(10000, Math.ceil(Math.max(val * 1.5, (suggested || 0) * 3) / 500) * 500);
    return `<div class="buffer-line step-buffer">
        <div class="bl-head"><label class="bl-lbl" for="step-in-${k}">${icon('shield')}${esc(f.label)}</label></div>
        <div class="money-input">${inp}</div>
        <input type="range" id="step-in-${k}-r" min="0" max="${top}" step="50" value="${Math.min(val, top)}" aria-label="${esc(f.label)}, slider">
        <div class="slider-row"><span>nothing set aside</span><span>$${top.toLocaleString('en-US')}</span></div>
        <p class="tiny">${esc(f.hint || 'Money for living: rent, food, the car. The wedding never touches it, and Padrino warns before a payment would.')}</p>
        ${suggested ? `<span class="bl-pill">${icon('info')}About a month of regular spending is $${Math.round(suggested).toLocaleString('en-US')}</span>` : ''}
      </div>`;
  }

  function wire(st, next) {
    if (st.kind === 'choice' && isTiles(st)) {
      const cur = tileAnswer(st);
      const picks = Array.isArray(cur) ? [...cur] : (cur && typeof cur === 'object' && Array.isArray(cur.ids)) ? [...cur.ids] : (cur != null ? [String(cur)] : []);
      const multi = isMulti(st);
      const read = () => {
        const notes = root.querySelector('#step-tiles-own textarea')?.value.trim() || '';
        answers[st.id] = notes ? { ids: [...picks], notes } : [...picks];
        next.disabled = picks.length === 0;
      };
      wireStyleGrid(root, 'step-tiles', picks, () => {
        if (!multi && picks.length > 1) {
          // One pick only: keep the newest.
          const keep = picks[picks.length - 1];
          picks.splice(0, picks.length, keep);
          root.querySelectorAll('#step-tiles .style-tile').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === keep)));
          const own = root.querySelector('#step-tiles-own'); if (own) own.hidden = keep !== OWN_ID;
        }
        read();
      });
      root.querySelector('#step-tiles-own textarea')?.addEventListener('input', read);
      read();
      // Fill in photos from traditions.json when the step did not bring its own.
      if (!traditions && (st.options || []).every((o) => !o || !(o.photo || o.image))) {
        loadTraditions().then((list) => {
          traditions = list;
          root.querySelectorAll('#step-tiles .style-tile.no-photo').forEach((b) => {
            const t = list.find((x) => x.id === b.dataset.id);
            if (!t || !t.photo) return;
            const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = t.photo;
            img.addEventListener('load', () => img.classList.add('in'), { once: true });
            b.classList.remove('no-photo'); b.querySelector('.st-pattern')?.remove(); b.prepend(img);
          });
        }).catch(() => {});
      }
      return;
    }
    if (st.kind === 'choice') {
      next.disabled = answers[st.id] == null;
      root.querySelectorAll('.step-opt').forEach((b) => b.addEventListener('click', () => {
        answers[st.id] = b.dataset.value;
        root.querySelectorAll('.step-opt').forEach((x) => { x.setAttribute('aria-pressed', 'false'); x.setAttribute('aria-checked', 'false'); });
        b.setAttribute('aria-pressed', 'true'); b.setAttribute('aria-checked', 'true');
        next.disabled = false;
      }));
    }
    if (st.kind === 'input') {
      const inputs = [...root.querySelectorAll('.step-in')];
      const read = () => {
        const multi = Array.isArray(st.fields) && st.fields.length > 1;
        const vals = {};
        for (const inp of inputs) vals[inp.dataset.name] = inp.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value;
        answers[st.id] = multi ? vals : vals[inputs[0].dataset.name];
        next.disabled = inputs.some((inp) => !String(inp.value).trim());
      };
      read();
      inputs.forEach((inp) => {
        inp.addEventListener('input', read);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !next.disabled) { e.preventDefault(); next.click(); } });
      });
      setTimeout(() => inputs[0] && inputs[0].focus(), 50);
      // The buffer slider and its number box move together.
      root.querySelectorAll('.step-buffer').forEach((box) => {
        const n = box.querySelector('.step-in'); const r = box.querySelector('input[type="range"]');
        if (!n || !r) return;
        r.addEventListener('input', () => { n.value = r.value; n.dispatchEvent(new Event('input', { bubbles: true })); });
        n.addEventListener('input', () => { r.value = Math.min(Number(n.value) || 0, Number(r.max)); });
      });
    }
    if (st.kind === 'route') {
      const link = root.querySelector('#step-route');
      link.addEventListener('click', async (e) => {
        // Remember where to come back to; the shell shows a small "back to your step" bar.
        writePos(id, index);
        try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ nodeId: id, title: node.title })); } catch { /* fine */ }
        if (st.prefill) {
          e.preventDefault();
          try {
            const q = await import('./quotes.js');
            if (typeof q.prefillQuote === 'function') q.prefillQuote(st.prefill);
          } catch (err) { console.error(err); }
          navigate(normRoute(st.route));
        }
      });
    }
  }

  function setBusy(next, label) {
    busy = true;
    next.disabled = true;
    next.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(label)}`;
  }

  async function onNext(st, next) {
    if (busy) return;
    const value = st.kind === 'choice' || st.kind === 'input' ? answers[st.id] : true;
    let result = { nodeDone: index === steps.length - 1, message: null };
    if (pd && typeof pd.completeStep === 'function') {
      setBusy(next, st.kind === 'action' ? 'Working on it' : 'Saving');
      try {
        let r = await pd.completeStep(id, st.id, value);
        if (r && r.pending) {
          setBusy(next, r.message || 'Linking your bank');
          toast(r.message || 'Linking your bank');
          r = await r.pending;
        }
        if (r && typeof r === 'object') result = { nodeDone: Boolean(r.nodeDone), message: r.message || null, ok: r.ok };
      } catch (e) {
        console.error(e);
        toast(e.message || 'That did not save');
        busy = false; paint(); return;
      }
      busy = false;
      // A refusal (the step said no) stays on this step with the message.
      if (!result.nodeDone && result.message && /locked|could not|try again|check that|set up/i.test(result.message)) { toast(result.message); paint(); return; }
    }
    if (result.nodeDone) { clearPos(); finish(result.message); return; }
    if (index === steps.length - 1) {
      // Every step answered but the data says the node is not done yet (for example a payment the bank has not seen).
      clearPos();
      if (result.message) toast(result.message);
      navigate('/path');
      return;
    }
    if (result.message) toast(result.message);
    dir = 'forward';
    index += 1;
    writePos(id, index);
    paint();
  }

  async function onSkip() {
    if (busy || !pd || typeof pd.skipNode !== 'function') return;
    let r = null;
    try { r = await pd.skipNode(id); } catch (e) { console.error(e); toast(e.message || 'Could not skip'); return; }
    if (r && r.nodeDone) { clearPos(); finish(r.message, { skipped: true }); }
    else if (r && r.message) toast(r.message);
  }

  function finish(message, { skipped = false } = {}) {
    const bar = root.querySelector('.step-top .progress > span'); if (bar) bar.style.width = '100%';
    const title = skipped ? 'Skipped' : (node.doneMessage || 'Milestone done');
    // The message often starts by repeating the title ("Bank connected. That finishes..."); drop the repeat.
    let line = message || `${node.title} is off your list. The next one is open.`;
    const lead = title.replace(/[.!]+$/, '').toLowerCase();
    if (line.toLowerCase().startsWith(lead)) line = line.slice(lead.length).replace(/^[.!\s]+/, '') || line;
    celebrate({
      small: true,
      eyebrow: section.title,
      title,
      line,
      cta: 'Back to the path',
      onClose: () => navigate('/path')
    });
  }

  paint();
  return () => { document.body.classList.remove('on-step'); };
}

function fieldsOf(st) {
  if (Array.isArray(st.fields) && st.fields.length) return st.fields.map(normField);
  return [normField(st.field)];
}

function normOpt(o) {
  if (o && typeof o === 'object') return { value: o.value != null ? o.value : (o.id != null ? o.id : o.label), label: o.label || String(o.value || o.id), sub: o.sub || o.hint || o.body || '' };
  return { value: String(o), label: String(o), sub: '' };
}

function normField(f) {
  if (f && typeof f === 'object') return { name: f.name || f.id || 'value', label: f.label || 'Your answer', type: f.type || 'text', placeholder: f.placeholder || '', hint: f.hint || '', value: f.value, min: f.min, max: f.max };
  const name = String(f || 'value');
  const money = /amount|budget|saved|monthly|price|cost|planned/i.test(name);
  return { name, label: name.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), type: money ? 'money' : 'text', placeholder: '', hint: '', value: undefined };
}

function normRoute(r) {
  let s = String(r || '/home').replace(/^#/, '');
  if (!s.startsWith('/')) s = '/' + s;
  return s;
}
