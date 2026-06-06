import { NextResponse } from 'next/server';
import { scrapeGooglePlay, scrapeAppStore, scrapeCompetitorsOnly } from '@/lib/scraper';
import { analyzeKeywordGaps } from '@/lib/keywords';
import { getScrapeCache } from '@/lib/scraperCache';
import { getCanonicalEnListing } from '@/lib/canonicalEnCache';
import { normalizeBrandName } from '@/lib/brandName';

export const runtime = 'nodejs';
export const maxDuration = 90;

function parseCompetitorEntry(raw, store) {
  const entry = String(raw || '').trim();
  if (!entry) return null;

  if (store === 'google') {
    const urlMatch = entry.match(/[?&]id=([^&\s]+)/);
    if (urlMatch) return urlMatch[1];
    if (/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(entry)) return entry;
    return null;
  }

  const urlMatch = entry.match(/\/id(\d+)/);
  if (urlMatch) return urlMatch[1];
  if (/^\d+$/.test(entry)) return entry;
  return null;
}

function parseAppId(raw, store) {
  return parseCompetitorEntry(raw, store) || String(raw || '').trim();
}

function parseManual(input, store) {
  if (!input || typeof input !== 'string' || !input.trim()) return [];
  return input
    .split(/[\n,]+/)
    .map((e) => parseCompetitorEntry(e, store))
    .filter(Boolean);
}

function normalizeLocale(input) {
  if (!input) return { country: 'us', language: 'en' };
  return {
    country: String(input.country || 'us').trim().toLowerCase(),
    language: String(input.language || 'en').trim().toLowerCase(),
  };
}

function normalizeLocales(input) {
  if (Array.isArray(input)) {
    if (input.length === 0) return [{ country: 'us', language: 'en' }];
    return input.map(normalizeLocale);
  }
  return [normalizeLocale(input)];
}

async function scrapeWithCache({ store, appId, locale, manualIds }) {
  const cache = getScrapeCache();
  const cacheKey = {
    store,
    appId: manualIds.length > 0 ? `${appId}::${manualIds.join(',')}` : appId,
    country: locale.country,
    language: locale.language,
  };

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const scraped =
    store === 'google'
      ? await scrapeGooglePlay(appId, manualIds, locale)
      : await scrapeAppStore(appId, manualIds, locale);

  cache.set(cacheKey, scraped);
  return scraped;
}

function buildStorePayload({ store, appId, scraped, keywordAnalysis, canonicalEn }) {
  const { myApp, competitors } = scraped;
  return {
    appId,
    currentListing: {
      title: myApp.title,
      subtitle: myApp.subtitle || '',
      shortDescription: myApp.shortDescription || '',
      description: myApp.description || '',
      category: myApp.category || '',
      score: myApp.score || 0,
      installs: myApp.installs || '',
      ...(myApp.localeFallback ? {
        localeFallback: true,
        localeFallbackSource: myApp.localeFallbackSource || 'en-US',
        note: 'App not listed in target locale — data sourced from en-US. No existing local listing to preserve.',
      } : {}),
    },
    ...(canonicalEn ? {
      canonicalListingEn: {
        title: canonicalEn.title || '',
        subtitle: canonicalEn.subtitle || '',
        shortDescription: canonicalEn.shortDescription || '',
        description: canonicalEn.description || '',
        category: canonicalEn.category || '',
      },
    } : {}),
    competitors: competitors.map((c) => ({
      appId: c.appId,
      title: c.title,
      subtitle: c.subtitle || '',
      shortDescription: c.shortDescription || '',
      description: c.description || '',
      score: c.score || 0,
      installs: c.installs || '',
      developer: c.developer || '',
      screenshotCount: c.screenshots?.length || 0,
      ...(c.localeFallback ? { localeFallback: true } : {}),
    })),
    keywordAnalysis: {
      gaps: keywordAnalysis.gaps || [],
      phraseGaps: keywordAnalysis.phraseGaps || [],
      topCompetitorKeywords: keywordAnalysis.topCompetitorKeywords || [],
      topCompetitorPhrases: keywordAnalysis.topCompetitorPhrases || [],
      sharedKeywords: keywordAnalysis.sharedKeywords || [],
      competitorTitleKeywords: keywordAnalysis.competitorTitleKeywords || [],
    },
  };
}

