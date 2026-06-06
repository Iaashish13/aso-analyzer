/**
 * Brand name normalization.
 *
 * Scraped store titles often follow the pattern "Brand: Best Tagline Ever"
 * or "Brand - Catchy Subtitle" — the part after the separator is marketing
 * filler that changes between locales and across listing rewrites. The
 * stable identity is the leftmost chunk.
 *
 * Used everywhere we resolve a brand name (user input, scraped title fallback)
 * so the synthesizer always gets the clean brand and brand-presence
 * validation doesn't false-fail on tagline mismatches.
 */

const SEPARATORS = /[-–—:|·•]/;

export function normalizeBrandName(name) {
  if (!name) return '';
  return String(name)
    .split(SEPARATORS)[0]
    .replace(/\s+/g, ' ')
    .trim();
}
