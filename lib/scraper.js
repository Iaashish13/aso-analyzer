import gplay from 'google-play-scraper';
import store from 'app-store-scraper';

const DELAY_MS = 300;
const RETRY_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, retries = 2) {
  try {
    return await fn();
  } catch (err) {
    const isRateLimit =
      err.message?.includes('429') ||
      err.message?.toLowerCase().includes('rate') ||
      err.message?.toLowerCase().includes('too many');

    if (retries > 0 && isRateLimit) {
      await sleep(RETRY_DELAY_MS);
      return withRetry(fn, retries - 1);
    }
    throw err;
  }
}

/**
 * Extracts the first 1-3 meaningful words from an app title
 * to use as a search query for finding true competitors.
 */
function buildSearchQuery(title) {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'of', 'by', 'in']);
  return title
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w.toLowerCase()))
    .slice(0, 3)
    .join(' ');
}

/**
 * Merges two app lists by appId, deduplicates, and removes the main app
 * and any apps by the same developer.
 */
function mergeAndFilter(similarList, searchList, mainAppId, developerIds) {
  const seen = new Set([mainAppId]);
  const merged = [];

  for (const app of [...similarList, ...searchList]) {
    const id = app.appId || app.bundleId;
    if (!id || seen.has(id)) continue;
    // Skip apps by the same developer (catches your own apps)
    if (developerIds.has(app.developerId)) continue;
    seen.add(id);
    merged.push(app);
  }

  return merged.slice(0, 10);
}

// ─── Google Play ─────────────────────────────────────────────────────────────

/**
 * Scrapes a Google Play app and finds 10 genuine competitors.
 *
 * Discovery strategy (auto mode):
 *   1. gplay.similar() — Google's own "you may also like" list
 *   2. gplay.search() — keyword search using your app's title
 *   Merged, deduplicated, and filtered to remove your own developer's apps.
 *
 * @param {string} appId               e.g. "com.whatsapp"
 * @param {string[]} [manualIds=[]]    optional list of competitor appIds provided by the user
 * @param {{ country?: string, language?: string }} [locale]
 */
export async function scrapeGooglePlay(appId, manualIds = [], locale = {}) {
  const country = locale.country || 'us';
  const lang = locale.language || 'en';

  // ── Main app ──────────────────────────────────────────────────────────────
  let rawApp;
  try {
    rawApp = await withRetry(() => gplay.app({ appId, country, lang }));
  } catch (err) {
    throw new Error(`Could not fetch Play Store app "${appId}": ${err.message}`);
  }

  const myApp = {
    title: rawApp.title || '',
    shortDescription: rawApp.summary || '',
    description: rawApp.description || '',
    score: rawApp.score || 0,
    installs: rawApp.installs || 'Unknown',
    screenshots: Array.isArray(rawApp.screenshots) ? rawApp.screenshots : [],
    category: rawApp.genre || rawApp.genreId || 'Unknown',
    developer: rawApp.developer || '',
    developerId: rawApp.developerId || '',
  };

  // All developer IDs belonging to the same publisher (to exclude own apps)
  const ownDeveloperIds = new Set(
    [rawApp.developerId].filter(Boolean)
  );

  // ── Competitor discovery ──────────────────────────────────────────────────
  let candidateIds; // final list of appIds to fully scrape

  if (manualIds.length > 0) {
    // User provided specific competitors — trust them, just skip own app
    candidateIds = manualIds.filter((id) => id !== appId).slice(0, 10);
  } else {
    // Auto-discover: similar() + keyword search()
    const [similarList, searchList] = await Promise.allSettled([
      withRetry(() => gplay.similar({ appId, num: 15, fullDetail: false })),
      withRetry(() =>
        gplay.search({
          term: buildSearchQuery(rawApp.title),
          num: 15,
          country,
          lang,
          fullDetail: false,
        })
      ),
    ]);

    const similar = similarList.status === 'fulfilled' ? similarList.value : [];
    const search = searchList.status === 'fulfilled' ? searchList.value : [];

    const merged = mergeAndFilter(similar, search, appId, ownDeveloperIds);
    candidateIds = merged.map((a) => a.appId).filter(Boolean);
  }

  // ── Fetch full details for each competitor ────────────────────────────────
  const competitors = [];

  for (const compId of candidateIds) {
    try {
      const compRaw = await withRetry(() => gplay.app({ appId: compId, country, lang }));

      // Double-check: skip if same developer slipped through
      if (ownDeveloperIds.has(compRaw.developerId)) {
        await sleep(DELAY_MS);
        continue;
      }

      competitors.push({
        appId: compId,
        title: compRaw.title || '',
        shortDescription: compRaw.summary || '',
        description: compRaw.description || '',
        score: compRaw.score || 0,
        installs: compRaw.installs || 'Unknown',
        developer: compRaw.developer || '',
        screenshots: Array.isArray(compRaw.screenshots) ? compRaw.screenshots : [],
      });
    } catch {
      // Skip competitors that fail to load
    }

    await sleep(DELAY_MS);
  }

  return { myApp, competitors };
}

/**
 * Pre-launch mode: scrape ONLY competitors (no self-app), return placeholder myApp.
 *
 * Used when user does not have a live app yet.
 *
 * @param {string} store               'google' or 'apple'
 * @param {string[]} competitorIds      list of app IDs (parsed already)
 * @param {{country, language}} locale
 * @param {{brandName?: string, category?: string}} [hints]
 */