async function scrapeAndAnalyze({ store, appId, manualIds, locale, targetAppName, preLaunch, category }) {
  let scraped;
  if (preLaunch) {
    if (!manualIds || manualIds.length === 0) {
      throw new Error('Pre-launch mode requires competitor IDs for this store.');
    }
    scraped = await scrapeCompetitorsOnly(store, manualIds, locale, {
      brandName: targetAppName,
      category,
    });
  } else {
    scraped = await scrapeWithCache({ store, appId, locale, manualIds });
  }

  // Canonical EN anchor: when the locale is non-English, fetch the app's
  // EN listing so the synthesizer has a stable semantic source. Skipped for
  // pre-launch (no real app to fetch) and for EN locales (already canonical).
  // Cached + dedup'd across parallel locales.
  let canonicalEn = null;
  const isEnLocale = (locale?.language || '').toLowerCase() === 'en';
  if (!preLaunch && appId && !isEnLocale) {
    canonicalEn = await getCanonicalEnListing(store, appId);
  }

  // When main app fell back to EN listing, keyword gap analysis must use EN
  // on the myApp side — comparing EN app text against non-EN competitors is
  // a language mismatch that produces meaningless gaps.
  const keywordLang = scraped.myApp.localeFallback ? 'en' : (locale?.language || 'en');
  let keywordAnalysis;
  try {
    keywordAnalysis = analyzeKeywordGaps(scraped.myApp, scraped.competitors, keywordLang);
  } catch {
    keywordAnalysis = {
      myKeywords: [], gaps: [], topCompetitorKeywords: [],
      sharedKeywords: [], competitorTitleKeywords: [], phraseGaps: [],
    };
  }

  return {
    store,
    appId,
    scraped,
    keywordAnalysis,
    payload: buildStorePayload({ store, appId, scraped, keywordAnalysis, canonicalEn }),
  };
}

