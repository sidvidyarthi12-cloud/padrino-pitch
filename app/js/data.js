// Loads the JSON data files once and caches them.
// The files are owned by the data builder. Shapes are in SPEC.md.

const cache = new Map();

async function getJSON(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(path).then(async (res) => {
    if (!res.ok) {
      cache.delete(path);
      throw new Error(`Could not load ${path} (${res.status})`);
    }
    return res.json();
  });
  cache.set(path, p);
  return p;
}

export const getTemplate = () => getJSON('data/budget-template.json');
export const getCuts = () => getJSON('data/cuts.json');
export const getLessons = () => getJSON('data/lessons.json');
export const getFeatures = () => getJSON('data/features.json');
export const getDemoCouple = () => getJSON('data/demo-couple.json');
export const getSampleQuote = () => getJSON('data/sample-quote-decoded.json');

// Template rows keyed by id, for typical ranges and sources on the budget screen.
export async function getTemplateById() {
  const rows = await getTemplate();
  const map = new Map();
  for (const r of rows || []) map.set(r.id, r);
  return map;
}

export async function getLessonsById() {
  const rows = await getLessons();
  const map = new Map();
  for (const r of rows || []) map.set(Number(r.id), r);
  return map;
}
