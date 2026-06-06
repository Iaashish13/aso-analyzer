# ASO Analyzer

A self-hosted App Store Optimization tool that scrapes Google Play and the Apple App Store, performs cross-store keyword gap analysis, and uses **Claude** to generate native, ranking-optimized listings per locale.

AI generation supports two provider paths:

- **Anthropic API** with forced structured output when `ANTHROPIC_API_KEY` is set
- **Local Claude Code Agent SDK** fallback, using your authenticated Claude Code session

Built with Next.js 14 (App Router). No database. Results live in browser `localStorage`.

---

## Features

- **Dual-store analysis** — scrape Google Play and App Store side-by-side in one run
- **Multi-locale** — analyze and generate copy for many locales in one submission (en-US, pt-BR, id-ID, ja-JP, custom)
- **Native-language copy** — Claude writes locale-native copy (not Google Translate)
- **Pre-launch mode** — generate listings from scratch using only competitor data (no live app required)
- **Saved app profiles** — persist your own apps for one-click reload
- **Saved competitor sets** — reuse competitor lists across runs
- **Heuristic draft plan + AI plan** — instant rule-based draft, optional AI synthesis
- **Cross-store keyword merge** — competitor pools from both stores feed the AI prompt
- **Structured AI output** — Anthropic API path uses forced tool/schema output for final ASO JSON
- **Output repair loop** — malformed JSON, schema failures, char limits, brand rules, and language checks trigger targeted retries
- **Batch stability** — "Generate all locales" uses bounded server-side concurrency
- **Char-limit linting** — validates Apple/Google field limits on AI output
- **Flexible AI provider** — direct Anthropic API for deployments, local Claude Code Agent SDK for no-key local use

---

## Prerequisites