function buildCombinedAsoPlanJson({
  targetAppName,
  targetDescription,
  locale,
  googleResult,
  appleResult,
  competitorMode,
  preLaunch,
  category,
}) {
  const stores = {};
  if (googleResult) {
    stores.google = {
      appId: googleResult.payload.appId,
      currentListing: googleResult.payload.currentListing,
      ...(googleResult.payload.canonicalListingEn
        ? { canonicalListingEn: googleResult.payload.canonicalListingEn }
        : {}),
      competitors: googleResult.payload.competitors,
      keywordAnalysis: googleResult.payload.keywordAnalysis,
    };
  }
  if (appleResult) {
    stores.apple = {
      appId: appleResult.payload.appId,
      currentListing: appleResult.payload.currentListing,
      ...(appleResult.payload.canonicalListingEn
        ? { canonicalListingEn: appleResult.payload.canonicalListingEn }
        : {}),
      competitors: appleResult.payload.competitors,
      keywordAnalysis: appleResult.payload.keywordAnalysis,
    };
  }

  // Brand name preference: requested → scraped title (google then apple).
  // Always normalized to strip taglines/subtitles ("Brand: Tagline" →
  // "Brand") so synthesized copy doesn't inherit the marketing fragment
  // and the verbatim brand-presence validator doesn't false-fail.
  const brandName = normalizeBrandName(
    targetAppName?.trim() ||
    googleResult?.scraped?.myApp?.title ||
    appleResult?.scraped?.myApp?.title ||
    ''
  );

  return {
    schemaVersion: '1.2',
    generatedAt: new Date().toISOString(),
    brandName,
    requestedBrandName: targetAppName || '',
    targetDescription: targetDescription || '',
    locale,
    stores,
    sourceMeta: {
      competitorMode,
      preLaunch: !!preLaunch,
      category: category || null,
      storesScraped: Object.keys(stores),
      googleCompetitorCount: googleResult?.scraped?.competitors?.length || 0,
      appleCompetitorCount: appleResult?.scraped?.competitors?.length || 0,
      googleLocaleFallbackCompetitors: googleResult?.scraped?.competitors?.filter((c) => c.localeFallback)?.length || 0,
      appleLocaleFallbackCompetitors: appleResult?.scraped?.competitors?.filter((c) => c.localeFallback)?.length || 0,
      dataSource: 'store-scraper',
      aiRole: preLaunch
        ? 'Pre-launch mode: no live listing exists. Generate listings from scratch using competitor analysis.'
        : 'Use this JSON as factual input. Do not scrape stores from the AI tool.',
    },
  };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in request body.' }, { status: 400 });
  }

  const preLaunch = !!body.preLaunch;
  const category = String(body.category || '').trim();
  const targetDescription = String(body.targetDescription || '').trim();

  // Back-compat: old shape used { appId, store }
  let googleAppIdRaw = body.googleAppId;
  let appleAppIdRaw = body.appleAppId;
  if (!googleAppIdRaw && !appleAppIdRaw && body.appId && body.store) {
    if (body.store === 'google') googleAppIdRaw = body.appId;
    else if (body.store === 'apple') appleAppIdRaw = body.appId;
  }

  const googleAppId = googleAppIdRaw && !preLaunch ? parseAppId(googleAppIdRaw, 'google') : null;
  const appleAppId = appleAppIdRaw && !preLaunch ? parseAppId(appleAppIdRaw, 'apple') : null;

  if (!preLaunch && !googleAppId && !appleAppId) {
    return NextResponse.json(
      { error: 'At least one of googleAppId or appleAppId is required (or enable pre-launch mode).' },
      { status: 400 }
    );
  }

  if (googleAppId && /^\d+$/.test(googleAppId)) {
    return NextResponse.json(
      { error: 'Google Play app IDs look like "com.example.app", not numeric.' },
      { status: 400 }
    );
  }
  if (appleAppId && !/^\d+$/.test(appleAppId)) {
    return NextResponse.json(
      { error: 'App Store IDs must be numeric or App Store URL.' },
      { status: 400 }
    );
  }

  // Back-compat for manual: old was { competitorUrls }
  const googleManual = body.googleManual ?? (body.store === 'google' ? body.competitorUrls : '');
  const appleManual = body.appleManual ?? (body.store === 'apple' ? body.competitorUrls : '');
  const googleManualIds = parseManual(googleManual, 'google');
  const appleManualIds = parseManual(appleManual, 'apple');

  const locales = normalizeLocales(body.locales || body.locale);
  const targetAppName = body.targetAppName;
  const competitorMode = preLaunch
    ? 'pre-launch'
    : (googleManualIds.length > 0 || appleManualIds.length > 0 ? 'manual' : 'auto');

  // Pre-launch requires at least one store's competitors
  if (preLaunch && googleManualIds.length === 0 && appleManualIds.length === 0) {
    return NextResponse.json(
      { error: 'Pre-launch mode requires at least one competitor (Google or Apple).' },
      { status: 400 }
    );
  }
  if (preLaunch && !targetAppName) {
    return NextResponse.json(
      { error: 'Pre-launch mode requires targetAppName.' },
      { status: 400 }
    );
  }

  const results = [];
  const errors = [];

  for (const locale of locales) {
    const promises = [];
    const includeGoogle = preLaunch ? googleManualIds.length > 0 : !!googleAppId;
    const includeApple = preLaunch ? appleManualIds.length > 0 : !!appleAppId;

    if (includeGoogle) {
      promises.push(
        scrapeAndAnalyze({
          store: 'google',
          appId: googleAppId,
          manualIds: googleManualIds,
          locale,
          targetAppName,
          preLaunch,
          category,
        }).catch((err) => ({ _error: err, store: 'google', locale }))
      );
    }
    if (includeApple) {
      promises.push(
        scrapeAndAnalyze({
          store: 'apple',
          appId: appleAppId,
          manualIds: appleManualIds,
          locale,
          targetAppName,
          preLaunch,
          category,
        }).catch((err) => ({ _error: err, store: 'apple', locale }))
      );
    }

    const settled = await Promise.all(promises);

    let googleResult = null;
    let appleResult = null;
    for (const r of settled) {
      if (r._error) {
        errors.push({
          locale,
          store: r.store,
          error: r._error.message || 'Scrape failed.',
        });
      } else if (r.store === 'google') {
        googleResult = r;
      } else if (r.store === 'apple') {
        appleResult = r;
      }
    }

    if (!googleResult && !appleResult) {
      // both stores failed for this locale — skip locale entirely
      continue;
    }

    const asoPlanJson = buildCombinedAsoPlanJson({
      targetAppName,
      targetDescription,
      locale,
      googleResult,
      appleResult,
      competitorMode,
      preLaunch,
      category,
    });

    results.push({
      locale,
      stores: {
        google: googleResult
          ? {
              myApp: googleResult.scraped.myApp,
              competitors: googleResult.scraped.competitors,
              keywordAnalysis: googleResult.keywordAnalysis,
            }
          : null,
        apple: appleResult
          ? {
              myApp: appleResult.scraped.myApp,
              competitors: appleResult.scraped.competitors,
              keywordAnalysis: appleResult.keywordAnalysis,
            }
          : null,
      },
      asoPlanJson,
    });
  }

  if (results.length === 0) {
    return NextResponse.json(
      {
        error: 'All locales failed to scrape.',
        details: errors,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    results,
    errors,
    meta: {
      storesRequested: [googleAppId && 'google', appleAppId && 'apple'].filter(Boolean),
      locales,
      competitorMode,
      localesRequested: locales.length,
      localesSucceeded: results.length,
    },
  });
}
