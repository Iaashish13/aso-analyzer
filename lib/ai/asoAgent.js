/**
 * ASO synthesis agent.
 *
 * Input: factual asoPlanJson (scraped data + keyword gaps).
 * Output: store-ready copy validated against char limits.
 *
 * The agent does NOT scrape — it reasons over facts already collected.
 */

import { z } from 'zod';
import { generate, ProviderError } from './provider.js';
import { getOrExtractAppConcept, extractAppConcept } from './conceptExtractor.js';
import { getSynthesisCache, buildSynthesisCacheKey } from './synthesisCache.js';

// ── Char limits (enforced by stores) ─────────────────────────────────────────
export const LIMITS = {
  apple: {
    title: 30,
    subtitle: 30,
    keywordField: 100,
    promotionalText: 170,
    description: 4000,
  },
  google: {
    title: 30,
    shortDescription: 80,
    fullDescription: 4000,
  },
};

// ── Output schema ────────────────────────────────────────────────────────────
const ScreenshotSchema = z.object({
  screen: z.number().int().min(1).max(10),
  headline: z.string().min(1).max(40),
  supportingText: z.string().max(80),
});

const KeywordStrategySchema = z.object({
  primary: z.array(z.string()).min(1).max(10),
  secondary: z.array(z.string()).max(20),
  appleKeywordFieldTerms: z.array(z.string()).max(30),
  reasoning: z.array(z.string()).min(1).max(20),
});

export const FinalAsoContentSchema = z.object({
  apple: z.object({
    title: z.string().min(1),
    subtitle: z.string().min(1),
    keywordField: z.string().min(1),
    promotionalText: z.string().min(1),
    description: z.string().min(1),
    rationale: z.string().optional().default(''),
  }),
  google: z.object({
    title: z.string().min(1),
    shortDescription: z.string().min(1),
    fullDescription: z.string().min(1),
    rationale: z.string().optional().default(''),
  }),
  screenshots: z.array(ScreenshotSchema).min(3).max(8),
  keywordStrategy: KeywordStrategySchema,
  notes: z.array(z.string()).max(20).default([]),
});

const FinalAsoContentJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    apple: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 1 },
        subtitle: { type: 'string', minLength: 1 },
        keywordField: { type: 'string', minLength: 1 },
        promotionalText: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
        rationale: { type: 'string' },
      },
      required: ['title', 'subtitle', 'keywordField', 'promotionalText', 'description', 'rationale'],
    },
    google: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 1 },
        shortDescription: { type: 'string', minLength: 1 },
        fullDescription: { type: 'string', minLength: 1 },
        rationale: { type: 'string' },
      },
      required: ['title', 'shortDescription', 'fullDescription', 'rationale'],
    },
    screenshots: {
      type: 'array',
      minItems: 3,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          screen: { type: 'integer', minimum: 1, maximum: 10 },
          headline: { type: 'string', minLength: 1, maxLength: 40 },
          supportingText: { type: 'string', maxLength: 80 },
        },
        required: ['screen', 'headline', 'supportingText'],
      },
    },
    keywordStrategy: {
      type: 'object',
      additionalProperties: false,
      properties: {
        primary: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: { type: 'string' },
        },
        secondary: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string' },
        },
        appleKeywordFieldTerms: {
          type: 'array',
          maxItems: 30,
          items: { type: 'string' },
        },
        reasoning: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: { type: 'string' },
        },
      },
      required: ['primary', 'secondary', 'appleKeywordFieldTerms', 'reasoning'],
    },
    notes: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string' },
    },
  },
  required: ['apple', 'google', 'screenshots', 'keywordStrategy', 'notes'],
};

const FINAL_ASO_CONTENT_TOOL = {
  name: 'submit_final_aso_content',
  description: 'Submit the complete final ASO content object for Apple App Store and Google Play.',
  inputSchema: FinalAsoContentJsonSchema,
};

