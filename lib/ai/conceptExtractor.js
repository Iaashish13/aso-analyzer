/**
 * AppConcept extractor.
 *
 * Distills a store listing into a stable, language-agnostic concept that
 * locks "what this app does" across every locale + rerun. Without this,
 * each locale synthesis call re-derives meaning and drifts.
 *
 * Cached by (store, appId) — extracted once per app, reused everywhere.
 */

import { z } from 'zod';
import { generate, ProviderError } from './provider.js';
import { getConceptCache } from './conceptCache.js';

// ── Output schema ────────────────────────────────────────────────────────────
export const AppConceptSchema = z.object({
  corePurpose: z.string().min(1).max(300),
  primaryAudience: z.string().min(1).max(200),
  keyFeatures: z.array(z.string().min(1).max(120)).min(1).max(10),
  differentiators: z.array(z.string().min(1).max(200)).max(5).default([]),
  useCases: z.array(z.string().min(1).max(200)).max(8).default([]),
  category: z.string().max(80).default(''),
  tone: z.string().max(40).default(''),
});

// ── Prompt ───────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an App Store Optimization analyst. Your job: read one app's store listing and extract a structured concept that captures WHAT the app does and WHO it's for — independent of marketing copy or language.

This concept will be reused as the SOLE source of truth for "what this app is" when generating localized store listings across many countries. It must be accurate, concrete, and free of fluff.

Rules:
- corePurpose: ONE sentence, plain English, describing what the app actually does for the user. No marketing adjectives.
- primaryAudience: ONE sentence describing who uses this — demographics, role, or need.
- keyFeatures: 3-7 concrete features the app provides. Verbs, not adjectives. Each ≤120 chars.
- differentiators: 1-3 things that make this app distinct from typical competitors (if any are evident). Can be empty.
- useCases: 3-5 specific scenarios when someone would open this app.
- category: the app's functional category (e.g., "puzzle game", "habit tracker", "language learning").
- tone: ONE word for the brand voice — playful / professional / minimalist / energetic / educational / etc.

Output ONLY a single valid JSON object. No prose, no markdown fences. Schema:

{
  "corePurpose": "string",
  "primaryAudience": "string",
  "keyFeatures": ["string", ...],
  "differentiators": ["string", ...],
  "useCases": ["string", ...],
  "category": "string",
  "tone": "string"
}`;

function buildUserPrompt({ brandName, listing, category }) {
  return `Extract the AppConcept for this app. Brand: "${brandName || '(unknown)'}". Store category hint: "${category || '(none)'}".

Listing data:
\`\`\`json
${JSON.stringify(listing, null, 2)}
\`\`\`

Return the JSON object now.`;
}

function extractJson(text) {
  if (!text) throw new Error('Empty response');
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fence ? fence[1] : text;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    throw new Error('No JSON object found');
  }
  return JSON.parse(candidate.slice(first, last + 1));
}

/**
 * Extract concept from listing via LLM. No cache.
 *
 * @param {{
 *   provider: any,
 *   brandName?: string,
 *   listing: object,
 *   category?: string,
 *   abortSignal?: AbortSignal,
 *   model?: string,
 * }} input
 */
export async function extractAppConcept({ provider, brandName, listing, category, abortSignal, model }) {
  if (!listing || typeof listing !== 'object') {
    throw new ProviderError('listing required for concept extraction', { code: 'BAD_INPUT' });
  }
  const userPrompt = buildUserPrompt({ brandName, listing, category });
  const result = await generate(provider, {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    abortSignal,
    model,
  });

  let parsed;
  try {
    parsed = extractJson(result.text);
  } catch (err) {
    throw new ProviderError(`Concept JSON parse failed: ${err.message}`, {
      code: 'CONCEPT_PARSE_FAILED',
      cause: err,
    });
  }

  try {
    return AppConceptSchema.parse(parsed);
  } catch (err) {
    throw new ProviderError(`Concept schema validation failed: ${err.message}`, {
      code: 'CONCEPT_SCHEMA_INVALID',
      cause: err,
    });
  }
}

// In-flight dedup map. When N parallel callers (e.g. concurrent locale
// synthesis) request the same (store, appId), only one LLM extraction runs;
// the rest await the same Promise. Without this, parallel calls all miss
// the cache simultaneously and each fire their own redundant LLM call.
const _inflight = new Map();

function inflightKey(store, appId) {
  return `${store}::${appId}`;
}

/**
 * Cache-aware concept fetcher with in-flight dedup. Returns null on failure
 * rather than throwing, so caller can degrade gracefully (synthesis still
 * works without concept).
 *
 * @param {{
 *   provider: any,
 *   store: 'google' | 'apple',
 *   appId: string,
 *   brandName?: string,
 *   listing: object,
 *   category?: string,
 *   abortSignal?: AbortSignal,
 *   model?: string,
 * }} input
 * @returns {Promise<{ concept: object|null, cached: boolean, dedup?: boolean, error?: string }>}
 */
export async function getOrExtractAppConcept({ provider, store, appId, brandName, listing, category, abortSignal, model }) {
  if (!store || !appId) {
    return { concept: null, cached: false, error: 'missing store or appId' };
  }
  const cache = getConceptCache();
  const cached = cache.get({ store, appId });
  if (cached) return { concept: cached, cached: true };

  const key = inflightKey(store, appId);
  const existing = _inflight.get(key);
  if (existing) {
    const concept = await existing;
    return concept
      ? { concept, cached: false, dedup: true }
      : { concept: null, cached: false, dedup: true, error: 'concurrent extraction failed' };
  }

  if (!listing) return { concept: null, cached: false, error: 'no listing to extract from' };

  const promise = (async () => {
    try {
      const concept = await extractAppConcept({ provider, brandName, listing, category, abortSignal, model });
      cache.set({ store, appId }, concept);
      return concept;
    } catch {
      return null;
    } finally {
      _inflight.delete(key);
    }
  })();
  _inflight.set(key, promise);

  const concept = await promise;
  return concept
    ? { concept, cached: false }
    : { concept: null, cached: false, error: 'extraction failed' };
}