export async function scrapeCompetitorsOnly(storeName, competitorIds, locale, hints = {}) {
  const country = locale.country || 'us';
  const lang = locale.language || 'en';

  const placeholderApp = {
    title: hints.brandName || 'New App',
    subtitle: '',
    shortDescription: '',
    description: '',
    score: 0,
    installs: '0+',
    screenshots: [],
    category: hints.category || 'Unknown',
    developer: '',
    developerId: '',
    isPlaceholder: true,
  };

  const competitors = [];

  for (const rawId of competitorIds) {
    try {
      let compRaw;
      if (storeName === 'google') {
        compRaw = await withRetry(() => gplay.app({ appId: rawId, country, lang }));
        competitors.push({
          appId: rawId,
          title: compRaw.title || '',
          shortDescription: compRaw.summary || '',
          description: compRaw.description || '',
          score: compRaw.score || 0,
          installs: compRaw.installs || 'Unknown',
          developer: compRaw.developer || '',
          screenshots: Array.isArray(compRaw.screenshots) ? compRaw.screenshots : [],
        });
      } else {
        const numId = parseInt(String(rawId).match(/\d+/)?.[0] || rawId, 10);
        compRaw = await withRetry(() => store.app({ id: numId, country, lang }));
        competitors.push({
          appId: String(numId),
          title: compRaw.title || '',
          subtitle: compRaw.subtitle || '',
          shortDescription: compRaw.subtitle || '',
          description: compRaw.description || '',
          score: compRaw.score || 0,
          developer: compRaw.developer || '',
          screenshots: Array.isArray(compRaw.screenshots) ? compRaw.screenshots : [],
        });
      }
    } catch {
      // skip bad competitor
    }
    await sleep(DELAY_MS);
  }

  return { myApp: placeholderApp, competitors };
}

// ─── App Store ───────────────────────────────────────────────────────────────

/**
 * Parses App Store URLs or raw numeric IDs into a numeric ID.
 * Accepts: "310633997", "https://apps.apple.com/.../id310633997"
 */
function resolveAppStoreId(input) {
  const str = String(input).trim();
  // URL format: .../id123456789
  const urlMatch = str.match(/\/id(\d+)/);
  if (urlMatch) return parseInt(urlMatch[1], 10);
  // Raw numeric
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  return null;
}

/**
 * Scrapes an App Store app and finds 10 genuine competitors.
 *
 * @param {string} appId               numeric App Store ID e.g. "310633997"
 * @param {string[]} [manualIds=[]]    optional list of competitor IDs/URLs provided by the user
 * @param {{ country?: string, language?: string }} [locale]
 */
export async function scrapeAppStore(appId, manualIds = [], locale = {}) {
  const numericId = resolveAppStoreId(appId);
  const country = locale.country || 'us';
  const lang = locale.language || 'en';

  if (!numericId) {
    throw new Error(`App Store IDs must be numeric. Received: "${appId}"`);
  }

  // ── Main app ──────────────────────────────────────────────────────────────
  let rawApp;
  try {
    rawApp = await withRetry(() => store.app({ id: numericId, country, lang }));
  } catch (err) {
    throw new Error(`Could not fetch App Store app "${appId}": ${err.message}`);
  }

  const myApp = {
    title: rawApp.title || '',
    subtitle: rawApp.subtitle || '',
    shortDescription: rawApp.subtitle || '',
    description: rawApp.description || '',
    score: rawApp.score || 0,
    price: rawApp.price != null ? rawApp.price : 0,
    screenshots: Array.isArray(rawApp.screenshots) ? rawApp.screenshots : [],
    category: rawApp.primaryGenre || rawApp.genre || 'Unknown',
    developer: rawApp.developer || '',
    developerId: rawApp.developerId || '',
  };

  const ownDeveloperIds = new Set([rawApp.developerId].filter(Boolean));

  // ── Competitor discovery ──────────────────────────────────────────────────
  let candidateIds;

  if (manualIds.length > 0) {
    candidateIds = manualIds
      .map(resolveAppStoreId)
      .filter((id) => id && id !== numericId)
      .slice(0, 10);
  } else {
    // Auto-discover: similar() + keyword search()
    const [similarResult, searchResult] = await Promise.allSettled([
      withRetry(() => store.similar({ id: numericId })),
      withRetry(() =>
        store.search({ term: buildSearchQuery(rawApp.title), num: 15, country, lang })
      ),
    ]);

    const similar = similarResult.status === 'fulfilled'
      ? (Array.isArray(similarResult.value) ? similarResult.value : [])
      : [];

    const search = searchResult.status === 'fulfilled'
      ? (Array.isArray(searchResult.value) ? searchResult.value : [])
      : [];

    // Normalize to { appId, developerId } shape for mergeAndFilter
    const normalizeApple = (list) =>
      list.map((a) => ({ appId: String(a.id || a.appId), developerId: a.developerId }));

    const merged = mergeAndFilter(
      normalizeApple(similar),
      normalizeApple(search),
      String(numericId),
      ownDeveloperIds
    );

    candidateIds = merged.map((a) => parseInt(a.appId, 10)).filter(Boolean);
  }

  // ── Fetch full details for each competitor ────────────────────────────────
  const competitors = [];

  for (const compId of candidateIds) {
    try {
      const compRaw = await withRetry(() => store.app({ id: compId, country, lang }));

      if (ownDeveloperIds.has(compRaw.developerId)) {
        await sleep(DELAY_MS);
        continue;
      }

      competitors.push({
        appId: String(compId),
        title: compRaw.title || '',
        subtitle: compRaw.subtitle || '',
        shortDescription: compRaw.subtitle || '',
        description: compRaw.description || '',
        score: compRaw.score || 0,
        developer: compRaw.developer || '',
        screenshots: Array.isArray(compRaw.screenshots) ? compRaw.screenshots : [],
      });
    } catch {
      // Skip competitors that fail to load
    }

    await sleep(DELAY_MS);
  }

  return { myApp, competitors };
}
