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
function extractJson(text) {
  if (!text) throw new Error('Empty response from model');

  // Strip ```json ... ``` or ``` ... ``` fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;

  // Find first { and last } as fallback
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error('No JSON object found in model response');
  }
  const jsonStr = candidate.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(jsonStr);
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
- Base ALL recommendations on the competitor analysis. You have no existing copy to preserve.
- Be more creative — match competitor positioning patterns but differentiate.
- Use competitor descriptions to learn what features/value-props are table-stakes in this category.
`
    : `
# Live-app mode

The user has an existing listing in "currentListing". Improve on it — do NOT rename the app or change its core positioning. Sharpen for ranking + conversion.
`;

  return `You are an elite App Store Optimization (ASO) strategist with 10+ years of experience ranking apps in both the Apple App Store and Google Play. You write conversion-optimized, ranking-optimized store copy.

You will receive a JSON object with factual scraped data: competitor apps, keyword gap analysis, and a draft ASO plan. Use this as the SOLE source of truth. Do NOT invent competitor facts. Do NOT browse or scrape.

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

Generate 5-6 screenshot entries. Use locale language "${lang}" for ALL copy — if locale is not English, write natively in that language, NOT translated from English.`;
}

// ── User prompt (factual JSON wrapper) ───────────────────────────────────────
function buildUserPrompt({ asoPlanJson }) {
  return `Here is the factual ASO data. Use as sole source of truth.

\`\`\`json
${JSON.stringify(asoPlanJson, null, 2)}
\`\`\`

Generate the final ASO content JSON now. Respond with ONLY the JSON object.`;
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
 * }} input
 */
export async function synthesizeAso({ provider, asoPlanJson, locale, abortSignal }) {
  if (!asoPlanJson) {
    throw new ProviderError('asoPlanJson required', { code: 'BAD_INPUT' });
  }

  const systemPrompt = buildSystemPrompt({
    locale: locale || asoPlanJson.locale,
    preLaunch: !!asoPlanJson.sourceMeta?.preLaunch,
    category: asoPlanJson.sourceMeta?.category,
    brandName: asoPlanJson.brandName,
  });
  const userPrompt = buildUserPrompt({ asoPlanJson });

  const result = await generate(provider, { systemPrompt, userPrompt, abortSignal });

  let parsed;
  try {
    parsed = extractJson(result.text);
  } catch (err) {
    throw new ProviderError(`Failed to parse model output: ${err.message}`, {
      code: 'PARSE_FAILED',
      cause: err,
    });
  }

  let validated;
  try {
    validated = FinalAsoContentSchema.parse(parsed);
  } catch (err) {
    throw new ProviderError(`Schema validation failed: ${err.message}`, {
      code: 'SCHEMA_INVALID',
      cause: err,
    });
  }

  const charLimitIssues = validateCharLimits(validated);

  return {
    finalContent: validated,
    validationIssues: charLimitIssues,
    meta: {
      model: result.model,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
    },
  };
}
