import * as sw from 'stopword';

// ASO-specific noise that's worthless regardless of language. App-store copy
// is saturated with these. Combined with locale stopwords below.
const ASO_STOPWORDS = new Set([
  'app', 'apps', 'free', 'new', 'best', 'top', 'use', 'using', 'used',
  'get', 'make', 'made', 'just', 'also', 'now', 'one', 'two', 'all',
  'more', 'most', 'like', 'will', 'can',
]);

// Map ISO 639-1 (from locale.language) → 639-3 lookup in `stopword` pkg.
// Add codes here as you support more locales. Unknown lang → English fallback.
const LANG_TO_SW = {
  en: 'eng', es: 'spa', fr: 'fra', de: 'deu', pt: 'por',
  it: 'ita', nl: 'nld', sv: 'swe', da: 'dan', no: 'nor', fi: 'fin',
  pl: 'pol', cs: 'ces', hu: 'hun', ro: 'ron', el: 'ell',
  ru: 'rus', uk: 'ukr', tr: 'tur',
  vi: 'vie', id: 'ind', th: 'tha',
  ja: 'jpn', ko: 'kor', zh: 'zho',
  ar: 'ara', he: 'heb', hi: 'hin',
};

function getStopwordList(lang) {
  const code = LANG_TO_SW[(lang || 'en').toLowerCase()] || 'eng';
  return sw[code] || sw.eng || [];
}

// Unicode-aware tokenizer. Splits on anything that is NOT a letter/digit in
// any script (Latin, Cyrillic, CJK, Devanagari, etc.). This preserves
// non-ASCII letters that `natural.WordTokenizer` would slice off mid-word
// (e.g. Spanish "aplicación" → "aplicaci" with the ASCII tokenizer).
const TOKEN_SPLIT = /[^\p{L}\p{N}]+/u;

function tokenize(text, lang) {
  if (!text || typeof text !== 'string') return [];
  const raw = text.toLowerCase().split(TOKEN_SPLIT);
  const filtered = raw
    .filter((w) => w && w.length >= 3)
    .filter((w) => !ASO_STOPWORDS.has(w));
  // Locale stopword removal (case-insensitive — already lowercased).
  return sw.removeStopwords(filtered, getStopwordList(lang));
}

/**
 * Extracts meaningful keywords from a block of text.
 * @param {string} text
 * @param {string} [lang] ISO 639-1 language code from locale (default 'en')
 * @returns {string[]} unique lowercase keyword array
 */
export function extractKeywords(text, lang = 'en') {
  return [...new Set(tokenize(text, lang))];
}

/**
 * Extracts 2-3 word ASO phrases. Phrases usually matter more than isolated
 * tokens because users search intent phrases like "party game".
 */
export function extractKeywordPhrases(text, lang = 'en') {
  const tokens = tokenize(text, lang);
  const phrases = [];

  for (const size of [2, 3]) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      phrases.push(tokens.slice(index, index + size).join(' '));
    }
  }

  return [...new Set(phrases)];
}

/**
 * Finds keywords that competitors use but myApp does not.
 * Tracks which specific competitors use each keyword and separates
 * title keywords (higher ranking weight) from description keywords.
 *
 * @param {{ title: string, description: string }} myApp
 * @param {Array<{ title: string, description: string, score?: number, installs?: string }>} competitors
 * @param {string} [lang] ISO 639-1 language code (default 'en')
 */
