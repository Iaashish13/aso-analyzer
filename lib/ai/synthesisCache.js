/**
 * In-memory TTL cache for fully-validated synthesizeAso outputs.
 *
 * Keyed by sha256 of the inputs that affect output: asoPlanJson + locale +
 * brandName. Identical input → identical output, so the entire model pipeline
 * (including concept extraction + retries) is skipped on hit.
 *
 * Only fully-validated outputs (validationIssues.length === 0) are cached —
 * partial outputs may have been salvageable with another retry and shouldn't
 * become sticky.
 *
 * TTL default 60min. Singleton per process. Not cluster-safe.
 */

import { createHash } from 'node:crypto';

const DEFAULT_TTL_MS = 60 * 60 * 1000;

class SynthesisTTLCache {
  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
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
export function getSynthesisCache() {
  if (!_instance) _instance = new SynthesisTTLCache();
  return _instance;
}

/**
 * Compute a stable cache key for a synthesis request. Hash covers everything
 * that influences output. Excludes config like maxRetries (doesn't change
 * the answer, only the path to it).
 */
export function buildSynthesisCacheKey({ asoPlanJson, locale, brandName, model }) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({
    asoPlanJson: asoPlanJson || null,
    locale: locale || null,
    brandName: brandName || '',
    model: model || '',
  }));
  return hash.digest('hex');
}
