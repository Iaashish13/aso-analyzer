const APPLE_TITLE_LIMIT = 30;
const APPLE_SUBTITLE_LIMIT = 30;
const APPLE_KEYWORDS_LIMIT = 100;
const APPLE_PROMO_LIMIT = 170;
const GOOGLE_TITLE_LIMIT = 30;
const GOOGLE_SHORT_DESCRIPTION_LIMIT = 80;
const SYNTHETIC_GAME_EXCLUSIONS = new Set([
  'find', 'play', 'guess', 'lying', 'fun', 'player', 'social', 'deduction',
  'best', 'top', 'easy', 'hard', 'smart', 'real',
]);

function normalizeBrandName(name) {
  return String(name || '')
    .split(/[-–:|]/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 2) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function trimToLimit(text, limit) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;

  const words = clean.split(' ');
  const kept = [];
  for (const word of words) {
    const next = [...kept, word].join(' ');
    if (next.length > limit) break;
    kept.push(word);
  }

  return kept.join(' ') || clean.slice(0, limit).trim();
}

function uniqueWords(items) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const word = String(item || '').toLowerCase().replace(/[^a-z0-9']/g, '').trim();
    if (!word || seen.has(word) || word.length < 3) continue;
    seen.add(word);
    output.push(word);
  }

  return output;
}

function getPrimaryTerms(keywordAnalysis) {
  const rankedWords = [
    ...(keywordAnalysis?.competitorTitleKeywords || []).map((item) => item.word),
    ...(keywordAnalysis?.gaps || []).map((item) => item.word),
  ];

  const syntheticPhrases = uniqueWords(rankedWords)
    .filter((word) => !['game', 'games', 'app'].includes(word))
    .filter((word) => !SYNTHETIC_GAME_EXCLUSIONS.has(word))
    .slice(0, 8)
    .flatMap((word) => [`${word} game`]);

  const phraseTerms = (keywordAnalysis?.phraseGaps || [])
    .filter((item) => item.phrase.split(' ').length <= 3)
    .sort((a, b) => (b.inTitles - a.inTitles) || (b.frequency - a.frequency))
    .map((item) => item.phrase);

  const keywordTerms = (keywordAnalysis?.gaps || [])
    .sort((a, b) => (b.inTitles - a.inTitles) || (b.frequency - a.frequency))
    .map((item) => item.word);

  const titleTerms = (keywordAnalysis?.competitorTitleKeywords || [])
    .map((item) => item.word);

  const combined = [...syntheticPhrases, ...phraseTerms, ...keywordTerms, ...titleTerms];
  return [...new Set(combined)].filter(Boolean);
}

function buildTitle(brandName, terms, limit) {
  for (const term of terms) {
    const candidate = `${brandName}: ${titleCase(term)}`;
    if (candidate.length <= limit) return candidate;
  }

  for (const term of terms) {
    const candidate = `${brandName} ${titleCase(term)}`;
    if (candidate.length <= limit) return candidate;
  }

  return trimToLimit(brandName, limit);
}

function wordsInText(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter(Boolean)
  );
}

function buildSubtitle(terms, usedWords, limit) {
  const unusedTokens = uniqueWords(terms.flatMap((term) => term.split(/\s+/)))
    .filter((word) => !usedWords.has(word))
    .filter((word) => !['game', 'games', 'app'].includes(word));

  const candidates = [
    unusedTokens.length >= 2 ? `${unusedTokens[0]} with ${unusedTokens[1]}` : '',
    unusedTokens.length >= 3 ? `${unusedTokens[0]}, ${unusedTokens[1]}, ${unusedTokens[2]}` : '',
    terms.filter((term) => !term.split(' ').some((word) => usedWords.has(word))).slice(0, 2).join(' & '),
    terms.filter((term) => !term.split(' ').some((word) => usedWords.has(word))).slice(0, 3).join(', '),
    terms.slice(1, 3).join(' & '),
    terms[0],
  ].filter(Boolean);

  for (const candidate of candidates) {
    const output = titleCase(candidate);
    if (output.length <= limit) return output;
  }

  return trimToLimit(titleCase(candidates[0] || 'Fun Game With Friends'), limit);
}