// ── Script ranges for language detection ─────────────────────────────────────
// Maps a language code to a regex matching at least one char in its script.
// Only covers langs where script != Latin (where detection is reliable).
const SCRIPT_PATTERNS = {
  ja: /[぀-ヿ一-鿿]/,         // Hiragana + Katakana + Kanji
  ko: /[가-힯ᄀ-ᇿ]/,         // Hangul
  zh: /[一-鿿]/,                       // Han
  ru: /[Ѐ-ӿ]/,                       // Cyrillic
  uk: /[Ѐ-ӿ]/,
  ar: /[؀-ۿ]/,
  he: /[֐-׿]/,
  th: /[฀-๿]/,
  hi: /[ऀ-ॿ]/,
};

function validateLanguage(content, langCode) {
  const pattern = SCRIPT_PATTERNS[langCode];
  if (!pattern) return []; // Latin-script langs: skip (unreliable without dict)
  const issues = [];
  const samples = [
    ['Apple title', content.apple?.title],
    ['Apple subtitle', content.apple?.subtitle],
    ['Apple description', content.apple?.description],
    ['Google title', content.google?.title],
    ['Google shortDescription', content.google?.shortDescription],
    ['Google fullDescription', content.google?.fullDescription],
  ];
  for (const [label, text] of samples) {
    if (text && !pattern.test(text)) {
      issues.push(`${label} not in target language (${langCode}) — no native-script chars detected`);
    }
  }
  return issues;
}

function validateBrand(content, brandName) {
  if (!brandName) return [];
  const issues = [];
  const brand = brandName.trim();
  if (content.apple?.title && !content.apple.title.includes(brand)) {
    issues.push(`Apple title missing brand "${brand}" verbatim`);
  }
  if (content.google?.title && !content.google.title.includes(brand)) {
    issues.push(`Google title missing brand "${brand}" verbatim`);
  }
  if (content.apple?.description && !content.apple.description.includes(brand)) {
    issues.push(`Apple description missing brand "${brand}" verbatim`);
  }
  if (content.google?.fullDescription && !content.google.fullDescription.includes(brand)) {
    issues.push(`Google fullDescription missing brand "${brand}" verbatim`);
  }
  return issues;
}

// ── Char-limit validation ────────────────────────────────────────────────────
export function validateCharLimits(content) {
  const issues = [];
  const a = content.apple || {};
  const g = content.google || {};

  if (a.title?.length > LIMITS.apple.title)
    issues.push(`Apple title ${a.title.length}/${LIMITS.apple.title} chars`);
  if (a.subtitle?.length > LIMITS.apple.subtitle)
    issues.push(`Apple subtitle ${a.subtitle.length}/${LIMITS.apple.subtitle} chars`);
  if (a.keywordField?.length > LIMITS.apple.keywordField)
    issues.push(`Apple keyword field ${a.keywordField.length}/${LIMITS.apple.keywordField} chars`);
  if (a.promotionalText?.length > LIMITS.apple.promotionalText)
    issues.push(`Apple promo text ${a.promotionalText.length}/${LIMITS.apple.promotionalText} chars`);
  if (g.title?.length > LIMITS.google.title)
    issues.push(`Google title ${g.title.length}/${LIMITS.google.title} chars`);
  if (g.shortDescription?.length > LIMITS.google.shortDescription)
    issues.push(`Google short desc ${g.shortDescription.length}/${LIMITS.google.shortDescription} chars`);

  // Apple keyword field hygiene
  if (a.keywordField && /,\s+/.test(a.keywordField)) {
    issues.push('Apple keyword field has spaces after commas (wastes chars)');
  }

  return issues;
}

// ── JSON extraction (model may wrap in markdown fence) ───────────────────────
function findJsonObjectBounds(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    }
  }

  return null;
}

function stripTrailingCommas(jsonStr) {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ',') {
      const rest = jsonStr.slice(i + 1);
      const next = rest.match(/\S/)?.[0];
      if (next === '}' || next === ']') continue;
    }

    out += ch;
  }

  return out;
}

function stripDanglingValuePeriods(jsonStr) {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '.') {
      const prev = out.match(/\S(?=\s*$)/)?.[0];
      const next = jsonStr.slice(i + 1).match(/\S/)?.[0];
      if ((prev === '"' || prev === '}' || prev === ']') && (next === ',' || next === '}' || next === ']')) {
        continue;
      }
    }

    out += ch;
  }

  return out;
}

