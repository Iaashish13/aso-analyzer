/**
 * In-memory TTL cache for canonical EN myApp listings, keyed by {store, appId}.
 *
 * The EN listing acts as a stable semantic anchor when generating non-English
 * locales. We fetch it once per app, reuse across all non-EN locales.
 *
 * In-flight dedup prevents the N-parallel-locales thundering-herd: only one
 * fetch runs even if many locale jobs start simultaneously.
 *
 * TTL default 60min. Singleton per process. Not cluster-safe.
 */

import { fetchGooglePlayMyApp, fetchAppStoreMyApp } from './scraper.js';

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const EN_LOCALE = { country: 'us', language: 'en' };

const _cache = new Map();    // key -> { value, expiresAt }
const _inflight = new Map(); // key -> Promise<value|null>

function key(store, appId) {
  return `${store}::${appId}`;
}

/**
 * Fetch (or return cached) canonical EN myApp listing. Returns null on
 * failure — caller should degrade gracefully without the anchor.
 */
export async function getCanonicalEnListing(store, appId) {
  if (!store || !appId) return null;
  const k = key(store, appId);

  const cached = _cache.get(k);
  if (cached && Date.now() <= cached.expiresAt) return cached.value;

  const existing = _inflight.get(k);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const value = store === 'google'
        ? await fetchGooglePlayMyApp(appId, EN_LOCALE)
        : await fetchAppStoreMyApp(appId, EN_LOCALE);
      _cache.set(k, { value, expiresAt: Date.now() + DEFAULT_TTL_MS });
      return value;
    } catch {
      return null;
    } finally {
      _inflight.delete(k);
    }
  })();
  _inflight.set(k, promise);
  return promise;
}