export function analyzeKeywordGaps(myApp, competitors, lang = 'en') {
  const myText = `${myApp.title || ''} ${myApp.shortDescription || ''} ${myApp.description || ''}`;
  const myKeywords = new Set(extractKeywords(myText, lang));
  const myPhrases = new Set(extractKeywordPhrases(myText, lang));

  const keywordMap = {};
  const titleKeywordMap = {};
  const phraseMap = {};

  for (const competitor of competitors) {
    const compTitle = competitor.title || '';
    const compShortDesc = competitor.shortDescription || '';
    const compDesc = competitor.description || '';

    const titleKws = extractKeywords(compTitle, lang);
    const allKws = extractKeywords(`${compTitle} ${compShortDesc} ${compDesc}`, lang);
    const titlePhrases = extractKeywordPhrases(compTitle, lang);
    const allPhrases = extractKeywordPhrases(`${compTitle} ${compShortDesc} ${compDesc}`, lang);

    const compInfo = {
      title: compTitle,
      score: competitor.score || 0,
    };

    for (const kw of titleKws) {
      if (!titleKeywordMap[kw]) {
        titleKeywordMap[kw] = { count: 0, titles: [] };
      }
      titleKeywordMap[kw].count += 1;
      titleKeywordMap[kw].titles.push(compTitle);
    }

    const seen = new Set();
    for (const kw of allKws) {
      if (seen.has(kw)) continue;
      seen.add(kw);

      if (!keywordMap[kw]) {
        keywordMap[kw] = { count: 0, usedBy: [], inTitles: 0 };
      }
      keywordMap[kw].count += 1;
      keywordMap[kw].usedBy.push(compInfo);
      if (titleKws.includes(kw)) {
        keywordMap[kw].inTitles += 1;
      }
    }

    const seenPhrases = new Set();
    for (const phrase of allPhrases) {
      if (seenPhrases.has(phrase)) continue;
      seenPhrases.add(phrase);

      if (!phraseMap[phrase]) {
        phraseMap[phrase] = { count: 0, usedBy: [], inTitles: 0 };
      }
      phraseMap[phrase].count += 1;
      phraseMap[phrase].usedBy.push(compInfo);
      if (titlePhrases.includes(phrase)) {
        phraseMap[phrase].inTitles += 1;
      }
    }
  }

  const sortByOpportunity = (a, b) => {
    const aScore = (a[1].count * 2) + (a[1].inTitles * 4);
    const bScore = (b[1].count * 2) + (b[1].inTitles * 4);
    return bScore - aScore;
  };

  const minimumCompetitorCount = competitors.length < 3 ? 1 : 3;

  const gaps = Object.entries(keywordMap)
    .filter(([word, data]) => data.count >= minimumCompetitorCount && !myKeywords.has(word))
    .sort(sortByOpportunity)
    .slice(0, 30)
    .map(([word, data]) => ({
      word,
      frequency: data.count,
      usedBy: data.usedBy
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5),
      inTitles: data.inTitles,
    }));

  const phraseGaps = Object.entries(phraseMap)
    .filter(([phrase, data]) => data.count >= minimumCompetitorCount && !myPhrases.has(phrase))
    .sort(sortByOpportunity)
    .slice(0, 30)
    .map(([phrase, data]) => ({
      phrase,
      frequency: data.count,
      usedBy: data.usedBy
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5),
      inTitles: data.inTitles,
    }));

  const topCompetitorKeywords = Object.entries(keywordMap)
    .sort(sortByOpportunity)
    .slice(0, 50)
    .map(([word, data]) => ({ word, frequency: data.count }));

  const topCompetitorPhrases = Object.entries(phraseMap)
    .sort(sortByOpportunity)
    .slice(0, 50)
    .map(([phrase, data]) => ({
      phrase,
      frequency: data.count,
      inTitles: data.inTitles,
    }));

  const sharedKeywords = Object.entries(keywordMap)
    .filter(([word, data]) => data.count >= 3 && myKeywords.has(word))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([word, data]) => ({ word, frequency: data.count }));

  const competitorTitleKeywords = Object.entries(titleKeywordMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([word, data]) => ({
      word,
      frequency: data.count,
      titles: data.titles.slice(0, 3),
    }));

  return {
    myKeywords: [...myKeywords],
    myPhrases: [...myPhrases],
    gaps,
    phraseGaps,
    topCompetitorKeywords,
    topCompetitorPhrases,
    sharedKeywords,
    competitorTitleKeywords,
  };
}
