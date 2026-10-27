// Draft board: every feature, its status, what it does, and the lessons it solves.
// Reads /data/features.json and /data/lessons.json. Nothing here is money math.

import { getFeatures, getLessons } from './data.js';
import { esc, num } from './format.js';

const root = document.getElementById('board');

async function main() {
  let features; let lessons;
  try {
    [features, lessons] = await Promise.all([getFeatures(), getLessons()]);
  } catch (e) {
    root.innerHTML = `<p class="callout" style="border-left-color:var(--bad)"><strong>Could not load the board.</strong> ${esc(e.message)} It needs /data/features.json and /data/lessons.json.</p>`;
    return;
  }

  const lessonById = new Map(lessons.map((l) => [Number(l.id), l]));
  const demoFeatures = features.filter((f) => f.status === 'demo');
  const laterFeatures = features.filter((f) => f.status === 'later');
  const foldedFeatures = features.filter((f) => f.status === 'folded');
  const demoLessonIds = new Set();
  for (const f of demoFeatures) for (const id of f.lessons || []) demoLessonIds.add(Number(id));
  const adviceLessons = lessons.filter((l) => l.advice);
  const solvedInDemo = lessons.filter((l) => demoLessonIds.has(Number(l.id))).length;
  const later = lessons.filter((l) => l.featureId && !demoLessonIds.has(Number(l.id))).length;

  root.innerHTML = `
    <header class="screen-head">
      <h1>What Padrino solves</h1>
      <p class="lede">${num(lessons.length)} lessons from planners, finance writers and couples. Each one maps to a feature or an advice card.</p>
    </header>
    <div class="figures three">
      <div class="fig"><div class="fig-label">Lessons</div><div class="fig-value">${num(lessons.length)}</div></div>
      <div class="fig"><div class="fig-label">Solved in the demo</div><div class="fig-value">${num(solvedInDemo)}</div><div class="fig-sub">${demoFeatures.length} features</div></div>
      <div class="fig"><div class="fig-label">Later</div><div class="fig-value">${num(later)}</div><div class="fig-sub">${laterFeatures.length} features, ${adviceLessons.length} advice</div></div>
    </div>

    <p class="section-title mt-l">In Sunday's demo</p>
    ${demoFeatures.map((f) => featureBlock(f, lessonById, 'In the demo')).join('')}

    <p class="section-title mt-l">Later</p>
    ${laterFeatures.map((f) => featureBlock(f, lessonById, 'Later')).join('')}

    ${foldedFeatures.length ? `<p class="section-title mt-l">Folded into another feature</p>
    ${foldedFeatures.map((f) => featureBlock(f, lessonById, 'Folded')).join('')}` : ''}

    <section class="section">
      <div class="feature-head"><h2>Advice, not software</h2><span class="mark">${adviceLessons.length} lessons</span></div>
      <p class="section-text mb">These show as tips inside the app rather than as features.</p>
      ${adviceLessons.map((l) => lessonDetails(l)).join('')}
    </section>

    <p class="tiny mt-l">Sources are the writers' own accounts. Dollar figures are what they reported about their own weddings, not market data.</p>`;
}

function featureBlock(f, lessonById, status) {
  const ids = (f.lessons || []).map(Number);
  return `<section class="section">
    <div class="feature-head">
      <h2>${num(f.id)}. ${esc(f.name)}</h2>
      <span class="mark ${status === 'In the demo' ? 'good' : ''}">${esc(status)}</span>
    </div>
    <p class="section-text" style="margin:6px 0 10px">${esc(f.does || '')}</p>
    ${ids.map((id) => lessonById.get(id) ? lessonDetails(lessonById.get(id)) : `<div class="tiny">Lesson ${id} not found</div>`).join('')}
  </section>`;
}

function lessonDetails(l) {
  const links = (l.links || []).map((k) => `<a href="${esc(k.url)}" target="_blank" rel="noopener">${esc(k.label)}</a>`).join('');
  return `<details>
    <summary><span class="lesson-num">${num(l.id)}</span><span>${esc(l.text)}</span></summary>
    <div class="lesson-body">
      ${l.problem ? `<div><strong>Problem:</strong> ${esc(l.problem)}</div>` : ''}
      <div class="mt-s">${l.category ? esc(l.category) : ''}${l.sources != null ? `, ${num(l.sources)} ${Number(l.sources) === 1 ? 'source' : 'sources'}` : ''}</div>
      ${links ? `<div class="links mt-s">${links}</div>` : ''}
    </div>
  </details>`;
}

main();
