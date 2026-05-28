# ASO Analyzer

A self-hosted App Store Optimization tool that scrapes Google Play and the Apple App Store, performs cross-store keyword gap analysis, and uses **Claude (via the local Claude Code CLI)** to generate native, ranking-optimized listings per locale — without requiring an Anthropic API key.

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
- **Char-limit linting** — enforces Apple/Google field limits on AI output
- **No API key required** — uses your local Claude Code session via `@anthropic-ai/claude-agent-sdk`

---

## Prerequisites

1. **Node.js ≥ 18**
2. **[Claude Code CLI](https://claude.com/claude-code) installed and authenticated**
   - The tool spawns the `claude` binary as a subprocess for AI synthesis
   - Verify with: `claude -p "say ok"` — should return a short reply
3. **Claude Code subscription** (Pro or Max). Each AI synthesis consumes your Claude Code session quota.

If you do not have or want Claude Code, see [Swap the AI provider](#swap-the-ai-provider) below for an Anthropic API alternative.

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
AgentSDKProvider (lib/ai/agentSDKProvider.js)
       │
       ▼  spawns `claude` subprocess via @anthropic-ai/claude-agent-sdk
Claude (Anthropic backend, via your Claude Code login)
       │
       ▼  returns JSON
asoAgent.js
       │  - zod schema validation
       ▼  - char-limit linting
Browser ◀── final Apple + Google + screenshot copy per locale
```

### Why local subprocess?

The Claude Agent SDK uses your authenticated Claude Code session, so the app does not need an API key. The trade-off: it only works on the machine where Claude Code is installed and logged in. For multi-user deployments, swap to the Anthropic API (see below).

---

## Project structure

```
.
├── app/
│   ├── page.js                  # Home form: app IDs, brand, locales, competitors
│   ├── results/page.js          # Results: locale tabs, scraped data, AI output
│   ├── api/
│   │   ├── analyze/route.js     # Scrape + keyword gap + asoPlanJson builder
│   │   └── synthesize/route.js  # Claude synthesis via Agent SDK
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
│       ├── provider.js          # Provider interface + ProviderError
│       ├── agentSDKProvider.js  # @anthropic-ai/claude-agent-sdk impl
│       └── asoAgent.js          # System prompt, zod schema, JSON parser
│
├── next.config.js
├── tailwind.config.js
└── package.json
```

---

## Configuration

No environment variables required for the default Agent SDK path. The local `claude` CLI handles authentication via your existing Claude Code login.

To use the Anthropic API directly instead, see [Swap the AI provider](#swap-the-ai-provider) below.

---

## Swap the AI provider

To use the Anthropic API directly instead of Claude Code, implement a new provider:

```js
// lib/ai/anthropicAPIProvider.js
import Anthropic from '@anthropic-ai/sdk';
import { ProviderError } from './provider.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export class AnthropicAPIProvider {
  async generate({ systemPrompt, userPrompt, abortSignal }) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }, { signal: abortSignal });

    return {
      text: response.content[0].text,
      costUsd: 0, // compute from usage if needed
      model: response.model,
    };
  }
}
```

Then in `app/api/synthesize/route.js`, replace:

```js
const provider = new AgentSDKProvider();
```

with:

```js
const provider = new AnthropicAPIProvider();
```

Add `ANTHROPIC_API_KEY` to `.env.local`. This works in deployed environments (Vercel etc.) where Claude Code is not available.

---

## Localization notes

- `locale.country` is a **2-letter ISO country code** (e.g. `br`, `id`, `jp`).
- `locale.language` is a **2-letter ISO language code** (e.g. `pt`, `id`, `ja`).
- Combined form like `pt-BR` is NOT accepted in the country field — that is a locale string, not a country code.
- For non-English locales, Claude is instructed in the system prompt to write **native copy**, not literal translations from English.

---

## Known limits

1. **Claude Code subscription required** for the Agent SDK path. Heavy testing consumes your Pro/Max quota fast.
2. **maxDuration = 90s** per route. With many locales × stores, scraping can exceed this on production deploys. Locally (`npm run dev`) there is no limit.
3. **App Store keyword field (100 char hidden)** cannot be scraped from any store API — Apple does not expose it. The tool infers what competitors likely use by analyzing their title + subtitle word patterns.
4. **No real keyword search volume** — those numbers are only available via paid services (AppTweak, Sensor Tower, etc.). Competitor frequency is used as a proxy.
5. **Brazilian / Indonesian / Japanese stopword filtering** uses English defaults from the `natural` library. Non-English locale token frequency is still useful but slightly noisier.
6. **No database** — clear browser storage and saved profiles are gone. Export/import to JSON is planned.

---

## Commands

```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Build for production
npm run start    # Serve production build
npm run lint     # Run ESLint (currently unconfigured)
```

---

## Roadmap

- [ ] Anthropic API provider (multi-user deployments)
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
5. Open a pull request

When changing scraper behavior, run a quick sanity check against a known app (e.g. `com.whatsapp`) to confirm the scrape still returns expected fields.

---

## License

[MIT](./LICENSE)

---

## Acknowledgements

- [`google-play-scraper`](https://github.com/facundoolano/google-play-scraper)
- [`app-store-scraper`](https://github.com/facundoolano/app-store-scraper)
- [`natural`](https://github.com/NaturalNode/natural) — NLP tokenizer
- [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — local Claude Code integration
- [`zod`](https://zod.dev) — runtime schema validation
- [Next.js 14](https://nextjs.org)
