/**
 * localStorage CRUD for saved app profiles (own apps).
 * Different from savedSets — these store your own app identity + brand.
 */

const KEY = 'aso_saved_apps';

function isClient() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

export function loadSavedApps() {
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

function persist(apps) {
  if (!isClient()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(apps));
  } catch {}
}

export function saveApp({
  name,
  googleAppId,
  appleAppId,
  targetAppName,
  category,
  preLaunch,
  selectedLocales,
}) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('App profile name required.');

  const apps = loadSavedApps();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newApp = {
    id,
    name: trimmedName,
    googleAppId: String(googleAppId || '').trim(),
    appleAppId: String(appleAppId || '').trim(),
    targetAppName: String(targetAppName || '').trim(),
    category: String(category || '').trim(),
    preLaunch: !!preLaunch,
    selectedLocales: Array.isArray(selectedLocales) ? selectedLocales : ['en-US'],
    createdAt: new Date().toISOString(),
  };

  // Replace if same name exists
  const filtered = apps.filter((a) => a.name !== trimmedName);
  filtered.unshift(newApp);
  persist(filtered.slice(0, 30));
  return newApp;
}

export function deleteApp(id) {
  persist(loadSavedApps().filter((a) => a.id !== id));
}

export function getApp(id) {
  return loadSavedApps().find((a) => a.id === id) || null;
}
