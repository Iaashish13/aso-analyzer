# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Build for production
npm run start    # Serve production build (requires prior build)
npm run lint     # Run ESLint via Next.js
```

No test framework is configured.

## Architecture

This is a Next.js 14 (App Router) web tool for App Store Optimization (ASO) analysis — it finds keyword gaps between your app and competitors by scraping Google Play or the Apple App Store.

### Data Flow

1. **`app/page.js`** (client) — user enters an app ID and optional competitor IDs, submits to the API
2. **`app/api/analyze/route.js`** (server) — orchestrates scraping + analysis, returns JSON; `maxDuration = 90` (Vercel limit), client enforces 95s timeout
3. **`app/results/page.js`** (client) — reads result from `localStorage('aso_result')` and renders keyword gaps, competitor cards, and screenshots

### Key Modules

**`lib/scraper.js`** — all store scraping logic:
- `scrapeGooglePlay(appId, manualCompetitors)` / `scrapeAppStore(appId, manualCompetitors)`
- Auto-discovery: merges `similar()` + `search()` results, deduplicates, filters out same-developer apps, fetches top 10 competitors
- Rate-limit handling: exponential backoff on 429s; 300ms delay between App Store requests

**`lib/keywords.js`** — NLP analysis:
- `extractKeywords(text)` — tokenizes with `natural.WordTokenizer`, filters stopwords and short tokens
- `analyzeKeywordGaps(myApp, competitors)` — keywords appearing in 3+ competitors that you're missing (top 30 gaps, top 50 competitor keywords returned)

### Important Constraints

- **No database or auth** — fully stateless; results live only in browser `localStorage`
- Scraper packages (`google-play-scraper`, `app-store-scraper`, `natural`) are Node-only and marked as `serverComponentsExternalPackages` in `next.config.js` — never import them in client components
- Path alias `@/` maps to the repo root (`jsconfig.json`)