1. **Node.js ≥ 18**
2. One Claude provider:
   - **Recommended for reliability/deployments:** `ANTHROPIC_API_KEY`
   - **Local fallback:** [Claude Code CLI](https://claude.com/claude-code) installed and authenticated

For Claude Code fallback, verify with:

```bash
claude -p "say ok"
```

Each AI synthesis consumes either Anthropic API usage or your Claude Code session quota, depending on the active provider.

---

## Quick start

```bash
git clone <your fork URL>
cd aso-analyzer
npm install
npm run dev
```

Open `http://localhost:3000`.

### First run (live app)

1. **Google Play App ID**: e.g. `com.spotify.music` (or paste full Play Store URL)
2. **App Store ID**: e.g. `324684580` (or paste full App Store URL)
3. **Target App Name / Brand**: optional — leave empty to auto-extract from your scraped title
4. **Locales**: select chips (English (US), Português (BR), etc.)
5. Click **Analyze** — scraping takes ~20–60s depending on store and locale count
6. On the results page, click **Generate Final ASO Content** per locale — Claude generates Apple + Google copy

### Pre-launch mode (no live app)

1. Check the **Pre-launch mode** box at the top of the form
2. Enter brand name + category (e.g. `Party Game`)
3. Expand **Manual competitors**, paste competitor URLs
4. Pick locales → Analyze
5. Claude generates listings from scratch based on competitor analysis

---

## How it works

```
Browser (localhost:3000)
       │
       ▼  POST /api/analyze
Next.js dev server (Node runtime)
       │
       ├──▶ google-play-scraper / app-store-scraper
       │       └─▶ scrape your app + competitors per locale
       │
       ├──▶ keyword gap analysis (lib/keywords.js)
       │       └─▶ NLP via `natural` — token frequencies, phrase n-grams,
       │            competitor-title keyword extraction
       │
       └──▶ heuristic draft plan (lib/asoPlan.js)

Browser ◀── factual asoPlanJson + per-locale results

Click "Generate Final ASO Content":
       │
       ▼  POST /api/synthesize
createAIProvider() (lib/ai/providerFactory.js)
       │
       ├──▶ AnthropicAPIProvider when ANTHROPIC_API_KEY exists
       │       └─▶ Messages API + forced tool/schema output
       │
       └──▶ AgentSDKProvider fallback
               └─▶ local Claude Code subprocess via @anthropic-ai/claude-agent-sdk
       │
       ▼  returns JSON
asoAgent.js
       │  - balanced JSON extraction + conservative repair fallback
       │  - zod schema validation
       │  - char-limit / brand / language validation
       ▼  - targeted repair retry when constraints fail
Browser ◀── final Apple + Google + screenshot copy per locale
```

### Provider behavior

The default provider selection is:

1. `AI_PROVIDER=anthropic` or `AI_PROVIDER=api` → direct Anthropic API
2. `AI_PROVIDER=agent` or `AI_PROVIDER=agent-sdk` → local Claude Code Agent SDK
3. If `AI_PROVIDER` is unset and `ANTHROPIC_API_KEY` exists → direct Anthropic API
4. Otherwise → local Claude Code Agent SDK

The Anthropic API path is preferred for deployed or multi-user environments because it does not depend on a local Claude Code login. The Agent SDK path remains useful for local use without an API key, but it only works on the machine where Claude Code is installed and authenticated.

---

## Project structure

```
.
├── app/
│   ├── page.js                  # Home form: app IDs, brand, locales, competitors
│   ├── results/page.js          # Results: locale tabs, scraped data, AI output
│   ├── api/
│   │   ├── analyze/route.js             # Scrape + keyword gap + asoPlanJson builder
│   │   ├── synthesize/route.js          # Single-locale AI synthesis
│   │   └── synthesize/batch/route.js    # Multi-locale synthesis with concurrency cap
│   └── layout.js
│
├── lib/
│   ├── scraper.js               # google-play-scraper + app-store-scraper wrappers
│   ├── scraperCache.js          # In-memory TTL cache (60min)
│   ├── keywords.js              # natural.WordTokenizer-based gap analysis
│   ├── asoPlan.js               # Heuristic draft plan generator
│   ├── savedApps.js             # localStorage CRUD: own-app profiles
│   ├── savedSets.js             # localStorage CRUD: competitor sets
│   └── ai/
│       ├── provider.js              # Provider interface + ProviderError
│       ├── providerFactory.js       # Env-based provider selection
│       ├── anthropicAPIProvider.js  # Direct Messages API + tool/schema output
│       ├── agentSDKProvider.js      # @anthropic-ai/claude-agent-sdk fallback
│       ├── conceptExtractor.js      # App concept extraction
│       └── asoAgent.js              # Prompt, zod schema, JSON parser, repair loop
│
├── .eslintrc.json
├── next.config.js
├── tailwind.config.js
└── package.json
```

---

## Configuration

Create `.env.local` for the direct API path:

```bash
ANTHROPIC_API_KEY=your_api_key
```

Optional environment variables:

```bash
AI_PROVIDER=anthropic                  # anthropic/api, agent/agent-sdk
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_MAX_TOKENS=12000
```

If `ANTHROPIC_API_KEY` is not set, the app falls back to your local Claude Code session through `@anthropic-ai/claude-agent-sdk`.

### Error handling

The API normalizes common provider failures so the UI can show actionable messages:

- `CLAUDE_SESSION_EXPIRED` — local Claude Code is logged out or unauthenticated
- `CLAUDE_QUOTA_EXHAUSTED` — local Claude Code quota or rate limit hit
- `CLAUDE_SDK_UNAVAILABLE` — Claude Code/Agent SDK unavailable locally
- `ANTHROPIC_AUTH_FAILED` — invalid or missing Anthropic API credentials
- `ANTHROPIC_QUOTA_EXHAUSTED` — Anthropic API quota or rate limit hit
- `PARSE_FAILED` / `SCHEMA_INVALID` — model output could not be repaired or validated

---

## Localization notes

- `locale.country` is a **2-letter ISO country code** (e.g. `br`, `id`, `jp`).
- `locale.language` is a **2-letter ISO language code** (e.g. `pt`, `id`, `ja`).
- Combined form like `pt-BR` is NOT accepted in the country field — that is a locale string, not a country code.
- For non-English locales, Claude is instructed in the system prompt to write **native copy**, not literal translations from English.

---

## Known limits

1. **Claude Code subscription required** for the Agent SDK path. Heavy testing consumes your Pro/Max quota fast.
2. **Anthropic API key required** for deployed direct API usage. Without it, deployed environments usually cannot use the local Agent SDK fallback.
3. **maxDuration = 90s** for single synthesis and analyze routes; batch synthesis allows longer server time but still depends on host limits.
4. **App Store keyword field (100 char hidden)** cannot be scraped from any store API — Apple does not expose it. The tool infers what competitors likely use by analyzing their title + subtitle word patterns.
5. **No real keyword search volume** — those numbers are only available via paid services (AppTweak, Sensor Tower, etc.). Competitor frequency is used as a proxy.
6. **Brazilian / Indonesian / Japanese stopword filtering** uses English defaults from the `natural` library. Non-English locale token frequency is still useful but slightly noisier.
7. **No database** — clear browser storage and saved profiles are gone. Export/import to JSON is planned.

---

## Commands

```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Build for production
npm run start    # Serve production build
npm run lint     # Run ESLint / Next core web vitals checks
```

---

## Roadmap

- [x] Anthropic API provider (multi-user deployments)
- [x] Structured-output ASO generation via Anthropic tool/schema calls
- [ ] JSON export / import for saved profiles + competitor sets
- [ ] Background job queue for >2 locales × 2 stores (lifts maxDuration ceiling)
- [ ] Real search volume integration (AppTweak / Sensor Tower / Search Ads API)
- [ ] A/B test variant generator (3 title variants per locale)
- [ ] Locale-aware stopword filtering
- [ ] PDF / CSV export of generated listings
- [ ] Server-side cache (Redis) replacing in-memory map

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Run `npm install && npm run dev`
4. Make changes, verify `npm run build` succeeds
5. Run `npm run lint`
6. Open a pull request

When changing scraper behavior, run a quick sanity check against a known app (e.g. `com.whatsapp`) to confirm the scrape still returns expected fields.

---

## License

[MIT](./LICENSE)

---

## Acknowledgements

- [`google-play-scraper`](https://github.com/facundoolano/google-play-scraper)
- [`app-store-scraper`](https://github.com/facundoolano/app-store-scraper)
- [`natural`](https://github.com/NaturalNode/natural) — NLP tokenizer
- [Anthropic Messages API](https://docs.anthropic.com) — direct structured generation path
- [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — local Claude Code integration
- [`zod`](https://zod.dev) — runtime schema validation
- [Next.js 14](https://nextjs.org)
