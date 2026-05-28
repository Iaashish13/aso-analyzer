import natural from 'natural';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'app', 'this', 'that',
  'have', 'from', 'are', 'was', 'but', 'not', 'all', 'can', 'get', 'its',
  'our', 'use', 'will', 'new', 'more', 'has', 'any', 'one', 'also', 'now',
  'free', 'just', 'make', 'like', 'than', 'when', 'how', 'then', 'them',
  'they', 'what', 'into', 'out', 'over', 'after', 'some', 'about', 'other',
  'would', 'there', 'their', 'been', 'who', 'why', 'where', 'which', 'while',
  'were', 'does', 'did', 'his', 'her', 'him', 'she', 'himself', 'herself',
]);

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];

  const tokenizer = new natural.WordTokenizer();
  return tokenizer
    .tokenize(text.toLowerCase())
    .filter((word) => word.length >= 3)
    .filter((word) => !STOPWORDS.has(word))
    .filter((word) => /^[a-z]+$/.test(word));
}

/**
 * Extracts meaningful keywords from a block of text.
 * @param {string} text
 * @returns {string[]} unique lowercase keyword array
 */
export function extractKeywords(text) {
  return [...new Set(tokenize(text))];
}

/**
 * Extracts 2-3 word ASO phrases. Phrases usually matter more than isolated
 * tokens because users search intent phrases like "party game".
 */
export function extractKeywordPhrases(text) {
  const tokens = tokenize(text);
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
 * @returns {{
 *   myKeywords: string[],
 *   gaps: Array<{ word: string, frequency: number, usedBy: Array<{ title: string, score: number }>, inTitles: number }>,
 *   topCompetitorKeywords: Array<{ word: string, frequency: number }>,
 *   sharedKeywords: Array<{ word: string, frequency: number }>,
 *   competitorTitleKeywords: Array<{ word: string, frequency: number, titles: string[] }>
 * }}
 */
export function analyzeKeywordGaps(myApp, competitors) {
  const myText = `${myApp.title || ''} ${myApp.shortDescription || ''} ${myApp.description || ''}`;
  const myKeywords = new Set(extractKeywords(myText));
  const myPhrases = new Set(extractKeywordPhrases(myText));

  // Track keyword → which competitors use it (with metadata)
  const keywordMap = {};       // keyword → { count, usedBy: [{title, score}], inTitles: number }
  const titleKeywordMap = {};  // keyword → { count, titles: [] }
  const phraseMap = {};

  for (const competitor of competitors) {
    const compTitle = competitor.title || '';
    const compShortDesc = competitor.shortDescription || '';
    const compDesc = competitor.description || '';

    // Extract title keywords separately (they carry more weight)
    const titleKws = extractKeywords(compTitle);
    const allKws = extractKeywords(`${compTitle} ${compShortDesc} ${compDesc}`);
    const titlePhrases = extractKeywordPhrases(compTitle);
    const allPhrases = extractKeywordPhrases(`${compTitle} ${compShortDesc} ${compDesc}`);

    const compInfo = {
      title: compTitle,
      score: competitor.score || 0,
    };

    // Track title keywords
    for (const kw of titleKws) {
      if (!titleKeywordMap[kw]) {
        titleKeywordMap[kw] = { count: 0, titles: [] };
      }
      titleKeywordMap[kw].count += 1;
      titleKeywordMap[kw].titles.push(compTitle);
    }

    // Track all keywords with competitor attribution
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

  // Gaps: used by 3+ competitors, NOT in myApp, sorted by frequency desc
  const gaps = Object.entries(keywordMap)
    .filter(([word, data]) => data.count >= minimumCompetitorCount && !myKeywords.has(word))
    .sort(sortByOpportunity)
    .slice(0, 30)
    .map(([word, data]) => ({
      word,
      frequency: data.count,
      usedBy: data.usedBy
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5), // top 5 by rating
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

  // All competitor keywords sorted by frequency, top 50
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

  // Shared keywords: keywords in BOTH myApp and 3+ competitors (what's working)
  const sharedKeywords = Object.entries(keywordMap)
    .filter(([word, data]) => data.count >= 3 && myKeywords.has(word))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([word, data]) => ({ word, frequency: data.count }));

  // Title-specific keywords across competitors (sorted by frequency)
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
