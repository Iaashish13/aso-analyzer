/**
 * In-memory TTL cache for extracted AppConcept JSON, keyed by {store, appId}.
 *
 * Concept describes "what this app does" — stable across locales and reruns.
 * Extracting once per appId avoids paying the LLM cost per locale.
 *
 * TTL default 60min. Singleton per process. Not cluster-safe.
 */

const DEFAULT_TTL_MS = 60 * 60 * 1000;

class ConceptTTLCache {
  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  _key({ store, appId }) {
    return `${store}::${appId}`;
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

let _instance = null;
export function getConceptCache() {
  if (!_instance) _instance = new ConceptTTLCache();
  return _instance;
}
