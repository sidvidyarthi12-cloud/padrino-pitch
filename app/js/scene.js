// The street scene behind the path: an original flat vector illustration of an old Italian
// street, drawn in inline SVG. Warm plaster walls with arched windows and shutters, flower
// boxes, iron balconies, doors, wall lanterns, vines, potted shrubs and lemon trees along the
// curbs, a real cobblestone road under the milestones, papel picado strung from house to house,
// and a flat painted sky with clouds at the top. Every color is a CSS variable (the "Street
// scene" section of styles.css), so dark mode turns the same street into an evening with lit
// windows.
//
// The style is flat: solid fills, dark ink outlines where a shape needs an edge, a lighter top
// face and a darker lower edge on each stone. No gradients, no blur, no glow.
//
// Everything is built from a few <symbol> pieces and <pattern> tiles, composed with <use>, so
// the DOM stays small however long the path gets. The pieces are seeded by section index so
// walking down the path passes different houses, and the same houses every visit.

// ---- a tiny seeded random, so the street looks the same on every visit

export function seeded(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

// ---- shared defs: patterns and the building pieces. Included once per path.

export function sceneDefs() {
  return `<svg class="sc-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
    ${cobblePattern()}

    <pattern id="sc-plaster" width="46" height="46" patternUnits="userSpaceOnUse">
      <circle cx="8" cy="10" r="5" class="sc-plaster-l"/><circle cx="30" cy="26" r="7" class="sc-plaster-l"/>
      <circle cx="18" cy="38" r="4" class="sc-plaster-d"/><circle cx="38" cy="8" r="3" class="sc-plaster-d"/>
      <ellipse cx="26" cy="12" rx="6" ry="3" class="sc-plaster-d"/><ellipse cx="10" cy="28" rx="4" ry="2" class="sc-plaster-l"/>
    </pattern>

    <pattern id="sc-tiles" width="12" height="7" patternUnits="userSpaceOnUse">
      <rect width="12" height="7" class="sc-roof-d"/><path d="M0 7 A6 6 0 0 1 12 7 Z" class="sc-roof"/>
    </pattern>

    <g id="sc-cloud-shape"><circle cx="36" cy="36" r="18"/><circle cx="62" cy="26" r="24"/><circle cx="92" cy="30" r="20"/><circle cx="114" cy="40" r="14"/><rect x="18" y="38" width="110" height="16" rx="8"/></g>
    <symbol id="sc-cloud" overflow="visible">
      <g class="sc-cloud-sh" transform="translate(0 7)"><use href="#sc-cloud-shape"/></g>
      <g class="sc-cloud-f"><use href="#sc-cloud-shape"/></g>
    </symbol>

    <symbol id="sc-win" overflow="visible">
      <path d="M8 11 a12 12 0 0 1 24 0 V46 H8 Z" class="sc-frame-d"/>
      <path d="M11 12 a9 9 0 0 1 18 0 V43 H11 Z" class="sc-glass"/>
      <path d="M20 3.5 V43 M11 24 H29" class="sc-mullion"/>
      <path d="M12 13 a8 8 0 0 1 7 -8.5 v7 l-7 7.5 z" class="sc-glass-hi"/>
      <path d="M11 12 a9 9 0 0 1 18 0 V43" class="sc-frame-s"/>
      <g class="sc-shutter"><rect x="0.5" y="6" width="7.5" height="39" rx="1"/><path d="M2.5 11h3.5M2.5 15.5h3.5M2.5 20h3.5M2.5 24.5h3.5M2.5 29h3.5M2.5 33.5h3.5M2.5 38h3.5" class="sc-louv"/></g>
      <g class="sc-shutter"><rect x="32" y="6" width="7.5" height="39" rx="1"/><path d="M34 11h3.5M34 15.5h3.5M34 20h3.5M34 24.5h3.5M34 29h3.5M34 33.5h3.5M34 38h3.5" class="sc-louv"/></g>
      <rect x="6" y="45.5" width="28" height="3" rx="1" class="sc-sill"/>
    </symbol>

    <symbol id="sc-win-sq" overflow="visible">
      <rect x="8" y="3" width="24" height="43" rx="1" class="sc-frame-d"/>
      <rect x="11" y="6" width="18" height="37" class="sc-glass"/>
      <path d="M20 6 V43 M11 24 H29" class="sc-mullion"/>
      <path d="M11 6 h8 v7 l-8 8 z" class="sc-glass-hi"/>
      <rect x="11" y="6" width="18" height="37" class="sc-frame-s"/>
      <g class="sc-shutter"><rect x="0.5" y="6" width="7.5" height="39" rx="1"/><path d="M2.5 11h3.5M2.5 15.5h3.5M2.5 20h3.5M2.5 24.5h3.5M2.5 29h3.5M2.5 33.5h3.5M2.5 38h3.5" class="sc-louv"/></g>
      <g class="sc-shutter"><rect x="32" y="6" width="7.5" height="39" rx="1"/><path d="M34 11h3.5M34 15.5h3.5M34 20h3.5M34 24.5h3.5M34 29h3.5M34 33.5h3.5M34 38h3.5" class="sc-louv"/></g>
      <rect x="6" y="45.5" width="28" height="3" rx="1" class="sc-sill"/>
    </symbol>

    <symbol id="sc-box" overflow="visible">
      <g class="sc-leaf"><circle cx="7" cy="9" r="4.4"/><circle cx="14" cy="7" r="4.8"/><circle cx="22" cy="8" r="4.6"/><circle cx="29" cy="9" r="4.2"/></g>
      <g class="sc-leaf-l"><circle cx="11" cy="10" r="2.6"/><circle cx="25" cy="10.5" r="2.4"/><circle cx="18" cy="11" r="2"/></g>
      <g class="sc-flower"><circle cx="6" cy="6" r="2.7"/><circle cx="13" cy="3.6" r="2.9"/><circle cx="19" cy="5.4" r="2.6"/><circle cx="25.5" cy="4" r="2.8"/><circle cx="31" cy="6.4" r="2.5"/></g>
      <g class="sc-flower-l"><circle cx="12" cy="2.8" r="1.1"/><circle cx="24.6" cy="3.2" r="1.1"/><circle cx="5.2" cy="5.2" r="0.9"/><circle cx="30.2" cy="5.6" r="0.9"/></g>
      <path d="M2 10 H34 L32 19 H4 Z" class="sc-pot"/><rect x="1" y="9" width="34" height="3" rx="1" class="sc-pot-d"/>
    </symbol>

    <symbol id="sc-balc" overflow="visible">
      <g class="sc-iron"><path d="M2 2 H50" stroke-width="2"/><path d="M2 19 H50" stroke-width="1.6"/>
        <path d="M6 2v17M12 2v17M18 2v17M24 2v17M30 2v17M36 2v17M42 2v17M48 2v17" stroke-width="1.2"/>
        <path d="M9 8 q3 3 0 6 M15 8 q-3 3 0 6 M33 8 q3 3 0 6 M39 8 q-3 3 0 6" stroke-width="1"/></g>
      <rect x="-1" y="19" width="54" height="5" rx="1.5" class="sc-stone"/><rect x="1" y="24" width="50" height="2.5" rx="1" class="sc-stone-d"/>
    </symbol>

    <symbol id="sc-door" overflow="visible">
      <path d="M1 16 a15 15 0 0 1 30 0 V50 H1 Z" class="sc-stone"/>
      <path d="M4 16 a12 12 0 0 1 24 0 V50 H4 Z" class="sc-wood"/>
      <path d="M6 17 a10 10 0 0 1 20 0 z" class="sc-glass"/>
      <path d="M16 7 V17 M9.5 10.5 L16 17 M22.5 10.5 L16 17" class="sc-mullion"/>
      <path d="M6 19 H26" class="sc-wood-d" stroke-width="1.6"/>
      <g class="sc-wood-f"><rect x="7" y="22" width="7" height="10" rx="1"/><rect x="18" y="22" width="7" height="10" rx="1"/><rect x="7" y="35" width="7" height="12" rx="1"/><rect x="18" y="35" width="7" height="12" rx="1"/></g>
      <circle cx="16" cy="33" r="1.3" class="sc-brass"/>
      <rect x="-1" y="48" width="34" height="2.5" class="sc-stone-d"/>
    </symbol>

    <symbol id="sc-lamp" overflow="visible">
      <path d="M0 3 H9 M9 3 q-5 2 -4 6" class="sc-iron" stroke-width="1.6"/>
      <path d="M12 3 V7" class="sc-iron" stroke-width="1.4"/>
      <path d="M8 8 H16 L17.5 20 H6.5 Z" class="sc-iron-f"/>
      <path d="M9.6 10 H14.4 L15.4 18.4 H8.6 Z" class="sc-lampglass"/>
      <path d="M6.5 8 H17.5 L12 4.5 Z" class="sc-iron-f"/>
      <path d="M10 20 H14 L12 23 Z" class="sc-iron-f"/>
    </symbol>

    <symbol id="sc-vine" overflow="visible">
      <path d="M12 0 C4 20 20 36 10 56 C2 74 20 92 10 110 C6 120 14 132 10 140" class="sc-stem"/>
      <g class="sc-leaf-d"><ellipse cx="6" cy="12" rx="5.5" ry="3" transform="rotate(-30 6 12)"/><ellipse cx="17" cy="30" rx="5.5" ry="3" transform="rotate(25 17 30)"/><ellipse cx="5" cy="50" rx="5.5" ry="3" transform="rotate(-20 5 50)"/><ellipse cx="16" cy="70" rx="5.5" ry="3" transform="rotate(30 16 70)"/><ellipse cx="6" cy="92" rx="5.5" ry="3" transform="rotate(-25 6 92)"/><ellipse cx="16" cy="112" rx="5.5" ry="3" transform="rotate(20 16 112)"/><ellipse cx="6" cy="130" rx="5" ry="2.8" transform="rotate(-30 6 130)"/></g>
      <g class="sc-leaf"><ellipse cx="15" cy="8" rx="4.5" ry="2.5" transform="rotate(30 15 8)"/><ellipse cx="4" cy="34" rx="4.5" ry="2.5" transform="rotate(-25 4 34)"/><ellipse cx="17" cy="48" rx="4.5" ry="2.5" transform="rotate(20 17 48)"/><ellipse cx="5" cy="72" rx="4.5" ry="2.5" transform="rotate(-30 5 72)"/><ellipse cx="17" cy="90" rx="4.5" ry="2.5" transform="rotate(25 17 90)"/><ellipse cx="4" cy="112" rx="4.5" ry="2.5" transform="rotate(-20 4 112)"/><ellipse cx="16" cy="128" rx="4.5" ry="2.5" transform="rotate(30 16 128)"/></g>
      <g class="sc-leaf-l"><ellipse cx="10" cy="22" rx="3" ry="1.8" transform="rotate(-40 10 22)"/><ellipse cx="11" cy="62" rx="3" ry="1.8" transform="rotate(40 11 62)"/><ellipse cx="9" cy="102" rx="3" ry="1.8" transform="rotate(-40 9 102)"/></g>
      <g class="sc-flower-l"><circle cx="8" cy="40" r="1.7"/><circle cx="15" cy="80" r="1.7"/><circle cx="7" cy="120" r="1.6"/></g>
    </symbol>

    <symbol id="sc-pot" overflow="visible">
      <ellipse cx="16" cy="43" rx="15" ry="3" class="sc-shadow"/>
      <g class="sc-leaf-d"><circle cx="16" cy="17" r="12.5"/></g>
      <g class="sc-leaf"><circle cx="11" cy="14" r="7.5"/><circle cx="20" cy="12" r="8"/><circle cx="16" cy="20" r="7"/></g>
      <g class="sc-leaf-l"><circle cx="12" cy="10" r="3.2"/><circle cx="21" cy="9" r="2.4"/><circle cx="9" cy="19" r="1.8"/></g>
      <path d="M6 27 H26 L23.5 43 H8.5 Z" class="sc-pot"/><rect x="5" y="25" width="22" height="4" rx="1.2" class="sc-pot-d"/>
    </symbol>

    <symbol id="sc-lemon" overflow="visible">
      <ellipse cx="18" cy="59" rx="16" ry="3" class="sc-shadow"/>
      <rect x="16.5" y="28" width="3" height="16" class="sc-trunk"/>
      <g class="sc-leaf-d"><circle cx="18" cy="18" r="14.5"/></g>
      <g class="sc-leaf"><circle cx="11" cy="16" r="8"/><circle cx="23" cy="13" r="9"/><circle cx="17" cy="23" r="8"/><circle cx="27" cy="22" r="6"/></g>
      <g class="sc-leaf-l"><circle cx="14" cy="10" r="3"/><circle cx="26" cy="12" r="2.2"/></g>
      <g class="sc-lemon"><circle cx="10" cy="20" r="2.6"/><circle cx="20" cy="8.5" r="2.6"/><circle cx="27" cy="17" r="2.5"/><circle cx="15" cy="28" r="2.4"/><circle cx="24" cy="27" r="2.3"/></g>
      <path d="M8 43 H28 L25.5 59 H10.5 Z" class="sc-pot"/><rect x="7" y="41" width="22" height="4" rx="1.2" class="sc-pot-d"/>
    </symbol>

    <symbol id="sc-petal" overflow="visible"><path d="M0 0 C3 -1 6 1 5 4 C4 6 1 6 0 4 C-1 2 -1 1 0 0 z" class="sc-flower-l"/></symbol>
  </defs></svg>`;
}

// Cobblestones: a 132 by 110 tile of rounded, irregular stones laid in five courses over dark
// grout. Each stone is two flat shapes: the whole stone in its darker edge tone, then a lighter
// top face that stops 3px short of the bottom, so the lower edge reads as the stone's side.
// Every course starts with a stone across the tile seam (drawn on both sides) and the last
// stone of a course is cut to meet it, so the seam never shows. Five tones: sand, clay, rose,
// cool grey and cream.
function cobblePattern() {
  const W = 132; const H = 110; const courses = 5; const step = 22; const gap = 3;
  const rnd = seeded(7);
  const tones = ['a', 'b', 'e', 'a', 'c', 'e', 'd', 'a', 'b', 'e', 'a', 'e', 'c', 'a', 'd', 'b', 'e', 'a', 'c', 'b'];
  let k = 0;
  const out = [];
  for (let r = 0; r < courses; r++) {
    const y = 2 + r * step;
    const x0 = -(4 + Math.round(rnd() * 12));
    const end = x0 + W - gap;
    let x = x0;
    while (x < end) {
      let w = 15 + Math.round(rnd() * 19);
      const remaining = end - x;
      if (remaining <= 36) w = remaining;
      else if (remaining - w - gap < 15) w = remaining - gap - 15;
      const h = 15 + Math.round(rnd() * 4);
      const dy = Math.round(rnd() * (19 - h));
      const rot = r1(rnd() * 4 - 2);
      const tone = tones[k % tones.length]; k += 1;
      const draw = (sx) => {
        const cx = r1(sx + w / 2); const cy = r1(y + dy + h / 2);
        out.push(`<g transform="rotate(${rot} ${cx} ${cy})"><rect x="${sx}" y="${y + dy}" width="${w}" height="${h}" rx="7" class="st-${tone}-d"/><rect x="${sx}" y="${y + dy}" width="${w}" height="${h - 3}" rx="6.5" class="st-${tone}"/></g>`);
      };
      draw(x);
      if (x < 0) draw(x + W);
      x += w + gap;
    }
  }
  return `<pattern id="sc-cobble" width="${W}" height="${H}" patternUnits="userSpaceOnUse" patternTransform="scale(0.72)"><rect width="${W}" height="${H}" class="sc-grout"/>${out.join('')}</pattern>`;
}

// ---- the sky at the top of the path: three flat bands, a solid sun (a moon at night), clouds

export function skyHtml() {
  const rnd = seeded(41);
  const stars = [];
  for (let i = 0; i < 30; i++) {
    stars.push(`<circle cx="${r1(rnd() * 100)}%" cy="${r1(6 + rnd() * 120)}" r="${r1(0.8 + rnd() * 0.9)}"/>`);
  }
  // Clouds: placed by percent so they spread across any width.
  const clouds = [
    { x: -4, y: 14, s: 0.8, d: 1 }, { x: 30, y: 46, s: 0.5, d: 2 }, { x: 56, y: 4, s: 0.95, d: 3 }, { x: 84, y: 54, s: 0.6, d: 1 }
  ];
  return `<svg class="sc-sky-svg" width="100%" height="100%" aria-hidden="true" focusable="false">
    <rect width="100%" height="100%" class="sc-sky-a"/>
    <rect y="46%" width="100%" height="54%" class="sc-sky-b"/>
    <rect y="82%" width="100%" height="18%" class="sc-sky-c"/>
    <g class="sc-stars">${stars.join('')}</g>
    <svg x="80%" y="12" overflow="visible"><circle class="sc-sun" cx="0" cy="30" r="28"/><circle class="sc-moon" cx="0" cy="32" r="16"/><circle class="sc-moon-bite" cx="9" cy="26" r="13"/></svg>
    ${clouds.map((c) => `<svg x="${c.x}%" y="${c.y}" overflow="visible" class="sc-cloud-drift d${c.d}"><use href="#sc-cloud" transform="scale(${c.s})"/></svg>`).join('')}
  </svg>`;
}

// ---- the road: one cobblestone layer behind the whole path

export function roadHtml() {
  return `<svg class="sc-road-svg" width="100%" height="100%" aria-hidden="true" focusable="false">
    <rect width="100%" height="100%" fill="url(#sc-cobble)"/>
  </svg>`;
}

// ---- a facade: houses stacked along one side of the street, a sidewalk and curb on the inner
// edge, pots along the curb. width is the strip's width in px; height the section's height.
// side "right" mirrors the whole strip so the sidewalk faces the road. wide picks the two
// column houses for laptops.

const WALLS = 6;
const SHUTTERS = 5;

export function facadeSvg({ seed, side, width, height }) {
  const W = Math.round(width); const H = Math.round(height);
  if (!W || !H) return '';
  const wide = W >= 100;
  const rnd = seeded(seed * 7919 + (side === 'right' ? 977 : 131));
  const walkW = wide ? 16 : 11;
  const wallW = W - walkW;
  const parts = [];
  parts.push(`<rect x="${wallW}" y="0" width="${walkW}" height="${H}" class="sc-walk"/>`);
  let y = 0; let prevWall = -1; let k = 0;
  while (y < H) {
    const hh = Math.round((wide ? 230 : 210) + rnd() * 120);
    let wall = Math.floor(rnd() * WALLS);
    if (wall === prevWall) wall = (wall + 1) % WALLS;
    prevWall = wall;
    const sh = Math.floor(rnd() * SHUTTERS);
    parts.push(houseSvg({ rnd, y, hh, wallW, wall, sh, wide, first: k === 0 }));
    y += hh; k += 1;
  }
  // The wall's shadow on the sidewalk, the curb, and the ink line where the wall meets the walk.
  parts.push(`<rect x="${wallW}" y="0" width="5" height="${H}" class="sc-shade"/><rect x="${wallW - 1}" y="0" width="1.5" height="${H}" class="sc-ink-f"/><rect x="${W - 3}" y="0" width="3" height="${H}" class="sc-curb"/>`);
  // Pots along the curb, a shrub or a lemon tree, never two of the same in a row.
  let py = 70 + rnd() * 90; let lastLemon = false;
  while (py < H - 40) {
    const lemon = !lastLemon && rnd() < 0.45;
    lastLemon = lemon;
    const x = W - (lemon ? 27 : 24) - Math.round(rnd() * 4);
    parts.push(lemon ? `<use href="#sc-lemon" x="${x}" y="${Math.round(py - 60)}"/>` : `<use href="#sc-pot" x="${x}" y="${Math.round(py - 44)}"/>`);
    py += (wide ? 130 : 170) + rnd() * 140;
  }
  // A few petals on the sidewalk.
  for (let i = 0; i < Math.max(2, Math.floor(H / 260)); i++) {
    parts.push(`<use href="#sc-petal" x="${r1(wallW + 2 + rnd() * (walkW - 6))}" y="${Math.round(rnd() * H)}" transform="rotate(${Math.round(rnd() * 360)} ${r1(wallW + walkW / 2)} ${Math.round(H / 2)})"/>`);
  }
  const flip = side === 'right' ? ` transform="translate(${W} 0) scale(-1 1)"` : '';
  return `<svg class="sc-facade" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false"><g${flip}>${parts.join('')}</g></svg>`;
}

function houseSvg({ rnd, y, hh, wallW, wall, sh, wide, first }) {
  const out = [];
  out.push(`<g class="sc-house" style="--wall:var(--sc-wall-${wall + 1});--wall-d:var(--sc-wall-${wall + 1}-d);--sh:var(--sc-sh-${sh + 1})" transform="translate(0 ${y})">`);
  out.push(`<rect x="0" y="0" width="${wallW}" height="${hh}" class="sc-wall"/>`);
  out.push(`<rect x="0" y="0" width="${wallW}" height="${hh}" fill="url(#sc-plaster)"/>`);
  out.push(`<rect x="0" y="${hh - 14}" width="${wallW}" height="14" class="sc-skirt"/>`);
  // Roof: a band of tiles with an eave shadow under it. The first house of a section gets a
  // deeper roof so the row reads as a new house.
  const roofH = first ? 15 : 12;
  out.push(`<rect x="-2" y="0" width="${wallW + 4}" height="${roofH}" fill="url(#sc-tiles)"/><rect x="-2" y="${roofH - 1}" width="${wallW + 4}" height="3" class="sc-roof-d"/><rect x="0" y="${roofH + 2}" width="${wallW}" height="7" class="sc-eave"/>`);

  const cols = wide ? [10, wallW - 50] : [Math.round((wallW - 40) / 2)];
  const rowStep = wide ? 76 : 80;
  const rows = [];
  let wy = roofH + 24;
  while (wy + 50 < hh - (wide ? 66 : 58)) { rows.push(wy); wy += rowStep; }
  const arched = rnd() < 0.62;
  const win = arched ? '#sc-win' : '#sc-win-sq';
  let lampDone = false;
  rows.forEach((ry, r) => {
    const lampHere = !lampDone && rnd() < (wide ? 0.4 : 0.32);
    cols.forEach((cx, c) => {
      out.push(`<use href="${win}" x="${cx}" y="${ry}"/>`);
      const v = rnd();
      const skip = lampHere && !wide;
      if (!skip && v < 0.48) out.push(`<use href="#sc-box" x="${cx + 2}" y="${ry + 37}"/>`);
      else if (!skip && v < 0.72) out.push(`<use href="#sc-balc" x="${cx - 6}" y="${ry + 30}"/>`);
      if (wide && c === 0 && r === 0 && rnd() < 0.3) out.push(`<rect x="0" y="${ry + 52}" width="${wallW}" height="2.5" class="sc-course"/>`);
    });
    if (lampHere) {
      lampDone = true;
      if (wide) out.push(`<use href="#sc-lamp" x="${Math.round(wallW / 2 - 9)}" y="${ry + 6}"/>`);
      else out.push(`<use href="#sc-lamp" x="${wallW - 20}" y="${ry + 52}"/>`);
    }
  });
  // Ground floor: a door, and on wide houses a window beside it.
  const doorX = wide ? (rnd() < 0.5 ? 14 : wallW - 48) : Math.round((wallW - 32) / 2);
  const door = wide || rnd() < 0.6;
  if (door) out.push(`<use href="#sc-door" x="${doorX}" y="${hh - 50}"/>`);
  else out.push(`<use href="${win}" x="${cols[0]}" y="${hh - 60}"/><use href="#sc-box" x="${cols[0] + 2}" y="${hh - 23}"/>`);
  if (wide) {
    const gx = doorX < wallW / 2 ? wallW - 50 : 10;
    out.push(`<use href="#sc-win-sq" x="${gx}" y="${hh - 58}"/>`);
    if (rnd() < 0.6) out.push(`<use href="#sc-box" x="${gx + 2}" y="${hh - 21}"/>`);
    if (rnd() < 0.5) out.push(`<use href="#sc-lamp" x="${doorX < wallW / 2 ? doorX + 36 : doorX - 22}" y="${hh - 64}"/>`);
  }
  // A vine climbing from the ground along the outer edge.
  if (rnd() < (wide ? 0.55 : 0.4)) {
    const vy = Math.round(hh - 150 - rnd() * 40);
    out.push(`<use href="#sc-vine" x="${wide ? 0 : -7}" y="${Math.max(roofH + 6, vy)}"/>`);
  }
  out.push('</g>');
  return out.join('');
}

// ---- papel picado, strung from the house on one side to the house on the other. Flat flags
// with an ink outline, holes cut so the street shows through.

export function garlandHtml(si) {
  const W = 560; const H = 48;
  const count = 9;
  const flagW = 34; const flagH = 36;
  const sag = 10;
  const stringPath = `M0 4 Q${W / 2} ${4 + sag * 2} ${W} 4`;
  const flags = [];
  for (let k = 0; k < count; k++) {
    const t = (k + 0.5) / count;
    const x = t * W;
    const y = 4 + 2 * sag * (1 - t) * t * 2;
    const cls = (k + si) % 2 === 0 ? 'a' : 'b';
    const left = x - flagW / 2;
    const cx = x; const cy = y + flagH * 0.44;
    const hole = (hx, hy, r) => `M${r1(hx - r)} ${r1(hy)} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 z`;
    // A rectangle with a scalloped bottom edge, holes cut out so the street shows through.
    const d = `M${r1(left)} ${r1(y)} h${flagW} v${flagH - 8} l-${flagW / 4} 6 l-${flagW / 4} -5 l-${flagW / 4} 5 l-${flagW / 4} -6 z `
      + hole(cx, cy, 4) + hole(cx - 8.5, cy - 9, 2) + hole(cx + 8.5, cy - 9, 2) + hole(cx, cy + 10, 1.8) + hole(cx - 8.5, cy + 6, 1.4) + hole(cx + 8.5, cy + 6, 1.4);
    flags.push(`<g class="g-flag ${cls}" style="--i:${k}"><path d="${d}" fill-rule="evenodd"/></g>`);
  }
  return `<div class="psec-garland" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}"><path class="g-string" d="${stringPath}"/><circle class="g-hook" cx="0" cy="4" r="2.6"/><circle class="g-hook" cx="${W}" cy="4" r="2.6"/>${flags.join('')}</svg></div>`;
}

// ---- draw or refresh the facades of every section in a painted path. Called after paint and
// on resize; a section is only rebuilt when its size changed.

export function drawFacades(root) {
  const sections = root.querySelectorAll('.psec');
  sections.forEach((sec, si) => {
    sec.querySelectorAll('.sc-side').forEach((el) => {
      const w = el.offsetWidth; const h = el.offsetHeight;
      const side = el.classList.contains('right') ? 'right' : 'left';
      const key = `${si}:${side}:${w}:${h}`;
      if (el.dataset.key === key) return;
      el.dataset.key = key;
      el.innerHTML = facadeSvg({ seed: si + 1, side, width: w, height: h });
    });
  });
}