function parseErrorContext(err, jsonStr) {
  const pos = Number(err.message.match(/position (\d+)/)?.[1]);
  if (!Number.isFinite(pos)) return err.message;

  const start = Math.max(0, pos - 80);
  const end = Math.min(jsonStr.length, pos + 80);
  const snippet = jsonStr.slice(start, end).replace(/\s+/g, ' ');
  return `${err.message}. Near: ${snippet}`;
}

function parseJsonWithRepair(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch (initialErr) {
    const candidates = [
      stripTrailingCommas(jsonStr),
      stripDanglingValuePeriods(jsonStr),
      stripTrailingCommas(stripDanglingValuePeriods(jsonStr)),
    ];

    for (const candidate of candidates) {
      if (candidate === jsonStr) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        // Keep the original parse error; it is closest to the model output.
      }
    }

    throw new Error(parseErrorContext(initialErr, jsonStr));
  }
}

function extractJson(text) {
  if (!text) throw new Error('Empty response from model');

  // Strip ```json ... ``` or ``` ... ``` fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;

  // Extract the first balanced object while ignoring braces inside strings.
  const bounds = findJsonObjectBounds(candidate);
  if (!bounds) {
    throw new Error('No JSON object found in model response');
  }
  const jsonStr = candidate.slice(bounds.start, bounds.end);

  try {
    return parseJsonWithRepair(jsonStr);
  } catch (err) {
    throw new Error(`Malformed JSON in model response: ${err.message}`);
  }
}

// ── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt({ locale, preLaunch, category, brandName }) {
  const lang = locale?.language || 'en';
  const country = locale?.country || 'us';

  const preLaunchSection = preLaunch
    ? `
# Pre-launch mode — IMPORTANT

The user does NOT have a live store listing yet. The "currentListing" fields in the JSON will be empty placeholders. You are generating from scratch.

- Brand name to use: "${brandName || '(see asoPlanJson.brandName)'}"
- Category hint: ${category ? `"${category}"` : '(none — infer from competitor patterns)'}
- If "appConcept" is present, it was extracted from the user's own description of what the app does. Trust it absolutely — DO NOT invent features beyond it.
- If "targetDescription" (top-level) is present, it is the user's plain-language description of the app. Use as ground truth alongside appConcept.
- If neither is present, infer from competitors but explicitly note in "notes" that positioning is competitor-inferred and may need user review.
- Use competitor descriptions to learn what features/value-props are table-stakes in this category — but only borrow vocabulary, not feature claims.
- Be more creative — match competitor positioning patterns but differentiate.
`
    : `
# Live-app mode

The user has an existing listing in "currentListing". Improve on it — do NOT rename the app or change its core positioning. Sharpen for ranking + conversion.
`;

  return `You are an elite App Store Optimization (ASO) strategist with 10+ years of experience ranking apps in both the Apple App Store and Google Play. You write conversion-optimized, ranking-optimized store copy.

You will receive a JSON object with factual scraped data: competitor apps, keyword gap analysis, and (when available) a pre-extracted "appConcept" that defines what the app does. Use this as the SOLE source of truth. Do NOT invent competitor facts. Do NOT browse or scrape.

# Truth source priority (read in this order)

1. **appConcept** (if present) — the canonical definition of what THIS app does, its audience, features, and use cases. Locked across all locales. NEVER contradict it. Generated copy must reflect these features and serve this audience.
2. **canonicalListingEn** (if present, for non-English locales) — the app's official English store listing. Use as backup semantic source when the locale listing is thin, machine-translated, or out of date. The features and value props described here are real; you may rely on them.
3. **currentListing** — existing locale copy. Use for current voice/tone in the target locale and to preserve any locale-specific terminology the brand already uses. Improve, don't replace its positioning. If currentListing contradicts canonicalListingEn on features, trust canonicalListingEn.
4. **competitors + keywordAnalysis** — vocabulary and search-term patterns natives use in THIS locale. Borrow keywords, NOT features. If a feature appears in competitors but NOT in appConcept or canonicalListingEn, do NOT claim it for this app.

${preLaunchSection}

# Your task

Produce final store-ready copy for BOTH Apple App Store and Google Play, optimized for ranking and conversion in locale: language=${lang}, country=${country}.

# Apple App Store ranking model (follow exactly)

1. **Title (≤30 chars)** — highest ranking weight. Every word indexed.
2. **Subtitle (≤30 chars)** — 2nd weight. Indexed for search.
3. **Keyword field (≤100 chars, hidden)** — 3rd weight. Comma-separated, NO spaces after commas.
4. **Promotional text (≤170 chars)** — NOT indexed; pure conversion hook.
5. **Description (≤4000 chars)** — NOT indexed; pure conversion.

Apple-specific rules:
- NEVER repeat a word across title + subtitle + keyword field (Apple dedupes — wastes your 160 indexed chars).
- Use singular OR plural, never both (Apple stems automatically).
- Pack competitor-adjacent terms into keyword field (users searching competitors discover you).
- Title format: "{Brand}: {primary keyword}" or "{Brand} - {primary keyword}".

# Google Play ranking model (follow exactly)

1. **Title (≤30 chars)** — highest weight.
2. **Short description (≤80 chars)** — heavily indexed.
3. **Full description (≤4000 chars)** — indexed by crawler. Keyword frequency matters (2-3% density).

Google-specific rules:
- First 167 chars of full description visible without "more" tap — strongest hook + primary keyword here.
- Each primary keyword: 3-5 occurrences in full description.
- Each secondary keyword: 2-3 occurrences.
- Use synonyms (Google does semantic matching).
- Natural language, NOT keyword-stuffed. End with a call to action.

# Keyword selection priority

1. Keywords appearing in competitor TITLES carry 10× weight — prioritize these.
2. Then "URGENT" gap keywords (used by 8+ competitors).
3. Then "IMPORTANT" gap keywords (5-7 competitors).
4. Then phrase gaps (multi-word).

# Sparse or missing competitor data

Competitors may have a "localeFallback: true" field, meaning they had no listing in the target locale and their data was sourced from the EN/US store instead.

**When some or all competitors are EN fallbacks (localeFallback: true):**
- Their descriptions are in English but still reveal: category features, value props, positioning patterns, and what matters to users in this category. Extract this conceptual signal — it is valid.
- However, their text does NOT tell you what keywords native users search for in the target locale. Do not lift English keyword terms directly.
- For keyword selection in the target locale: combine the category concepts extracted from EN fallback descriptions WITH your knowledge of how native users in that country/language search for this type of app.
- Example: EN competitor says "multiplayer party game" → German users search "Partyspiel", "Multiplayer Spiel", "Gesellschaftsspiel" — use those terms, not the English ones.

**When competitors array is empty (all failed even with EN fallback):**
- You have no competitor data at all. Rely entirely on: appConcept + canonicalListingEn + your category knowledge for the target locale.
- Use your training knowledge of top-ranking apps in this category and locale to select keywords.
- Add a note in "notes": "No competitor data available for this locale — keywords sourced from app concept and category knowledge."

**Never lower output quality due to sparse data.** Always produce full, optimized copy. Just be transparent in "notes" about what data was available.

# Output format

Return ONLY a single valid JSON object. No prose before or after. No markdown fences. Schema:

{
  "apple": {
    "title": "string ≤30 chars",
    "subtitle": "string ≤30 chars",
    "keywordField": "comma,separated,no,spaces ≤100 chars",
    "promotionalText": "string ≤170 chars",
    "description": "full conversion-focused description ≤4000 chars",
    "rationale": "1-2 sentences why this configuration ranks"
  },
  "google": {
    "title": "string ≤30 chars",
    "shortDescription": "string ≤80 chars",
    "fullDescription": "string ≤4000 chars with keyword density",
    "rationale": "1-2 sentences why this configuration ranks"
  },
  "screenshots": [
    { "screen": 1, "headline": "≤40 chars value prop", "supportingText": "≤80 chars detail" }
  ],
  "keywordStrategy": {
    "primary": ["top 3-5 keywords"],
    "secondary": ["next tier keywords"],
    "appleKeywordFieldTerms": ["all terms packed into apple keyword field"],
    "reasoning": ["bullet why each primary keyword was chosen, ref competitor frequency"]
  },
  "notes": ["any caveats or A/B test suggestions"]
}

Generate 5-6 screenshot entries. Use locale language "${lang}" for ALL copy — if locale is not English, write natively in that language, NOT translated from English.

# Brand name rule (hard constraint)

Brand name: "${brandName || '(see asoPlanJson.brandName)'}". The brand MUST appear verbatim — never translated, never transliterated, never abbreviated — in:
- apple.title
- google.title
- apple.description (at least once)
- google.fullDescription (at least once)

Even for non-Latin locales, keep the brand in its original script (e.g., "Duolingo" stays "Duolingo" in Korean copy, not "두오링고").`;
}

