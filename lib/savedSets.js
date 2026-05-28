/**
 * localStorage CRUD for saved competitor sets.
 * Client-only — guards window access.
 */

const KEY = 'aso_saved_competitor_sets';

function isClient() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

export function loadSavedSets() {
  if (!isClient()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persist(sets) {
  if (!isClient()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(sets));
  } catch {
    // ignore
  }
}

export function saveSet({ name, googleIds, appleIds }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Set name required.');

  const sets = loadSavedSets();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newSet = {
    id,
    name: trimmedName,
    googleIds: Array.isArray(googleIds) ? googleIds : [],
    appleIds: Array.isArray(appleIds) ? appleIds : [],
    createdAt: new Date().toISOString(),
  };

  // Replace if same name exists, else prepend
  const filtered = sets.filter((s) => s.name !== trimmedName);
  filtered.unshift(newSet);
  persist(filtered.slice(0, 30)); // cap at 30
  return newSet;
}

export function deleteSet(id) {
  const sets = loadSavedSets().filter((s) => s.id !== id);
  persist(sets);
}

export function getSet(id) {
  return loadSavedSets().find((s) => s.id === id) || null;
}

export function clearAllSets() {
  if (!isClient()) return;
  localStorage.removeItem(KEY);
}
