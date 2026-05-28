/**
 * In-memory cache for scraped store data, keyed by {store, appId, country, language}.
 *
 * TTL default 60min. Survives across requests within same Next.js process.
 * Reset on dev server restart.
 *
 * NOT cluster-safe. Fine for single-machine local tool. For prod swap for Redis.
 */

const DEFAULT_TTL_MS = 60 * 60 * 1000;

class TTLCache {
  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  _key({ store, appId, country, language }) {
    return `${store}::${appId}::${country}::${language}`;
  }

  get(input) {
    const key = this._key(input);
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(input, value) {
    const key = this._key(input);
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear() {
    this.map.clear();
  }

  size() {
    return this.map.size;
  }
}

// Singleton per process
let _instance = null;
export function getScrapeCache() {
  if (!_instance) _instance = new TTLCache();
  return _instance;
}