// ── Compact payload before sending to AI ─────────────────────────────────────
// Strips two classes of bloat:
//   1. Hardcoded-English heuristic copy from lib/asoPlan.js (`asoPlan` blobs,
//      `crossStoreStrategy`) that would prime the model with bad boilerplate
//      when generating non-English locales.
//   2. Low-signal fields the model doesn't use for copy generation
//      (price, screenshotCount) and instruction-duplicating sourceMeta fields
//      that repeat the system prompt.
// Quality fields kept: score, installs, developer, category — model uses
// these to weight competitor importance and infer market positioning.
function stripHeuristicPlan(asoPlanJson) {
  const clone = JSON.parse(JSON.stringify(asoPlanJson));

  if (clone.stores && typeof clone.stores === 'object') {
    for (const store of Object.values(clone.stores)) {
      if (!store || typeof store !== 'object') continue;
      delete store.asoPlan;
      if (store.currentListing) {
        delete store.currentListing.price;
      }
      if (Array.isArray(store.competitors)) {
        for (const comp of store.competitors) {
          if (comp && typeof comp === 'object') {
            delete comp.screenshotCount;
          }
        }
      }
    }
  }
  delete clone.crossStoreStrategy;

  if (clone.sourceMeta && typeof clone.sourceMeta === 'object') {
    delete clone.sourceMeta.dataSource;
    delete clone.sourceMeta.aiRole;
  }

  return clone;
}

// ── User prompt (factual JSON wrapper) ───────────────────────────────────────
function buildUserPrompt({ asoPlanJson, priorIssues }) {
  const cleaned = stripHeuristicPlan(asoPlanJson);
  const corrective = priorIssues && priorIssues.length
    ? `\n\n# Previous attempt failed these constraints — fix ALL of them this time:\n${priorIssues.map((i) => `- ${i}`).join('\n')}\n`
    : '';
  return `Here is the factual ASO data. Use as sole source of truth.${corrective}

\`\`\`json
${JSON.stringify(cleaned, null, 2)}
\`\`\`

Generate the final ASO content JSON now. Respond with ONLY the JSON object.`;
}

function buildRepairPrompt({ asoPlanJson, currentContent, issues }) {
  const cleaned = stripHeuristicPlan(asoPlanJson);
  return `The previous response was valid JSON and matched the schema, but failed these final production constraints:

${issues.map((i) => `- ${i}`).join('\n')}

Return a COMPLETE corrected JSON object using the same schema. Preserve every field that already satisfies the constraints. Change only the fields needed to fix the listed issues.

Current JSON:
\`\`\`json
${JSON.stringify(currentContent, null, 2)}
\`\`\`

Factual ASO source of truth:
\`\`\`json
${JSON.stringify(cleaned, null, 2)}
\`\`\`

Respond with ONLY the corrected JSON object.`;
}

// ── Combined validation ──────────────────────────────────────────────────────
function runAllValidations(content, { brandName, langCode }) {
  return [
    ...validateCharLimits(content),
    ...validateBrand(content, brandName),
    ...validateLanguage(content, langCode),
  ];
}

