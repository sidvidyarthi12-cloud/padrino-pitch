// Every photo in the app, in one place. All from Unsplash, free under the Unsplash License,
// each with the photographer's name and page so the credit can show wherever the photo does.
// Picked by hand for real wedding moments that feel right for El Paso and Juarez couples.

const PHOTOS = {
  couple: {
    id: 'photo-1566251632351-08565418c72c',
    alt: 'A groom in a hat and a bride laughing together in soft afternoon light',
    by: 'Cesira Alvarado', byUrl: 'https://unsplash.com/@cesiraalvarado',
    page: 'https://unsplash.com/photos/wedding-couple-on-focus-photography-6AwvOiO7wOQ',
    tone: '#C9B7A4', pos: '50% 15%'
  },
  venue: {
    id: 'photo-1642896121804-535bb287d471',
    alt: 'A bride and groom walking out of a hacienda doorway while family throws petals',
    by: 'Asdrubal Luna', byUrl: 'https://unsplash.com/@infectedluna',
    page: 'https://unsplash.com/photos/a-bride-and-groom-walking-down-the-aisle-DQZMol8wKm4',
    tone: '#8E7F73', pos: '50% 35%'
  },
  mariachi: {
    id: 'photo-1764593821920-6d6c9f541280',
    alt: 'A couple dancing their first dance while a mariachi band plays',
    by: 'Samuel Cruz', byUrl: 'https://unsplash.com/@fotografosamuelcruz',
    page: 'https://unsplash.com/photos/couple-dances-as-mariachi-band-plays-at-wedding-reception-WtnYOvIh2dM',
    tone: '#6B4A2F', pos: '50% 45%'
  },
  rings: {
    id: 'photo-1529634806980-85c3dd6d34ac',
    alt: 'Two hands with new wedding rings resting over a bouquet',
    by: 'Samantha Gades', byUrl: 'https://unsplash.com/@srosinger3997',
    page: 'https://unsplash.com/photos/couple-wearing-silver-colored-rings-RHAtRIT3-CE',
    tone: '#C7A58C', pos: '50% 45%'
  },
  family: {
    id: 'photo-1775126964346-d4b6e7c5e4f0',
    alt: 'A bride lifted onto shoulders by family and friends at the reception',
    by: 'Ben Atkins', byUrl: 'https://unsplash.com/@benatkinsphotography',
    page: 'https://unsplash.com/photos/bride-is-carried-on-shoulders-at-a-wedding-celebration-_F_8O7yNeM4',
    tone: '#6E5E55', pos: '50% 30%'
  },
  flowers: {
    id: 'photo-1571984128445-91f01fd094ae',
    alt: 'A bride holding a bouquet of peach and orange roses',
    by: 'Eugenia Pankiv', byUrl: 'https://unsplash.com/@eugenivy_now',
    page: 'https://unsplash.com/photos/selective-focus-photography-of-bride-holding-flower-bouquet-2OGGDHT-3GA',
    tone: '#D9B5A4', pos: '50% 55%'
  },
  table: {
    id: 'photo-1674965381554-955d6a573354',
    alt: 'A reception table set with white and orange flowers',
    by: 'Camara Negra', byUrl: 'https://unsplash.com/@camaranegra',
    page: 'https://unsplash.com/photos/a-table-is-set-with-white-and-orange-flowers-SIf1TtKabVE',
    tone: '#9A8F7E', pos: '50% 55%'
  },
  after: {
    id: 'photo-1566251615470-1638646b7970',
    alt: 'A just married couple holding hands and laughing',
    by: 'Cesira Alvarado', byUrl: 'https://unsplash.com/@cesiraalvarado',
    page: 'https://unsplash.com/photos/woman-and-man-holding-hands-3kB-SOEmmCU',
    tone: '#C4B3A3', pos: '50% 25%'
  },
  desert: {
    id: 'photo-1566251622200-2f8d49acc33d',
    alt: 'A bride and groom in the desert under a wide blue sky',
    by: 'Cesira Alvarado', byUrl: 'https://unsplash.com/@cesiraalvarado',
    page: 'https://unsplash.com/photos/man-and-woman-standing-near-trees-at-daytime-fPGRde6_vyU',
    tone: '#9FB4C9', pos: '50% 60%'
  }
};

export function getPhoto(key) {
  return PHOTOS[key] || PHOTOS.couple;
}

export function photoUrl(key, { w = 1200, h = null, q = 70 } = {}) {
  const p = getPhoto(key);
  const size = h ? `w=${w}&h=${h}&fit=crop&crop=faces` : `w=${w}&fit=crop`;
  return `https://images.unsplash.com/${p.id}?${size}&q=${q}&auto=format`;
}

// A photo block: a solid tone while it loads, the image on top, and a small credit.
// The credit links to the photographer and to Unsplash, the way the license asks.
export function photoHtml(key, { w = 1200, h = 600, cls = '', credit = true, eager = false } = {}) {
  const p = getPhoto(key);
  const src = photoUrl(key, { w, h });
  const src2x = photoUrl(key, { w: w * 2, h: h * 2, q: 60 });
  return `<div class="photo ${cls}" style="--tone:${p.tone}">
    <img src="${src}" srcset="${src} 1x, ${src2x} 2x" alt="${escapeAttr(p.alt)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" style="object-position:${p.pos}">
    ${credit ? photoCredit(key) : ''}
  </div>`;
}

export function photoCredit(key) {
  const p = getPhoto(key);
  return `<span class="photo-credit">Photo <a href="${p.page}?utm_source=padrino&utm_medium=referral" target="_blank" rel="noopener">${escapeAttr(p.by)}</a> on <a href="https://unsplash.com/?utm_source=padrino&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a></span>`;
}

export function allPhotos() {
  return Object.entries(PHOTOS).map(([key, p]) => ({ key, ...p }));
}

function escapeAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
