// Change the wedding style any time: the same picture tiles as onboarding, saved through
// store.setTraditions, which adds the new style's lines and milestones and drops the old
// style's lines only while they are still empty and unbooked.

import * as store from '../store.js';
import { esc, num, plural } from '../format.js';
import { toast, styleGridHtml, wireStyleGrid, loadTraditions, OWN_ID } from '../ui.js';

export async function render(root, { navigate }) {
  const plan = store.getPlan();
  if (!plan) { navigate('/setup'); return; }
  const now = typeof store.getTraditions === 'function' ? store.getTraditions() : { ids: [], names: [], notes: '' };
  const picks = now.ids.map((id) => (id === 'own' ? OWN_ID : id));
  const list = await loadTraditions().catch(() => []);

  root.innerHTML = `
    <header class="screen-head" data-color="rose">
      <p class="eyebrow">Wedding style · Your traditions</p>
      <h1>Your wedding style</h1>
      <p class="lede">${now.names.length ? `Right now: ${esc(now.names.join(', '))}. ` : ''}Change it any time. Padrino swaps the costs, steps and vendors to match.</p>
    </header>
    ${styleGridHtml(list, picks, now.notes, { gridId: 'style-change' })}
    <p class="tiny mt">Lines you already booked or paid stay in your budget either way.</p>
    <div class="row mt-l">
      <button class="btn" type="button" id="style-save">Save our style</button>
      <a class="text-btn" href="#/path">Cancel</a>
    </div>`;

  wireStyleGrid(root, 'style-change', picks);

  root.querySelector('#style-save').addEventListener('click', () => {
    if (typeof store.setTraditions !== 'function') { toast('Style changes are not ready yet.'); return; }
    const notes = root.querySelector('textarea[name="traditionNotes"]')?.value || '';
    const r = store.setTraditions(picks.map((id) => (id === OWN_ID ? 'own' : id)), notes) || {};
    const added = (r.added || []).length;
    const removed = (r.removed || []).length;
    const bits = [];
    if (added) bits.push(`${num(added)} ${plural(added, 'cost')} added`);
    if (removed) bits.push(`${num(removed)} removed`);
    toast(bits.length ? `Style saved. ${bits.join(', ')}.` : 'Style saved.', 3200);
    navigate('/path');
  });
}