// ── Concept injection ────────────────────────────────────────────────────────
// Picks the best available listing as the source for concept extraction.
// Preference order:
//   1. canonicalListingEn (English is the most reliable semantic source —
//      richest copy, no machine-translation noise)
//   2. richest currentListing (fallback when EN locale was the request and
//      no separate canonical was fetched, or canonical fetch failed)
// Returns { store, appId, listing } or null if nothing usable (e.g., pre-launch).
function pickConceptSource(asoPlanJson) {
  const stores = asoPlanJson.stores || {};

  // Pass 1: prefer canonical EN if any store has one.
  for (const [storeName, storeData] of Object.entries(stores)) {
    const en = storeData?.canonicalListingEn;
    if (en && storeData?.appId && (en.description?.length || 0) > 0) {
      return { store: storeName, appId: storeData.appId, listing: en };
    }
  }

  // Pass 2: richest currentListing by combined text length.
  let best = null;
  let bestLen = 0;
  for (const [storeName, storeData] of Object.entries(stores)) {
    const listing = storeData?.currentListing;
    if (!listing || !storeData?.appId) continue;
    const len =
      (listing.description?.length || 0) +
      (listing.shortDescription?.length || 0) +
      (listing.subtitle?.length || 0);
    if (len > bestLen) {
      bestLen = len;
      best = { store: storeName, appId: storeData.appId, listing };
    }
  }
  return bestLen > 0 ? best : null;
}

async function injectAppConcept({ provider, asoPlanJson, abortSignal }) {
  const preLaunch = !!asoPlanJson.sourceMeta?.preLaunch;
  const targetDescription = asoPlanJson.targetDescription || '';
  const brandName = asoPlanJson.brandName || '';

  // Pre-launch with user-provided description: extract concept from synthetic
  // listing built from {targetAppName, targetDescription, category}. Not
  // cached (no stable appId), but pre-launch runs are one-offs.
  if (preLaunch) {
    if (!targetDescription) {
      return { asoPlanJson, conceptMeta: { skipped: 'pre-launch-no-description' } };
    }
    const syntheticListing = {
      title: brandName,
      description: targetDescription,
      category: asoPlanJson.sourceMeta?.category || '',
    };
    try {
      const concept = await extractAppConcept({
        provider,
        brandName,
        listing: syntheticListing,
        category: asoPlanJson.sourceMeta?.category,
        abortSignal,
      });
      const augmented = { ...asoPlanJson, appConcept: concept };
      return {
        asoPlanJson: augmented,
        conceptMeta: { cached: false, source: 'pre-launch-description' },
      };
    } catch (err) {
      return { asoPlanJson, conceptMeta: { skipped: `pre-launch-extract-failed: ${err.message}` } };
    }
  }

  const source = pickConceptSource(asoPlanJson);
  if (!source) return { asoPlanJson, conceptMeta: { skipped: 'no-listing' } };

  const { concept, cached, error } = await getOrExtractAppConcept({
    provider,
    store: source.store,
    appId: source.appId,
    brandName,
    listing: source.listing,
    category: asoPlanJson.sourceMeta?.category,
    abortSignal,
  });

  if (!concept) return { asoPlanJson, conceptMeta: { skipped: error || 'extract-failed' } };

  const augmented = { ...asoPlanJson, appConcept: concept };
  return {
    asoPlanJson: augmented,
    conceptMeta: { cached, sourceStore: source.store, sourceAppId: source.appId },
  };
}

// ── Main entry ───────────────────────────────────────────────────────────────
/**
 * Synthesize ASO content from factual JSON via provider.
 *
 * @param {{
 *   provider: any,
 *   asoPlanJson: object,
 *   locale?: { country?: string, language?: string },
 *   abortSignal?: AbortSignal,
 *   maxRetries?: number,
 * }} input
 */
