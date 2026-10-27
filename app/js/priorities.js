// The fixed priority list from SPEC.md, and how two top-3 lists become one.
// Which budget lines a priority protects lives in money.js (PRIORITY_LINES).

export const PRIORITIES = [
  { id: 'venue', label: 'Venue' },
  { id: 'food', label: 'Food' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'photo', label: 'Photos' },
  { id: 'video', label: 'Video' },
  { id: 'music', label: 'Music' },
  { id: 'dress', label: 'Dress and attire' },
  { id: 'flowers', label: 'Flowers' },
  { id: 'decor', label: 'Decor' },
  { id: 'hair-makeup', label: 'Hair and makeup' },
  { id: 'rings', label: 'Rings' },
  { id: 'honeymoon', label: 'Honeymoon' },
  { id: 'guests-comfort', label: 'Guest comfort' },
  { id: 'invitations', label: 'Invitations' }
];

export function priorityLabel(id) {
  return PRIORITIES.find((p) => p.id === id)?.label || id;
}

// Two top-3 lists become one. Shared picks first, then take turns from each list.
export function combineTop(a = [], b = []) {
  const shared = a.filter((id) => b.includes(id));
  const out = [...shared];
  const restA = a.filter((id) => !shared.includes(id));
  const restB = b.filter((id) => !shared.includes(id));
  let i = 0;
  while (out.length < 3 && (i < restA.length || i < restB.length)) {
    if (i < restA.length && !out.includes(restA[i])) out.push(restA[i]);
    if (out.length < 3 && i < restB.length && !out.includes(restB[i])) out.push(restB[i]);
    i += 1;
  }
  return out.slice(0, 3);
}

export function sharedPicks(a = [], b = []) {
  return a.filter((id) => b.includes(id));
}