function buildAppleKeywordField(terms, usedWords) {
  const tokens = uniqueWords(
    terms
      .flatMap((term) => term.split(/\s+/))
      .filter((word) => !usedWords.has(word.toLowerCase()))
  );

  const output = [];
  for (const token of tokens) {
    const candidate = [...output, token].join(',');
    if (candidate.length > APPLE_KEYWORDS_LIMIT) continue;
    output.push(token);
  }

  return output.join(',');
}

function buildScreenshotIdeas(brandName, terms) {
  const [primary = 'party game'] = terms;
  const coreSubject = terms
    .flatMap((term) => term.split(/\s+/))
    .find((word) => ['imposter', 'fake', 'liar', 'spy'].includes(word)) || 'imposter';

  return [
    `Find the ${titleCase(coreSubject)}`,
    `Play ${titleCase(primary)} With Friends`,
    `Guess Who Is Lying`,
    `Reveal Funny Answers`,
    `Perfect for Groups`,
    `${brandName} Game Night`,
  ].map((text) => trimToLimit(text, 34));
}

function buildRationale(terms, competitors) {
  const competitorNames = competitors.slice(0, 3).map((item) => item.title).filter(Boolean);
  return [
    `Primary terms selected from competitor title and description patterns: ${terms.slice(0, 5).join(', ') || 'none found'}.`,
    competitorNames.length > 0
      ? `Benchmarked against ${competitorNames.join(', ')}.`
      : 'No competitor names were available for attribution.',
  ];
}

export function generateAsoPlan({ myApp, competitors, keywordAnalysis, targetAppName, locale }) {
  const brandName = normalizeBrandName(targetAppName || myApp?.title || 'My App');
  const primaryTerms = getPrimaryTerms(keywordAnalysis);
  const fallbackTerms = ['imposter game', 'party game', 'friends game', 'guessing game'];
  const terms = primaryTerms.length > 0 ? primaryTerms : fallbackTerms;

  const appleTitle = buildTitle(brandName, terms, APPLE_TITLE_LIMIT);
  const appleUsedWords = wordsInText(appleTitle);
  const appleSubtitle = buildSubtitle(terms, appleUsedWords, APPLE_SUBTITLE_LIMIT);
  const appleAllUsedWords = new Set([...appleUsedWords, ...wordsInText(appleSubtitle)]);
  const appleKeywords = buildAppleKeywordField(terms, appleAllUsedWords);

  const googleTitle = buildTitle(brandName, terms, GOOGLE_TITLE_LIMIT);
  const googleShortDescription = trimToLimit(
    `Play ${terms[0] || 'a fun game'} with friends and guess who is fake.`,
    GOOGLE_SHORT_DESCRIPTION_LIMIT
  );

  const promotionalText = trimToLimit(
    `New rounds, funny prompts, and smarter ${terms[0] || 'party game'} moments for your next game night.`,
    APPLE_PROMO_LIMIT
  );

  const descriptionOutline = [
    `Open with ${terms[0] || 'the primary keyword'} in the first sentence.`,
    `Explain the core loop: read prompts, spot the fake player, and reveal the answer.`,
    `Use feature bullets around ${terms.slice(0, 4).join(', ') || 'your strongest keywords'}.`,
    'End with a clear call to action to start a game with friends.',
  ];

  return {
    brandName,
    locale: locale || { country: 'us', language: 'en' },
    primaryTerms: terms.slice(0, 12),
    apple: {
      title: appleTitle,
      subtitle: appleSubtitle,
      keywordField: appleKeywords,
      promotionalText,
      descriptionGuidance: [
        'Use the description for conversion, not keyword stuffing.',
        ...descriptionOutline,
      ],
      characterCounts: {
        title: appleTitle.length,
        subtitle: appleSubtitle.length,
        keywordField: appleKeywords.length,
        promotionalText: promotionalText.length,
      },
    },
    google: {
      title: googleTitle,
      shortDescription: googleShortDescription,
      fullDescriptionGuidance: descriptionOutline,
      characterCounts: {
        title: googleTitle.length,
        shortDescription: googleShortDescription.length,
      },
    },
    screenshots: buildScreenshotIdeas(brandName, terms),
    rationale: buildRationale(terms, competitors || []),
  };
}