export async function synthesizeAso({ provider, asoPlanJson, locale, abortSignal, maxRetries = 2 }) {
  if (!asoPlanJson) {
    throw new ProviderError('asoPlanJson required', { code: 'BAD_INPUT' });
  }

  const effectiveLocale = locale || asoPlanJson.locale || {};
  const brandName = asoPlanJson.brandName || '';
  const langCode = (effectiveLocale.language || 'en').toLowerCase();

  // Whole-pipeline cache: identical input → identical output. Hash original
  // (pre-concept-injection) JSON since concept is derived deterministically
  // from it. Skips concept extraction + all model calls on hit.
  const cacheKey = buildSynthesisCacheKey({
    asoPlanJson,
    locale: effectiveLocale,
    brandName,
  });
  const synthesisCache = getSynthesisCache();
  const cached = synthesisCache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      meta: { ...cached.meta, cacheHit: true },
    };
  }

  // Extract + inject AppConcept (cached per appId). Graceful: continues without
  // concept if extraction fails — synthesizer still has currentListing + competitors.
  const { asoPlanJson: enrichedPlan, conceptMeta } = await injectAppConcept({
    provider,
    asoPlanJson,
    abortSignal,
  });
  asoPlanJson = enrichedPlan;

  const systemPrompt = buildSystemPrompt({
    locale: effectiveLocale,
    preLaunch: !!asoPlanJson.sourceMeta?.preLaunch,
    category: asoPlanJson.sourceMeta?.category,
    brandName,
  });

  let priorIssues = [];
  let repairContent = null;
  let lastValidated = null;
  let lastResult = null;
  let lastIssues = [];
  const attempts = [];
  // Aggregate usage across retries to surface real cost + cache hit rate.
  const totalUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userPrompt = repairContent
      ? buildRepairPrompt({ asoPlanJson, currentContent: repairContent, issues: priorIssues })
      : buildUserPrompt({ asoPlanJson, priorIssues });
    const result = await generate(provider, {
      systemPrompt,
      userPrompt,
      abortSignal,
      tool: FINAL_ASO_CONTENT_TOOL,
    });
    lastResult = result;
    if (result.usage) {
      totalUsage.inputTokens += result.usage.inputTokens || 0;
      totalUsage.outputTokens += result.usage.outputTokens || 0;
      totalUsage.cacheReadTokens += result.usage.cacheReadTokens || 0;
      totalUsage.cacheCreationTokens += result.usage.cacheCreationTokens || 0;
    }

    let parsed;
    try {
      parsed = extractJson(result.text);
    } catch (err) {
      // Parse failures: retry if budget remains, else throw.
      if (attempt < maxRetries) {
        priorIssues = [`Output was not valid JSON: ${err.message}. Return ONLY a single JSON object, no markdown fences, no prose.`];
        repairContent = null;
        attempts.push({ attempt, error: 'parse_failed', message: err.message });
        continue;
      }
      throw new ProviderError(`Failed to parse model output: ${err.message}`, {
        code: 'PARSE_FAILED',
        cause: err,
      });
    }

    let validated;
    try {
      validated = FinalAsoContentSchema.parse(parsed);
    } catch (err) {
      if (attempt < maxRetries) {
        priorIssues = [`Output failed schema validation: ${err.message}. Match the schema exactly.`];
        repairContent = null;
        attempts.push({ attempt, error: 'schema_invalid', message: err.message });
        continue;
      }
      throw new ProviderError(`Schema validation failed: ${err.message}`, {
        code: 'SCHEMA_INVALID',
        cause: err,
      });
    }

    lastValidated = validated;
    const issues = runAllValidations(validated, { brandName, langCode });
    lastIssues = issues;
    attempts.push({ attempt, mode: repairContent ? 'repair' : 'generate', issues });

    if (issues.length === 0) break;
    if (attempt >= maxRetries) break;

    priorIssues = issues;
    repairContent = validated;
  }

  const totalInput = totalUsage.inputTokens + totalUsage.cacheReadTokens;
  const cacheHitRatio = totalInput > 0 ? totalUsage.cacheReadTokens / totalInput : 0;

  const output = {
    finalContent: lastValidated,
    validationIssues: lastIssues,
    meta: {
      model: lastResult?.model,
      durationMs: lastResult?.durationMs,
      costUsd: lastResult?.costUsd,
      attempts: attempts.length,
      attemptLog: attempts,
      conceptMeta,
      cacheHit: false,
      usage: totalUsage,
      cacheHitRatio,
    },
  };

  // Only cache fully-validated outputs. Partial outputs (validation issues
  // remaining after maxRetries) shouldn't become sticky — a future call might
  // get more retries and produce clean output.
  if (lastValidated && lastIssues.length === 0) {
    synthesisCache.set(cacheKey, output);
  }

  return output;
}
