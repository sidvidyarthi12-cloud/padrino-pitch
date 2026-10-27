// A short full-screen moment for when the gap closes. Papel picado banners drawn in SVG,
// one line that says what closed it, and a Continue button. Shown only on the change,
// never on a plain re-render. Respects prefers-reduced-motion (the global CSS rule stops
// the animation and we skip the confetti).

import { esc } from '../format.js';

let open = false;

export function celebrate({ line = '', eyebrow = 'Your plan', title = 'You are on track', cta = 'Continue', small = false, onClose = null } = {}) {
  if (open) return;
  open = true;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = 'celebrate' + (reduced ? ' still' : '') + (small ? ' small' : '');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'cel-title');
  el.innerHTML = `
    <div class="cel-string top" aria-hidden="true">${banners(9, 0)}</div>
    <div class="cel-string second" aria-hidden="true">${banners(8, 3)}</div>
    ${reduced ? '' : `<div class="cel-confetti" aria-hidden="true">${confetti(26)}</div>`}
    <div class="cel-body">
      ${small ? `<div class="cel-check" aria-hidden="true">${checkSvg()}</div>` : ''}
      <p class="eyebrow">${esc(eyebrow)}</p>
      <h1 id="cel-title">${esc(title)}</h1>
      ${line ? `<p class="cel-line">${esc(line)}</p>` : ''}
      <button class="btn lg" type="button" id="cel-go">${esc(cta)}</button>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));

  const close = () => {
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => { el.remove(); open = false; if (onClose) onClose(); }, reduced ? 0 : 300);
  };
  el.querySelector('#cel-go').addEventListener('click', close);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  el.querySelector('#cel-go').focus();
  return close;
}

// A string of cut paper flags. Each flag is a rectangle with holes punched out of it,
// the way papel picado is cut, in the app's own tints.
const FLAG_COLORS = ['var(--accent)', 'var(--good)', 'var(--warn)', 'var(--cel-rose)', 'var(--cel-sky)', 'var(--cel-lilac)'];

function banners(count, offset) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const color = FLAG_COLORS[(i + offset) % FLAG_COLORS.length];
    out += `<span class="cel-flag" style="--i:${i};--c:${color}">${flagSvg((i + offset) % 3)}</span>`;
  }
  return out;
}

function flagSvg(variant) {
  // Holes are drawn in the page background color so they read as cut-outs.
  const holes = variant === 0
    ? '<circle cx="30" cy="22" r="7"/><circle cx="16" cy="40" r="4"/><circle cx="44" cy="40" r="4"/><circle cx="30" cy="54" r="5"/><path d="M12 68h36l-18 10z"/>'
    : variant === 1
      ? '<path d="M30 12l8 10-8 10-8-10z"/><path d="M14 36l6 7-6 7-6-7z"/><path d="M46 36l6 7-6 7-6-7z"/><path d="M30 46l8 10-8 10-8-10z"/><path d="M8 70h44l-22 8z"/>'
      : '<circle cx="30" cy="30" r="12"/><circle cx="30" cy="30" r="5" fill="var(--c)"/><circle cx="12" cy="52" r="3"/><circle cx="48" cy="52" r="3"/><circle cx="30" cy="58" r="3"/><path d="M10 68h40l-20 10z"/>';
  return `<svg viewBox="0 0 60 82" aria-hidden="true"><path d="M0 0h60v70L30 82 0 70z" fill="var(--c)"/><g fill="var(--bg)">${holes}</g></svg>`;
}

function checkSvg() {
  return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 7"/></svg>';
}

function confetti(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const left = Math.round((i / n) * 100 + (Math.random() * 6 - 3));
    const delay = (Math.random() * 1.6).toFixed(2);
    const dur = (2.6 + Math.random() * 1.8).toFixed(2);
    const color = FLAG_COLORS[i % FLAG_COLORS.length];
    const round = i % 3 === 0 ? 'round' : '';
    out += `<i class="cel-bit ${round}" style="left:${left}%;animation-delay:${delay}s;animation-duration:${dur}s;background:${color}"></i>`;
  }
  return out;
}
